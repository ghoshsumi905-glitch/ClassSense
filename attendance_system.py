"""
Web-service version of AttendanceSystem.

Original desktop version opened its own camera (cv2.VideoCapture(0)) and
its own display window (cv2.imshow) in a blocking while-loop. A server has
neither a camera nor a screen, so that loop is removed here. Everything
else (loading known faces, encoding, matching, writing attendance rows) is
kept the same -- only the *frame source* changes: frames now arrive one at
a time from the FastAPI layer (which got them from the browser), instead of
being pulled from a local cv2.VideoCapture in an infinite loop.

Session concept: since HTTP requests are stateless, "duration_seconds"
sessions from the desktop version become explicit start_session /
process_frame / end_session calls, with session state (which students have
been marked present) kept per-session_id in memory (see SessionManager
in main.py).

PERSISTENCE UPDATE:
Render's free tier has no persistent disk, so any encodings written to a
local file (including a local sqlite DB) are wiped on every redeploy. Face
encodings are now stored in the same Postgres database as everything else
(via DB_URL, e.g. a free Neon/Supabase instance) using SQLAlchemy Core --
this survives redeploys, unlike local disk.

If DB_URL isn't set (e.g. running locally without a database), this falls
back to the original filesystem-based "registered_faces" folder behavior,
so local development still works without any external dependency.
"""

import os
import pickle
import numpy as np
import pandas as pd
import cv2
import face_recognition
from datetime import datetime


class AttendanceSystem:
    def __init__(self, dataset_dir="registered_faces", attendance_file="attendance.csv",
                 tolerance=0.50, face_db_url=None):
        """If DB_URL (env var) or face_db_url is provided, face encodings are persisted
        into that database via SQLAlchemy (works with Postgres, e.g. Neon/Supabase, or
        sqlite for local dev). If not provided, the original filesystem-based
        "registered_faces" folder behavior is preserved.
        """
        self.dataset_dir = dataset_dir
        self.attendance_file = attendance_file
        self.tolerance = tolerance
        self.known_face_encodings = []
        self.known_face_names = []

        db_url = os.environ.get("DB_URL") or face_db_url
        self.use_db = bool(db_url)
        self._engine = None

        if self.use_db:
            from sqlalchemy import create_engine, text
            self._text = text
            self._engine = create_engine(db_url, pool_pre_ping=True)
            self._is_postgres = db_url.startswith("postgres")

            blob_type = "BYTEA" if self._is_postgres else "BLOB"
            with self._engine.begin() as conn:
                conn.execute(text(f"""
                    CREATE TABLE IF NOT EXISTS faces (
                        id SERIAL PRIMARY KEY,
                        name TEXT NOT NULL,
                        encoding {blob_type} NOT NULL
                    )
                """ if self._is_postgres else f"""
                    CREATE TABLE IF NOT EXISTS faces (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        encoding {blob_type} NOT NULL
                    )
                """))
            self._load_encodings_from_db()
        else:
            # fallback to filesystem-based load (original behavior)
            self.load_registered_faces(self.dataset_dir)

    # ---------- loading known faces ----------

    def load_registered_faces(self, folder_path):
        """Filesystem loading path preserved for backward compatibility / local dev.
        If DB_URL is set, the DB-backed loader is used instead and this method
        is not required for startup loading."""
        if self.use_db:
            return

        self.known_face_encodings = []
        self.known_face_names = []

        if not os.path.exists(folder_path):
            print(f"Dataset folder '{folder_path}' not found yet.")
            return

        for person_name in os.listdir(folder_path):
            person_dir = os.path.join(folder_path, person_name)
            if os.path.isdir(person_dir):
                for img_name in os.listdir(person_dir):
                    if img_name.lower().endswith((".jpg", ".jpeg", ".png")):
                        img_path = os.path.join(person_dir, img_name)
                        try:
                            img = face_recognition.load_image_file(img_path)
                            encodings = face_recognition.face_encodings(img)
                            if encodings:
                                self.known_face_encodings.append(encodings[0])
                                self.known_face_names.append(person_name.lower())
                        except Exception as e:
                            print(f"Error loading {img_name}: {e}")

        print(f"Loaded {len(self.known_face_encodings)} face sample(s) for "
              f"{len(set(self.known_face_names))} student(s).")

    def _load_encodings_from_db(self):
        """Load pickled numpy encodings from the faces table via SQLAlchemy."""
        self.known_face_encodings = []
        self.known_face_names = []
        try:
            with self._engine.begin() as conn:
                rows = conn.execute(self._text("SELECT name, encoding FROM faces")).fetchall()
            for name, blob in rows:
                try:
                    # psycopg2 may return memoryview for BYTEA; normalize to bytes
                    raw = bytes(blob) if not isinstance(blob, (bytes, bytearray)) else blob
                    enc = pickle.loads(raw)
                    self.known_face_encodings.append(enc)
                    self.known_face_names.append(name)
                except Exception as e:
                    print(f"Failed to deserialize encoding for {name}: {e}")
        except Exception as e:
            print(f"Failed to load encodings from DB: {e}")

        print(f"Loaded {len(self.known_face_encodings)} face sample(s) for "
              f"{len(set(self.known_face_names))} student(s) (from DB).")

    # ---------- registration ----------

    def register_face_images(self, name, image_bgr_list, max_images=20):
        """Saves registration photos (up to `max_images`) and stores corresponding face
        encodings. Photos still go to local disk (ephemeral on Render free tier -- fine,
        since only the encodings need to persist). Encodings go to the DB if configured,
        which is what survives redeploys.
        """
        person_folder = os.path.join(self.dataset_dir, name.lower())
        os.makedirs(person_folder, exist_ok=True)
        # clear old images (keeps dataset_dir tidy)
        for f in os.listdir(person_folder):
            try:
                os.remove(os.path.join(person_folder, f))
            except Exception:
                pass

        saved = 0
        encodings_to_save = []
        for i, frame in enumerate(image_bgr_list[:max_images]):
            path = os.path.join(person_folder, f"{name.lower()}_{i}.jpg")
            cv2.imwrite(path, frame)
            saved += 1
            try:
                img = face_recognition.load_image_file(path)
                encs = face_recognition.face_encodings(img)
                if encs:
                    encodings_to_save.append(encs[0])
            except Exception as e:
                print(f"Warning: failed to compute encoding for {path}: {e}")

        if self.use_db and encodings_to_save:
            try:
                with self._engine.begin() as conn:
                    conn.execute(
                        self._text("DELETE FROM faces WHERE name = :name"),
                        {"name": name.lower()}
                    )
                    for enc in encodings_to_save:
                        blob = pickle.dumps(enc)
                        conn.execute(
                            self._text("INSERT INTO faces (name, encoding) VALUES (:name, :encoding)"),
                            {"name": name.lower(), "encoding": blob}
                        )
                self._load_encodings_from_db()
            except Exception as e:
                print(f"Warning: could not save encodings to DB for {name}: {e}")
        elif not self.use_db:
            # fallback: reload from filesystem (original behavior, no DB configured)
            self.load_registered_faces(self.dataset_dir)

        return saved

    # ---------- recognition ----------

