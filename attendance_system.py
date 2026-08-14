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
"""

import os
import time
import numpy as np
import pandas as pd
import cv2
import face_recognition
from datetime import datetime


class AttendanceSystem:
    def __init__(self, dataset_dir="registered_faces", attendance_file="attendance.csv", tolerance=0.50, face_db_path=None):
        """If FACE_DB_PATH (or face_db_path) is provided, face encodings are persisted
        into a SQLite database there. If not provided, the original filesystem-based
        "registered_faces" folder behavior is preserved.
        """
        import sqlite3
        import pickle

        self.dataset_dir = dataset_dir
        self.attendance_file = attendance_file
        self.tolerance = tolerance
        self.known_face_encodings = []
        self.known_face_names = []

        # Optional persistent DB for face encodings. Controlled by env var FACE_DB_PATH
        self.face_db_path = os.environ.get("FACE_DB_PATH") or face_db_path
        self.use_db = bool(self.face_db_path)
        if self.use_db:
            # initialize DB connection and table
            self._db_conn = sqlite3.connect(self.face_db_path, check_same_thread=False)
            cur = self._db_conn.cursor()
            cur.execute("""CREATE TABLE IF NOT EXISTS faces (
                            name TEXT,
                            encoding BLOB
                          )""")
            self._db_conn.commit()
            # load encodings from DB
            self._load_encodings_from_db()
        else:
            # fallback to filesystem-based load (original behavior)
            self.load_registered_faces(self.dataset_dir)

    def load_registered_faces(self, folder_path):
        """Filesystem loading path preserved for backward compatibility. If
        FACE_DB_PATH is enabled the DB-backed loader is used instead and this
        method is not required for startup loading.
        """
        if self.use_db:
            # DB-backed load handled in __init__ via _load_encodings_from_db
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
        """Load pickled numpy encodings from the faces table."""
        import pickle
        cur = self._db_conn.cursor()
        cur.execute("SELECT name, encoding FROM faces")
        rows = cur.fetchall()
        self.known_face_encodings = []
        self.known_face_names = []
        for name, blob in rows:
            try:
                enc = pickle.loads(blob)
                self.known_face_encodings.append(enc)
                self.known_face_names.append(name)
            except Exception as e:
                print(f"Failed to deserialize encoding for {name}: {e}")

        print(f"Loaded {len(self.known_face_encodings)} face sample(s) for "
              f"{len(set(self.known_face_names))} student(s) (from DB).")

    def register_face_images(self, name, image_bgr_list, max_images=20):
        """Saves registration photos (up to `max_images`) and stores corresponding face encodings.

        - Limits captured images to max_images (default 20) to improve robustness.
        - Writes JPEGs to dataset_dir and computes encodings; stores encodings in DB if configured.
        """
        import pickle

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
            # compute encoding from saved file (face_recognition expects RGB-loaded image)
            try:
                img = face_recognition.load_image_file(path)
                encs = face_recognition.face_encodings(img)
                if encs:
                    encodings_to_save.append(encs[0])
            except Exception as e:
                print(f"Warning: failed to compute encoding for {path}: {e}")

        # Persist encodings to DB if enabled. Replace any existing encodings for this name.
        if self.use_db and encodings_to_save:
            cur = self._db_conn.cursor()
            cur.execute("DELETE FROM faces WHERE name = ?", (name.lower(),))
            for enc in encodings_to_save:
                try:
                    blob = pickle.dumps(enc)
                    cur.execute("INSERT INTO faces (name, encoding) VALUES (?, ?)", (name.lower(), blob))
                except Exception as e:
                    print(f"Warning: could not save encoding to DB for {name}: {e}")
            self._db_conn.commit()
            # reload in-memory arrays from DB
            self._load_encodings_from_db()
        else:
            # fallback: reload from filesystem (original behavior)
            self.load_registered_faces(self.dataset_dir)

        return saved

    def recognize_faces(self, frame):
        """Return a list of recognized names found in the frame. Uses two-pass
        matching: primary tolerance and an optional relaxed tolerance to try and
        capture partial/blurred faces. Returns list of names (lowercased) or "Unknown-<i>" placeholders.
        """
        results = []
        if len(self.known_face_encodings) == 0:
            return []

        small = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)
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
                # relaxed second pass to handle partial/blur faces
                rel_tol = min(0.9, self.tolerance * 1.25)
                if best_dist <= rel_tol:
                    results.append(self.known_face_names[best_idx])
                else:
                    results.append(f"Unknown-{i}")
        return results

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
        a dict with list of names seen, newly marked count, and present_count.
        """
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