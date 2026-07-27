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
    def __init__(self, dataset_dir="registered_faces", attendance_file="attendance.csv", tolerance=0.50):
        self.dataset_dir = dataset_dir
        self.attendance_file = attendance_file
        self.tolerance = tolerance
        self.known_face_encodings = []
        self.known_face_names = []
        self.load_registered_faces(self.dataset_dir)

    def load_registered_faces(self, folder_path):
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

    def register_face_images(self, name, image_bgr_list):
        """Saves a list of already-captured frames (sent from the browser)
        as this student's registration photos. Replaces the old
        space-bar-driven capture loop -- the browser does the multi-angle
        capture UI now; this just persists whatever frames it sends."""
        person_folder = os.path.join(self.dataset_dir, name.lower())
        os.makedirs(person_folder, exist_ok=True)
        for f in os.listdir(person_folder):
            os.remove(os.path.join(person_folder, f))

        saved = 0
        for i, frame in enumerate(image_bgr_list):
            path = os.path.join(person_folder, f"{name.lower()}_{i}.jpg")
            cv2.imwrite(path, frame)
            saved += 1

        self.load_registered_faces(self.dataset_dir)
        return saved

    def recognize_face(self, frame):
        if len(self.known_face_encodings) == 0:
            return "Unknown"

        small = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)

        locations = face_recognition.face_locations(rgb)
        if len(locations) == 0:
            return "Unknown"

        encodings = face_recognition.face_encodings(rgb, locations)

        for enc in encodings:
            dists = face_recognition.face_distance(self.known_face_encodings, enc)
            best_idx = np.argmin(dists)
            best_dist = dists[best_idx]
            if best_dist <= self.tolerance:
                return self.known_face_names[best_idx]

        return "Unknown"

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
        """One frame in, one result out. Called per frame the browser sends
        during an active attendance session. `marked_students` is the
        session's running set (kept by the caller across calls)."""
        name = self.recognize_face(frame)
        newly_marked = False
        if name != "Unknown" and name not in marked_students:
            self._append_attendance_row(name, "Present", session_id)
            marked_students.add(name)
            newly_marked = True
        return {"name": name, "newly_marked": newly_marked, "present_count": len(marked_students)}

    def finalize_session(self, marked_students, session_id=None):
        all_registered = set(self.known_face_names)
        absentees = all_registered - marked_students
        for absent_student in absentees:
            self._append_attendance_row(absent_student, "Absent", session_id)
        return {"present": sorted(marked_students), "absent": sorted(absentees)}