# ---------- recognition ----------

    def recognize_faces(self, frame):
        """Return a list of recognized names found in the frame. Uses two-pass
        matching: primary tolerance and an optional relaxed tolerance to try and
        capture partial/blurred faces. Returns list of names (lowercased) or "Unknown-<i>" placeholders.

        IMPORTANT: downscaling here is now ADAPTIVE, not a fixed 4x shrink.
        The frontend already downscales frames to ~480px wide before sending
        (to keep uploads fast on Render's free tier). A fixed 0.25x shrink on
        top of that used to produce ~120px-wide frames -- far too small for
        the face detector to find anything, which silently broke attendance
        even though registered encodings were present and correct.

        Instead, we only shrink further if the incoming frame is LARGER than
        our target width. Frames already at or below the target are left
        alone. This keeps things fast on big frames (e.g. local dev sending
        full webcam resolution) without destroying detectability on frames
        the frontend has already sized down.
        """
        results = []
        if len(self.known_face_encodings) == 0:
            return []

        h, w = frame.shape[:2]
        target_width = 400  # sweet spot: fast enough, still detectable faces
        scale = min(1.0, target_width / w)
        if scale < 1.0:
            small = cv2.resize(frame, (0, 0), fx=scale, fy=scale)
        else:
            small = frame  # already small (e.g. frontend-downscaled) -- don't shrink further

        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)

        locations = face_recognition.face_locations(rgb)
        if len(locations) == 0:
            return []

        encodings = face_recognition.face_encodings(rgb, locations)
        for i, enc in enumerate(encodings):
            if len(self.known_face_encodings) == 0:
                results.append(f"Unknown-{i}")
                continue
            dists = face_recognition.face_distance(self.known_face_encodings, enc)
            best_idx = int(np.argmin(dists))
            best_dist = float(dists[best_idx]) if len(dists) > 0 else 1.0
            if best_dist <= self.tolerance:
                results.append(self.known_face_names[best_idx])
            else:
                rel_tol = min(0.9, self.tolerance * 1.25)
                if best_dist <= rel_tol:
                    results.append(self.known_face_names[best_idx])
                else:
                    results.append(f"Unknown-{i}")
        return results

    # ---------- attendance logging ----------

    def _append_attendance_row(self, name, status, session_id=None):
        now = datetime.now()
        row = {
            "Name": name,
            "Date": now.date().isoformat(),
            "Time": now.time().strftime("%H:%M:%S"),
            "Status": status,
            "SessionId": session_id or "",
        }
        file_exists = os.path.isfile(self.attendance_file)
        pd.DataFrame([row]).to_csv(self.attendance_file, mode="a", header=not file_exists, index=False)

    def process_attendance_frame(self, frame, marked_students, session_id=None):
        """Process a frame containing potentially multiple faces.
        Marks all recognized faces as Present (if not yet marked). Returns
        a dict with list of names seen, newly marked count, and present_count."""
        names = self.recognize_faces(frame)
        newly = []
        for name in names:
            if name and not name.startswith("Unknown") and name not in marked_students:
                self._append_attendance_row(name, "Present", session_id)
                marked_students.add(name)
                newly.append(name)
        return {"names": names, "newly_marked": newly, "present_count": len(marked_students)}

    def finalize_session(self, marked_students, session_id=None):
        all_registered = set(self.known_face_names)
        absentees = all_registered - marked_students
        for absent_student in absentees:
            self._append_attendance_row(absent_student, "Absent", session_id)
        return {"present": sorted(marked_students), "absent": sorted(absentees)}