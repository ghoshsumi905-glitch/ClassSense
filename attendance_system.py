"""
Web-service version of AttendanceSystem.

CLASS-SCOPED FACES UPDATE:
Faces are now stored and matched per class_id (the SchoolClass row created
at login: professor + year + period). This means the same student name in
"1st Year" and "3rd Year" are completely separate identities -- registering
"Sumi" under class_id=1 never matches frames captured under class_id=2.
class_id=None is still supported (legacy/local-dev rows, matched against
each other) so nothing breaks if a caller doesn't pass one.

CONFIDENCE + REVIEW QUEUE UPDATE:
recognize_faces() now returns structured matches with a 0-100 confidence
score and a status of "matched" / "uncertain" / "unknown" instead of a bare
name string. "uncertain" matches (best guess exists but distance is in the
relaxed-tolerance band) are what main.py surfaces in the per-session review
queue for the teacher to confirm or correct.

PERSISTENCE:
Render's free tier has no persistent disk, so any encodings written to a
local file (including a local sqlite DB) are wiped on every redeploy. Face
encodings are stored in the same Postgres database as everything else (via
DB_URL, e.g. a free Neon/Supabase instance) using SQLAlchemy Core -- this
survives redeploys, unlike local disk. If DB_URL isn't set, this falls back
to the original filesystem-based "registered_faces" folder behavior.

ATTENDANCE ROW CLASS_ID UPDATE (this revision):
_append_attendance_row / process_attendance_frame / finalize_session now
all thread class_id through to every row written to attendance.csv. Before
this, a "Present"/"Absent" row only had Name/Date/Time/Status/SessionId --
with multiple classes in play there was no reliable way to tell which
class a row belonged to, and the SIS export in main.py was falling back to
consent_status instead of real attendance data as a result. Note this is
still CSV-on-local-disk, which Render's free tier wipes on redeploy --
same durability gap that made faces/mood events move to Postgres. Worth
doing the same migration here (an AttendanceRecord table) before relying
on this for real cross-day history.
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
        self.dataset_dir = dataset_dir
        self.attendance_file = attendance_file
        self.tolerance = tolerance
        self.known_face_encodings = []
        self.known_face_names = []
        self.known_face_class_ids = []  # parallel array; None = unscoped/legacy

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
                        encoding {blob_type} NOT NULL,
                        class_id INTEGER
                    )
                """ if self._is_postgres else f"""
                    CREATE TABLE IF NOT EXISTS faces (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        encoding {blob_type} NOT NULL,
                        class_id INTEGER
                    )
                """))
                # Light migration: add class_id to a pre-existing faces table
                # that was created before this column existed. Ignored if it
                # already exists.
                try:
                    conn.execute(text("ALTER TABLE faces ADD COLUMN class_id INTEGER"))
                except Exception:
                    pass
            self._load_encodings_from_db()
        else:
            # fallback to filesystem-based load (original behavior)
            self.load_registered_faces(self.dataset_dir)

    # ---------- loading known faces ----------

    def load_registered_faces(self, folder_path):
        """Filesystem loading path preserved for backward compatibility / local dev.
        No class scoping in filesystem mode -- all faces share one namespace."""
        if self.use_db:
            return

        self.known_face_encodings = []
        self.known_face_names = []
        self.known_face_class_ids = []

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
                                self.known_face_class_ids.append(None)
                        except Exception as e:
                            print(f"Error loading {img_name}: {e}")

        print(f"Loaded {len(self.known_face_encodings)} face sample(s) for "
              f"{len(set(self.known_face_names))} student(s).")

    def _load_encodings_from_db(self):
        """Load pickled numpy encodings (and their class_id) from the faces table."""
        self.known_face_encodings = []
        self.known_face_names = []
        self.known_face_class_ids = []
        try:
            with self._engine.begin() as conn:
                rows = conn.execute(self._text("SELECT name, encoding, class_id FROM faces")).fetchall()
            for name, blob, class_id in rows:
                try:
                    raw = bytes(blob) if not isinstance(blob, (bytes, bytearray)) else blob
                    enc = pickle.loads(raw)
                    self.known_face_encodings.append(enc)
                    self.known_face_names.append(name)
                    self.known_face_class_ids.append(class_id)
                except Exception as e:
                    print(f"Failed to deserialize encoding for {name}: {e}")
        except Exception as e:
            print(f"Failed to load encodings from DB: {e}")

        print(f"Loaded {len(self.known_face_encodings)} face sample(s) for "
              f"{len(set(self.known_face_names))} student(s) (from DB).")

    def get_class_roster_names(self, class_id):
        """Names with at least one stored encoding under this class_id."""
        return sorted({
            n for n, c in zip(self.known_face_names, self.known_face_class_ids)
            if c == class_id
        })

    # ---------- registration ----------

    def register_face_images(self, name, image_bgr_list, class_id=None, max_images=20):
        """Saves registration photos and stores corresponding face encodings,
        scoped to class_id. Re-registering the same name under the SAME
        class_id replaces their old encodings; the same name under a
        DIFFERENT class_id is a completely separate identity and is left
        untouched.
        """
        folder_key = f"{name.lower()}__class{class_id}" if class_id is not None else name.lower()
        person_folder = os.path.join(self.dataset_dir, folder_key)
        os.makedirs(person_folder, exist_ok=True)
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
                    if class_id is not None:
                        conn.execute(
                            self._text("DELETE FROM faces WHERE name = :name AND class_id = :class_id"),
                            {"name": name.lower(), "class_id": class_id}
                        )
                    else:
                        conn.execute(
                            self._text("DELETE FROM faces WHERE name = :name AND class_id IS NULL"),
                            {"name": name.lower()}
                        )
                    for enc in encodings_to_save:
                        blob = pickle.dumps(enc)
                        conn.execute(
                            self._text("INSERT INTO faces (name, encoding, class_id) VALUES (:name, :encoding, :class_id)"),
                            {"name": name.lower(), "encoding": blob, "class_id": class_id}
                        )
                self._load_encodings_from_db()
            except Exception as e:
                print(f"Warning: could not save encodings to DB for {name}: {e}")
        elif not self.use_db:
            self.load_registered_faces(self.dataset_dir)

        return saved

    # ---------- recognition ----------

    def recognize_faces(self, frame, class_id=None):
        """Return a list of structured matches for faces found in the frame,
        matched only against encodings registered under `class_id` (plus
        legacy class_id=None rows, so old data still works).

        Each match: {"name": str|None, "confidence": 0-100, "status": "matched"|"uncertain"|"unknown"}
        confidence is derived from face_distance (lower distance = higher
        confidence); it's a rough proxy, not a calibrated probability, and
        is presented to the teacher as such.
        """
        results = []

        # Filter the known-face pool down to this class (plus unscoped legacy rows)
        pool_idx = [i for i, c in enumerate(self.known_face_class_ids) if c == class_id or c is None]
        pool_encodings = [self.known_face_encodings[i] for i in pool_idx]
        pool_names = [self.known_face_names[i] for i in pool_idx]

        h, w = frame.shape[:2]
        target_width = 400
        scale = min(1.0, target_width / w)
        small = cv2.resize(frame, (0, 0), fx=scale, fy=scale) if scale < 1.0 else frame

        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        locations = face_recognition.face_locations(rgb)
        if len(locations) == 0:
            return []

        encodings = face_recognition.face_encodings(rgb, locations)
        rel_tol = min(0.9, self.tolerance * 1.25)

        for i, enc in enumerate(encodings):
            if len(pool_encodings) == 0:
                results.append({"name": None, "confidence": 0, "status": "unknown"})
                continue
            dists = face_recognition.face_distance(pool_encodings, enc)
            best_idx = int(np.argmin(dists))
            best_dist = float(dists[best_idx])
            confidence = max(0, round((1 - min(best_dist, 1.0)) * 100))

            if best_dist <= self.tolerance:
                results.append({"name": pool_names[best_idx], "confidence": confidence, "status": "matched"})
            elif best_dist <= rel_tol:
                # Best guess exists but isn't confident enough to auto-mark --
                # goes to the review queue for the teacher to confirm/correct.
                results.append({"name": pool_names[best_idx], "confidence": confidence, "status": "uncertain"})
            else:
                results.append({"name": None, "confidence": confidence, "status": "unknown"})

        return results

    # ---------- attendance logging ----------

    def _append_attendance_row(self, name, status, session_id=None, class_id=None):
        now = datetime.now()
        row = {
            "Name": name,
            "Date": now.date().isoformat(),
            "Time": now.time().strftime("%H:%M:%S"),
            "Status": status,
            "SessionId": session_id or "",
            "ClassId": class_id if class_id is not None else "",
        }
        file_exists = os.path.isfile(self.attendance_file)
        pd.DataFrame([row]).to_csv(self.attendance_file, mode="a", header=not file_exists, index=False)

    def process_attendance_frame(self, frame, marked_students, session_id=None, class_id=None):
        """Process a frame containing potentially multiple faces.
        Auto-marks "matched" faces as Present. "uncertain" faces are
        returned separately (not auto-marked) for the caller to add to a
        per-session review queue."""
        matches = self.recognize_faces(frame, class_id=class_id)
        newly = []
        uncertain = []
        for m in matches:
            if m["status"] == "matched" and m["name"] and m["name"] not in marked_students:
                self._append_attendance_row(m["name"], "Present", session_id, class_id=class_id)
                marked_students.add(m["name"])
                newly.append({"name": m["name"], "confidence": m["confidence"]})
            elif m["status"] == "uncertain":
                uncertain.append({"name": m["name"], "confidence": m["confidence"]})
        return {
            "matches": matches,
            "newly_marked": [n["name"] for n in newly],
            "newly_marked_detail": newly,
            "uncertain": uncertain,
            "present_count": len(marked_students),
        }

    def finalize_session(self, marked_students, session_id=None, class_id=None):
        if class_id is not None:
            all_registered = set(self.get_class_roster_names(class_id))
        else:
            all_registered = set(self.known_face_names)
        absentees = all_registered - marked_students
        for absent_student in absentees:
            self._append_attendance_row(absent_student, "Absent", session_id, class_id=class_id)
        return {"present": sorted(marked_students), "absent": sorted(absentees)}