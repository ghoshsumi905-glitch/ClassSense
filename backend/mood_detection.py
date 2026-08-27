"""
v4 - Two-track classroom cognitive-load monitor.

Redesign vs v3, driven by a real bug found in that version: the old
"looking away" decision used a fake confidence number (derived from
nose-to-chin z-depth) that cleared its own threshold almost every
frame, so "distracted" won regardless of what the face was actually
doing (smile included). See chat for the exact line.

ARCHITECTURE CHANGE: mood and attentiveness are now two INDEPENDENT
state machines, each with their own hysteresis/confirmation, instead
of one cascade where distraction silently overrides everything else.
This matches showing two separate bars above each head.

  ATTENTIVENESS track: attentive, focused, distracted, looking_away,
                        sleepy, yawning
  MOOD track:           happy, sad, angry, furrowed, confused,
                        surprised, fearful, neutral

Per-student calibration ("adjust ratio for each face" instead of one
global ratio for everyone): during the first ~20 good frontal frames,
EACH student's own baseline EAR, MAR, smile geometry, and brow-tension
geometry are recorded. All later detection thresholds for that
student are relative to THEIR baseline, not a fixed number shared by
everyone. This is what the personalized-threshold research recommends
over global constants (faces vary too much in resting geometry for a
single ratio to work for a whole classroom).

Drowsiness now uses PERCLOS (percentage of a rolling time window the
eyes are measured closed) instead of a single-frame check -- PERCLOS
is the standard validated fatigue metric in the drowsiness-detection
literature, distinct from (and more robust than) reacting to one low
EAR sample, which just as easily catches an ordinary blink.

Head pose confidence is now the actual solvePnP reprojection error
(how well the 3D model explains the 2D landmarks), not a made-up
z-depth heuristic.

IMPORTANT SCOPE NOTE (read this before deploying):
This is a behavioral-signal flagging tool, not a diagnostic instrument.
Facial-analysis-based mood/attention detection has real, well-documented
accuracy limits and varies by individual, lighting, and camera angle.
Treat its output as "this student's patterns changed and might be worth
a human check-in," not as a label of stress/depression/anxiety applied
to a person. Route flags to a counselor/staff member for actual
follow-up rather than storing or displaying diagnostic-sounding labels
per-student long-term. Also worth checking your institution's policy on
recording/analyzing student faces before deploying this beyond testing.

--------------------------------------------------------------------
FIXES IN THIS REVISION (see chat for the full writeup):

1. CRASH FIX -- _update_smoothed_emotions() now normalizes the raw
   dict returned by predict_emotion_full() to this class's exact
   emotion_keys set (missing keys filled with 0.0) before it's ever
   stored in person_emotion_history. Previously, on a person's first
   successful emotion read, the RAW external dict was stored as-is,
   and process_frame()'s entropy calculation indexed it with
   smoothed[k] (no .get()). If predict_emotion_full()'s key set ever
   drifted from self.emotion_keys -- different casing, a renamed
   label, a class missing on a given frame -- that line threw an
   uncaught KeyError, which FastAPI turns into a 500. Starlette
   generates that 500 from outside the CORS middleware, so it shows
   up in the browser as a misleading "blocked by CORS policy" error
   instead of the real cause. process_frame() also now reads
   smoothed with .get(k, 0.0) as a second line of defense.
2. _detect_faces() now guards against a None/empty frame instead of
   throwing on frame_bgr.shape.
3. ATTENTIVENESS SCORING FIX -- the "head turned away, but gaze not
   confirmed away" branch in _score_attentiveness() was scoring
   "attentive" as the dominant label (70/20/10 split favoring
   attentive), which is backwards: head_away is only True when head
   pose is confidently NOT front-facing. That branch now leans
   "distracted" instead, with lower confidence than the
   both-signals-agree "looking_away" case above it.
4. CRASH FIX -- _resolve_identity() now coerces whatever
   attendance_system.recognize_face()/recognize_faces() returns to a
   plain string (or None) before storing it in track["name"]. That
   value is used as a dict key everywhere in this class
   (person_down_since, person_baseline, attentiveness_state,
   mood_state, person_emotion_history, etc.). Found via a live Render
   traceback: attendance_system's recognizer was returning a dict
   (e.g. {"name": ..., "confidence": ...}) in some code path instead
   of a plain string, and the first downstream dict-key assignment
   (self.person_down_since[name] = None inside _track_phone_use)
   threw "TypeError: unhashable type: 'dict'" -- another 500 that the
   browser misreported as a CORS block, same failure mode as fix #1.
--------------------------------------------------------------------
"""

"""
Web-service version of ExtendedMoodClassroomMonitor.

All detection math (attentiveness scoring, mood scoring, calibration,
head pose, PERCLOS, identity tracking) is unchanged from the desktop
version. What changed: the desktop version pulled frames from its own
cv2.VideoCapture in a while-loop and drew straight onto a cv2.imshow
window. Here, that loop is replaced with `process_frame(frame,
frame_counter)`, called once per frame the browser sends. It returns a
plain JSON-able list of per-face results instead of drawing on a local
window -- the React frontend draws the overlay boxes/bars itself using
these numbers.

One monitor INSTANCE = one live session, so per-student calibration and
identity tracking correctly persist across frames within that session
(exactly like the desktop version persisted across loop iterations).

CHANGELOG (this revision):
  - Unknown-face bucketing: unresolved faces are still tracked
    internally by a per-track identity key (so two different
    unrecognized students in the same session don't get their
    calibration/state mixed together), but the NAME WRITTEN TO THE
    LOG AND RETURNED TO THE FRONTEND is now a single flat "Unknown"
    instead of "Unknown-0", "Unknown-3", etc. Previously every
    unresolved track minted its own permanent pseudo-student, which
    polluted per-name grouping in session_report.py and the reports
    endpoints in main.py.
  - Live engagement timeline + insight: the monitor now accumulates
    per-minute engagement (100 - cognitive_load) for identified
    students while a session is live, and exposes get_live_insight()
    -- a chart-ready timeline plus a short rule-based narrative for
    the in-progress session, in the same spirit as the AI Weekly
    Report's narrative in main.py (states only numbers actually
    computed from this session, never a diagnostic label). Wire this
    up to a new `/api/mood/insight?session_id=...` endpoint in
    main.py that calls `mood_sessions[session_id]["monitor"].get_live_insight()`.
"""

import time
import csv
import os
import math
import statistics
import numpy as np
import cv2
from collections import defaultdict, deque
import mediapipe as mp

# add:
from emotion import predict_emotion_full

class ExtendedMoodClassroomMonitor:

    ATTENTIVENESS_CATEGORIES = ["attentive", "focused", "distracted", "looking_away", "sleepy", "yawning"]
    MOOD_CATEGORIES = ["happy", "sad", "angry", "furrowed", "confused", "surprised", "fearful", "neutral"]

    ATTENTIVENESS_LOAD = {
        "attentive": 0.05, "focused": 0.0, "distracted": 0.45,
        "looking_away": 0.6, "sleepy": 0.7, "yawning": 0.5,
    }
    MOOD_LOAD = {
        "happy": 0.05, "neutral": 0.15, "surprised": 0.3, "confused": 0.55,
        "furrowed": 0.7, "sad": 0.6, "angry": 0.75, "fearful": 0.75,
    }

    def __init__(self, attendance_system,
                 log_file="cognitive_load_log.csv",
                 detector_frame_interval=16,
                 smoothing_alpha=0.78,
                 confirmation_required=4,
                 top_score_threshold=28.0,
                 top_minus_second_threshold=8.0,
                 entropy_confused_threshold=1.55,
                 rolling_window_samples=20,
                 eye_aspect_ratio_threshold=0.21,
                 mouth_aspect_ratio_threshold=0.5,
                 smile_threshold=0.35,
                 perclos_threshold=0.20,
                 min_calibration_samples=20,
                 yaw_threshold_deg=18.0,
                 pitch_threshold_deg=15.0,
                 head_pose_confidence_floor=0.35,
                 gaze_offset_threshold=0.20,
                 load_weight_attentiveness=0.6,
                 load_weight_mood=0.4,
                 face_detection_confidence=0.35,
                 phone_pitch_threshold_deg=22.0, 
                 phone_use_duration_seconds=5):

        self.attendance = attendance_system
        self.log_file = log_file
        self.detector_frame_interval = detector_frame_interval
        self.smoothing_alpha = smoothing_alpha
        self.confirmation_required = confirmation_required
        self.top_score_threshold = top_score_threshold
        self.top_minus_second_threshold = top_minus_second_threshold
        self.entropy_confused_threshold = entropy_confused_threshold
        self.rolling_window_samples = max(3, rolling_window_samples)

        self.ear_default = eye_aspect_ratio_threshold
        self.mar_default = mouth_aspect_ratio_threshold
        self.smile_default = smile_threshold
        self.perclos_threshold = perclos_threshold
        self.min_calibration_samples = min_calibration_samples

        self.yaw_threshold_deg = yaw_threshold_deg
        self.pitch_threshold_deg = pitch_threshold_deg
        self.head_pose_confidence_floor = head_pose_confidence_floor
        self.gaze_offset_threshold = gaze_offset_threshold

        self.load_weight_attentiveness = load_weight_attentiveness
        self.load_weight_mood = load_weight_mood

        self.emotion_keys = ["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]

        self.mp_face_detection = mp.solutions.face_detection.FaceDetection(
            model_selection=0, min_detection_confidence=face_detection_confidence
        )
        self._haar_fallback = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=True, max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5
        )

        self.person_emotion_history = defaultdict(lambda: {k: 0.0 for k in self.emotion_keys})
        self.person_temporal_context = defaultdict(list)
        self.max_temporal_samples = 10

        self.attentiveness_state = defaultdict(lambda: {"current": "attentive", "candidate": None, "count": 0})
        self.mood_state = defaultdict(lambda: {"current": "neutral", "candidate": None, "count": 0})

        self.person_eye_closed_window = defaultdict(lambda: deque(maxlen=self.rolling_window_samples))
        self.person_load_window = defaultdict(lambda: deque(maxlen=self.rolling_window_samples))

        self.calib_features = ("ear", "mar", "smile", "tension", "gaze")
        self.person_calib_buffers = defaultdict(lambda: {f: [] for f in self.calib_features})
        self.person_baseline = {}

        self._emotion_fail_count = 0

        self.tracks = {}
        self._next_track_id = 0
        self.max_track_miss = 20
        self.track_match_radius_factor = 0.7
        self.reverify_interval = 150

        self._log_header = ["Name", "Attentiveness", "AttConf", "Mood", "MoodConf",
                             "CognitiveLoad", "PERCLOS", "Timestamp", "SessionId"]

        self._model_points_3d = np.array([
            (0.0, 0.0, 0.0), (0.0, -63.6, -12.5),
            (-43.3, 32.7, -26.0), (43.3, 32.7, -26.0),
            (-28.9, -28.9, -24.1), (28.9, -28.9, -24.1),
        ], dtype=np.float64)

        self._LEFT_IRIS = [474, 475, 476, 477]
        self._RIGHT_IRIS = [469, 470, 471, 472]
        self._LEFT_EYE_H = (263, 362)
        self._RIGHT_EYE_H = (33, 133)
        self.phone_pitch_threshold_deg = phone_pitch_threshold_deg
        self.phone_use_duration_seconds = phone_use_duration_seconds
        self.person_down_since = {}
        # Smoothed pitch per student -- raw per-frame pitch is noisy
        # (landmark jitter, small natural head movement), which can flip
        # "looking down" on/off frame-to-frame even during genuine
        # sustained phone use.
        self.person_pitch_smoothed = {}
        self.PHONE_PITCH_SMOOTH_ALPHA = 0.4
        # How many consecutive NOT-looking-down frames are tolerated
        # before the accumulated "down" timer resets. Without this, one
        # brief glance up (or one low-confidence pose frame) wipes out
        # several seconds of genuine sustained down-time and the alert
        # never fires.
        self.PHONE_GRACE_FRAMES = 3
        self.person_down_grace = {}

        # ---- live engagement timeline / insight state (one instance = one live session) ----
        self.session_start_time = time.time()
        # "HH:MM" -> list of instantaneous engagement values (100 - cognitive_load),
        # identified students only (Unknown faces excluded, same rule the reports
        # endpoints in main.py use for the weekly/summary aggregates).
        self._minute_engagement = defaultdict(list)

    # ---------- face detection ----------

    def _detect_faces(self, frame_bgr):
        # Defensive guard: if the decoded frame from main.py is None or
        # empty (a corrupt/short upload, camera not warmed up yet, etc.),
        # bail out with no faces instead of throwing on frame_bgr.shape --
        # that AttributeError was an uncaught-exception crash path just
        # like the emotion-key KeyError below, and would show up in the
        # browser as the same misleading CORS error.
        if frame_bgr is None or getattr(frame_bgr, "size", 0) == 0:
            return []
        h, w = frame_bgr.shape[:2]
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        results = self.mp_face_detection.process(frame_rgb)
        boxes = []
        if results.detections:
            for det in results.detections:
                rb = det.location_data.relative_bounding_box
                x, y = max(0, int(rb.xmin * w)), max(0, int(rb.ymin * h))
                bw, bh = int(rb.width * w), int(rb.height * h)
                if bw > 0 and bh > 0:
                    boxes.append((x, y, bw, bh))
        if not boxes:
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
            boxes = [tuple(b) for b in self._haar_fallback.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))]
        return boxes

    def _extract_landmarks_for_crop(self, face_bgr):
        try:
            face_rgb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)
            results = self.face_mesh.process(face_rgb)
            if not results.multi_face_landmarks:
                return None
            h, w, _ = face_bgr.shape
            lm = results.multi_face_landmarks[0].landmark
            return np.array([(p.x * w, p.y * h, p.z * w) for p in lm], dtype=np.float32)
        except Exception:
            return None

    def _head_pose(self, landmarks, frame_shape):
        try:
            if landmarks is None or len(landmarks) < 468:
                return "UNKNOWN", 0.0, 0.0, 0.0
            h, w = frame_shape[:2]
            image_points = np.array([
                landmarks[1][:2], landmarks[152][:2],
                landmarks[33][:2], landmarks[263][:2],
                landmarks[61][:2], landmarks[291][:2],
            ], dtype=np.float64)
            focal_length = w
            center = (w / 2, h / 2)
            camera_matrix = np.array([[focal_length, 0, center[0]],
                                       [0, focal_length, center[1]],
                                       [0, 0, 1]], dtype=np.float64)
            dist_coeffs = np.zeros((4, 1))
            success, rvec, tvec = cv2.solvePnP(
                self._model_points_3d, image_points, camera_matrix, dist_coeffs,
                flags=cv2.SOLVEPNP_ITERATIVE
            )
            if not success:
                return "UNKNOWN", 0.0, 0.0, 0.0
            projected, _ = cv2.projectPoints(self._model_points_3d, rvec, tvec, camera_matrix, dist_coeffs)
            reproj_error = float(np.mean(np.linalg.norm(projected.reshape(-1, 2) - image_points, axis=1)))
            confidence = max(0.0, min(1.0, 1.0 - reproj_error / 25.0))
            rmat, _ = cv2.Rodrigues(rvec)
            sy = math.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
            pitch = math.degrees(math.atan2(-rmat[2, 0], sy))
            yaw = 0.0 if sy < 1e-6 else math.degrees(math.atan2(rmat[1, 0], rmat[0, 0]))
            if abs(yaw) < self.yaw_threshold_deg and abs(pitch) < self.pitch_threshold_deg:
                direction = "FRONT"
            elif abs(yaw) >= abs(pitch):
                direction = "RIGHT" if yaw > 0 else "LEFT"
            else:
                direction = "DOWN" if pitch > 0 else "UP"
            return direction, confidence, yaw, pitch
        except Exception:
            return "UNKNOWN", 0.0, 0.0, 0.0
    def _track_phone_use(self, name, pitch, direction_confidence):
        now = time.time()
        trustworthy = direction_confidence >= self.head_pose_confidence_floor

        # Smooth pitch per student (EMA) so single-frame noise doesn't
        # flip the looking-down decision. Only smooth when the pose is
        # actually trustworthy -- a noisy/low-confidence reading shouldn't
        # pull the smoothed value around.
        if trustworthy and pitch is not None:
            prev = self.person_pitch_smoothed.get(name)
            smoothed_pitch = pitch if prev is None else (
                self.PHONE_PITCH_SMOOTH_ALPHA * pitch + (1 - self.PHONE_PITCH_SMOOTH_ALPHA) * prev
            )
            self.person_pitch_smoothed[name] = smoothed_pitch
        else:
            smoothed_pitch = self.person_pitch_smoothed.get(name)

        looking_down = trustworthy and smoothed_pitch is not None and smoothed_pitch > self.phone_pitch_threshold_deg

        if looking_down:
            self.person_down_grace[name] = 0
            if self.person_down_since.get(name) is None:
                self.person_down_since[name] = now
            elapsed = now - self.person_down_since[name]
        else:
            grace_used = self.person_down_grace.get(name, 0) + 1
            self.person_down_grace[name] = grace_used
            down_since = self.person_down_since.get(name)
            if down_since is not None and grace_used <= self.PHONE_GRACE_FRAMES:
                # Brief interruption (glance up, one noisy frame) -- keep
                # the accumulated timer running rather than resetting it.
                elapsed = now - down_since
            else:
                # Sustained recovery past the grace window -- genuinely
                # stopped looking down, reset for real.
                self.person_down_since[name] = None
                self.person_down_grace[name] = 0
                elapsed = 0.0

        return elapsed >= self.phone_use_duration_seconds, round(elapsed, 1)

    def _gaze_offset(self, landmarks):
        try:
            if landmarks is None or len(landmarks) < 478:
                return None

            def offset_for(iris_idx, corners):
                iris_center = np.mean(landmarks[iris_idx][:, :2], axis=0)
                left_c, right_c = landmarks[corners[0]][:2], landmarks[corners[1]][:2]
                span = right_c[0] - left_c[0]
                if abs(span) < 1e-3:
                    return 0.0
                ratio = (iris_center[0] - left_c[0]) / span
                return max(-1.0, min(1.0, (ratio - 0.5) * 2.0))

            return (offset_for(self._LEFT_IRIS, self._LEFT_EYE_H) +
                    offset_for(self._RIGHT_IRIS, self._RIGHT_EYE_H)) / 2.0
        except Exception:
            return None

    def _calculate_eye_aspect_ratio(self, landmarks):
        try:
            if landmarks is None or len(landmarks) < 468:
                return None
            left_eye, right_eye = [33, 160, 158, 133, 153, 144], [263, 387, 385, 362, 380, 374]

            def ear(pts):
                v1 = np.linalg.norm(landmarks[pts[1]][:2] - landmarks[pts[5]][:2])
                v2 = np.linalg.norm(landmarks[pts[2]][:2] - landmarks[pts[4]][:2])
                horiz = np.linalg.norm(landmarks[pts[0]][:2] - landmarks[pts[3]][:2])
                return (v1 + v2) / (2.0 * horiz) if horiz > 0 else 0

            val = (ear(left_eye) + ear(right_eye)) / 2.0
            return val if 0 < val < 1.0 else None
        except Exception:
            return None

    def _calculate_mouth_aspect_ratio(self, landmarks):
        try:
            if landmarks is None or len(landmarks) < 468:
                return None
            vertical = np.linalg.norm(landmarks[14][:2] - landmarks[13][:2])
            horizontal = np.linalg.norm(landmarks[291][:2] - landmarks[61][:2])
            val = vertical / horizontal if horizontal > 0 else 0
            return val if 0 <= val < 2.0 else None
        except Exception:
            return None

    def _detect_smile(self, landmarks):
        try:
            if landmarks is None or len(landmarks) < 468:
                return None
            mouth_left, mouth_right = landmarks[61], landmarks[291]
            mouth_top, mouth_bottom = landmarks[13], landmarks[14]
            left_lift = mouth_top[1] - mouth_left[1]
            right_lift = mouth_top[1] - mouth_right[1]
            corner_uplift = max(0.0, min(1.0, ((left_lift + right_lift) / 2) / 15))
            width = np.linalg.norm(mouth_right[:2] - mouth_left[:2])
            height = np.linalg.norm(mouth_bottom[:2] - mouth_top[:2])
            width_score = max(0.0, min(1.0, width / (height * 2.5))) if height > 0 else 0
            return min(1.0, corner_uplift * 0.6 + width_score * 0.4)
        except Exception:
            return None

    def _calculate_facial_tension(self, landmarks):
        try:
            if landmarks is None or len(landmarks) < 468:
                return None
            left_brow, right_brow, forehead = landmarks[46], landmarks[276], landmarks[10]
            avg_brow_dist = (abs(forehead[1] - left_brow[1]) + abs(forehead[1] - right_brow[1])) / 2
            tension_from_brows = 1.0 - min(avg_brow_dist / 50, 1.0)
            left_lip, right_lip = landmarks[61], landmarks[291]
            lip_width = np.linalg.norm(right_lip[:2] - left_lip[:2])
            nose_left, nose_right = landmarks[35], landmarks[266]
            nose_width = np.linalg.norm(nose_right[:2] - nose_left[:2])
            lip_tightness = 1.0 - min(lip_width / nose_width / 2, 1.0) if nose_width > 0 else 0.5
            return min((tension_from_brows + lip_tightness) / 2.0, 1.0)
        except Exception:
            return None

    def _update_calibration(self, name, head_direction, ear, mar, smile, tension, gaze):
        if name in self.person_baseline:
            return
        if head_direction != "FRONT":
            return
        buf = self.person_calib_buffers[name]
        for feat, val in (("ear", ear), ("mar", mar), ("smile", smile), ("tension", tension), ("gaze", gaze)):
            if val is not None:
                buf[feat].append(val)
        if all(len(buf[f]) >= self.min_calibration_samples for f in self.calib_features):
            self.person_baseline[name] = {f: statistics.median(buf[f]) for f in self.calib_features}

    def _baseline(self, name, feature, fallback):
        b = self.person_baseline.get(name)
        return b[feature] if b else fallback

    def _match_faces_to_tracks(self, boxes):
        centroids = [(x + w / 2, y + h / 2, w) for (x, y, w, h) in boxes]
        matched_track_ids = set()
        assignments = [None] * len(boxes)

        for i, (cx, cy, w) in enumerate(centroids):
            best_id, best_dist = None, None
            for tid, t in self.tracks.items():
                if tid in matched_track_ids:
                    continue
                tcx, tcy = t["centroid"]
                dist = math.hypot(cx - tcx, cy - tcy)
                radius = max(t.get("width", w), w) * self.track_match_radius_factor
                if dist <= radius and (best_dist is None or dist < best_dist):
                    best_id, best_dist = tid, dist
            if best_id is not None:
                assignments[i] = best_id
                matched_track_ids.add(best_id)
                self.tracks[best_id]["centroid"] = (cx, cy)
                self.tracks[best_id]["width"] = w
                self.tracks[best_id]["miss_count"] = 0
            else:
                new_id = self._next_track_id
                self._next_track_id += 1
                self.tracks[new_id] = {
                    "centroid": (cx, cy), "width": w, "name": None,
                    "resolved": False, "miss_count": 0, "frames_seen": 0,
                }
                assignments[i] = new_id

        seen_ids = set(assignments)
        for tid in list(self.tracks.keys()):
            if tid not in seen_ids:
                self.tracks[tid]["miss_count"] += 1
                if self.tracks[tid]["miss_count"] > self.max_track_miss:
                    del self.tracks[tid]

        return list(zip(assignments, boxes))

    def _resolve_identity(self, track_id, face_crop):
        """Returns the INTERNAL identity key for this track -- either the
        recognized student's name, or a per-track placeholder like
        "Unknown-3". This key is deliberately kept unique per track (not
        collapsed to a single "Unknown") because it's used everywhere below
        to key calibration buffers and attentiveness/mood state machines --
        collapsing it here would mix two different unrecognized students'
        baselines and hysteresis state together.

        Anything that goes to the FRONTEND or the CSV LOG should instead use
        `_display_name()` below, which buckets every unresolved track down
        to a flat "Unknown" so reports don't get one row-group per track."""
        track = self.tracks[track_id]
        track["frames_seen"] += 1
        due_for_recheck = track["resolved"] and (track["frames_seen"] % self.reverify_interval == 0)

        if not track["resolved"] or due_for_recheck:
            try:
                # Backward-compatible path: prefer single-face API if present.
                if hasattr(self.attendance, "recognize_face"):
                    recognized = self.attendance.recognize_face(face_crop)
                else:
                    # Newer AttendanceSystem exposes recognize_faces().
                    names = self.attendance.recognize_faces(face_crop)
                    recognized = names[0] if names else None
            except Exception:
                recognized = None

            # DEFENSIVE NORMALIZATION -- attendance_system's recognizer can
            # return a dict (e.g. {"name": "...", "confidence": ...}) instead
            # of a plain string in some code paths. Every value stored in
            # track["name"] is later used as a dict key all over this class
            # (person_down_since, person_baseline, attentiveness_state,
            # mood_state, person_emotion_history, etc.), and a dict is
            # unhashable -- that's what was crashing _track_phone_use with
            # "TypeError: unhashable type: 'dict'" (a 500 on
            # /api/mood/frame, which the browser then misreports as a CORS
            # block). Coerce to a plain string here, once, instead of
            # guarding every downstream dict-key usage individually.
            if isinstance(recognized, dict):
                recognized = recognized.get("name") or recognized.get("label") or None
            elif recognized is not None and not isinstance(recognized, str):
                recognized = str(recognized)

            if recognized and recognized != "Unknown":
                track["name"] = recognized
                track["resolved"] = True
            elif not track["resolved"]:
                track["name"] = f"Unknown-{track_id}"

        return track["name"]

    @staticmethod
    def _display_name(internal_name):
        """Bucket any per-track "Unknown-N" placeholder down to a flat
        "Unknown" for anything user-facing (frontend overlay, CSV log,
        downstream reports). Recognized names pass through unchanged."""
        return "Unknown" if str(internal_name).startswith("Unknown") else internal_name

    def _analyze_emotions_for_face(self, face_bgr):
        try:
            result = predict_emotion_full(face_bgr)
            total = sum(result.values())
            if not (50 <= total <= 150):
                return None
            return result
        except Exception:
            self._emotion_fail_count += 1
            return None

    def _update_smoothed_emotions(self, name, current):
        # Normalize to this class's exact key set BEFORE it ever gets
        # stored in person_emotion_history. predict_emotion_full() is an
        # external dependency; if its keys ever drift from self.emotion_keys
        # (casing, a renamed/missing class on a given frame), storing the
        # raw dict as-is used to let a later `smoothed[k]` lookup in
        # process_frame() throw an uncaught KeyError -> FastAPI 500 ->
        # shows up in the browser as a misleading CORS error, since
        # Starlette generates that 500 response outside the CORS
        # middleware. Coercing to floats also protects against a stray
        # None/non-numeric value from the model.
        current = {k: float(current.get(k, 0.0) or 0.0) for k in self.emotion_keys}

        self.person_temporal_context[name].append(current.copy())
        if len(self.person_temporal_context[name]) > self.max_temporal_samples:
            self.person_temporal_context[name].pop(0)
        prev = self.person_emotion_history[name]
        if not any(prev.values()):
            self.person_emotion_history[name] = current.copy()
            return self.person_emotion_history[name]
        a = self.smoothing_alpha
        updated = {k: a * current.get(k, 0.0) + (1 - a) * prev.get(k, 0.0) for k in self.emotion_keys}
        self.person_emotion_history[name] = updated
        return updated

    def _entropy(self, probs_percent):
        probs = [max(p / 100.0, 1e-12) for p in probs_percent]
        total = sum(probs)
        if total <= 0:
            return 0.0
        probs = [p / total for p in probs]
        return -sum(p * math.log(p) for p in probs)

    def _score_attentiveness(self, name, head_direction, direction_confidence, gaze_offset, ear, mar):
        scores = {c: 0.0 for c in self.ATTENTIVENESS_CATEGORIES}
        ear_baseline = self._baseline(name, "ear", None)
        ear_threshold = (ear_baseline * 0.78) if ear_baseline else self.ear_default
        eye_closed = ear is not None and ear < ear_threshold
        self.person_eye_closed_window[name].append(1 if eye_closed else 0)
        window = self.person_eye_closed_window[name]
        perclos = sum(window) / len(window) if window else 0.0
        is_sleepy = len(window) >= max(5, self.rolling_window_samples // 3) and perclos >= self.perclos_threshold

        mar_baseline = self._baseline(name, "mar", None)
        mar_threshold = (mar_baseline * 1.9) if mar_baseline else self.mar_default
        is_yawning = mar is not None and mar > mar_threshold

        gaze_baseline = self._baseline(name, "gaze", 0.0)
        gaze_deviation = abs((gaze_offset - gaze_baseline)) if gaze_offset is not None else None
        gaze_away = gaze_deviation is not None and gaze_deviation > self.gaze_offset_threshold

        trustworthy_pose = direction_confidence >= self.head_pose_confidence_floor
        head_away = trustworthy_pose and head_direction not in ("FRONT", "UNKNOWN")

        if head_away and gaze_away:
            scores["looking_away"] = 90.0
        elif gaze_away:
            scores["distracted"] = 75.0
            scores["attentive"] = 25.0
        elif head_away:
            # FIX: head pose is confidently NOT front-facing here (that's
            # what head_away means). Gaze not also confirming it doesn't
            # make this "attentive" -- it just means we're less sure it's
            # full looking_away. Lean distracted, softer than the
            # both-signals-agree branch above.
            scores["distracted"] = 55.0
            scores["looking_away"] = 20.0
            scores["focused"] = 15.0
            scores["attentive"] = 10.0
        elif is_yawning:
            scores["yawning"] = 85.0
            scores["attentive"] = 15.0
        elif is_sleepy:
            scores["sleepy"] = 85.0
            scores["attentive"] = 15.0
        else:
            entropy_ok = gaze_deviation is None or gaze_deviation < self.gaze_offset_threshold * 0.4
            if entropy_ok:
                scores["focused"] = 60.0
                scores["attentive"] = 40.0
            else:
                scores["attentive"] = 90.0
                scores["focused"] = 10.0

        total = sum(scores.values())
        if total > 0:
            scores = {k: (v / total) * 100.0 for k, v in scores.items()}
        return scores, perclos

    def _score_mood(self, name, smoothed_emotion, entropy_val, smile, tension):
        scores = {c: 0.0 for c in self.MOOD_CATEGORIES}
        smile_baseline = self._baseline(name, "smile", None)
        smile_delta = (smile - smile_baseline) if (smile is not None and smile_baseline is not None) else smile
        is_smiling = (smile_delta is not None and smile_delta > self.smile_default) or smoothed_emotion.get("happy", 0.0) > 45

        tension_baseline = self._baseline(name, "tension", None)
        tension_delta = (tension - tension_baseline) if (tension is not None and tension_baseline is not None) else tension
        is_furrowed = tension_delta is not None and tension_delta > 0.22

        is_sad = smoothed_emotion.get("sad", 0.0) > 42
        is_angry = smoothed_emotion.get("angry", 0.0) > 50 or smoothed_emotion.get("disgust", 0.0) > 50
        is_fearful = smoothed_emotion.get("fear", 0.0) > 50
        is_surprised = smoothed_emotion.get("surprise", 0.0) > 50
        is_confused = entropy_val > self.entropy_confused_threshold and not is_surprised

        if is_smiling:
            scores["happy"] = 85.0; scores["neutral"] = 15.0
        elif is_angry:
            scores["angry"] = 85.0; scores["neutral"] = 15.0
        elif is_furrowed:
            scores["furrowed"] = 80.0; scores["neutral"] = 20.0
        elif is_fearful:
            scores["fearful"] = 80.0; scores["neutral"] = 20.0
        elif is_sad:
            scores["sad"] = 80.0; scores["neutral"] = 20.0
        elif is_surprised:
            scores["surprised"] = 75.0; scores["neutral"] = 25.0
        elif is_confused:
            scores["confused"] = 75.0; scores["neutral"] = 25.0
        else:
            scores["neutral"] = 90.0

        total = sum(scores.values())
        if total > 0:
            scores = {k: (v / total) * 100.0 for k, v in scores.items()}
        return scores

    def _decide_label(self, state_dict, scores):
        sorted_items = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        top, top_score = sorted_items[0]
        second = sorted_items[1][1] if len(sorted_items) > 1 else 0.0
        confident = top_score >= self.top_score_threshold and (top_score - second) >= self.top_minus_second_threshold

        if confident and top == state_dict["current"]:
            state_dict["candidate"], state_dict["count"] = None, 0
            return state_dict["current"], top_score
        if confident:
            if state_dict["candidate"] == top:
                state_dict["count"] += 1
            else:
                state_dict["candidate"], state_dict["count"] = top, 1
            if state_dict["count"] >= self.confirmation_required:
                state_dict["current"] = state_dict["candidate"]
                state_dict["candidate"], state_dict["count"] = None, 0
            return state_dict["current"], top_score
        state_dict["candidate"], state_dict["count"] = None, 0
        return state_dict["current"], scores.get(state_dict["current"], 0.0)

    def _cognitive_load(self, attentiveness_label, mood_label, perclos, entropy_val):
        a = self.ATTENTIVENESS_LOAD.get(attentiveness_label, 0.3)
        m = self.MOOD_LOAD.get(mood_label, 0.2)
        entropy_norm = min(entropy_val / math.log(len(self.emotion_keys)), 1.0)
        score = (self.load_weight_attentiveness * a + self.load_weight_mood * m
                 + 0.1 * perclos + 0.1 * entropy_norm)
        return max(0.0, min(1.0, score)) * 100.0

    def _update_load_window(self, name, instant):
        self.person_load_window[name].append(instant)
        w = self.person_load_window[name]
        return sum(w) / len(w) if w else 0.0

    def _record_live_engagement(self, display_name, engagement):
        """Feeds the current-session per-minute engagement accumulator used
        by get_live_insight(). Unknown faces are excluded -- same rule the
        reports endpoints in main.py already apply -- since an unresolved
        track isn't a real student the class-level insight should be about."""
        if display_name == "Unknown":
            return
        minute_key = time.strftime("%H:%M")
        self._minute_engagement[minute_key].append(max(0.0, min(100.0, engagement)))

    def get_live_insight(self):
        """Live Engagement Timeline + Insight for the CURRENT, in-progress
        session. This instance is scoped to exactly one live session (see
        mood_sessions in main.py), so everything here is naturally
        session-local -- no SessionId filtering needed the way the
        historical CSV-based reports require it.

        Returns a chart-ready per-minute timeline plus a short rule-based
        narrative. Mirrors the reasoning behind _weekly_trend_narrative in
        main.py: only ever states numbers actually computed this session,
        so it can't hallucinate a trend that isn't there, and it never
        applies a diagnostic label to a student -- at most "worth a
        check-in."

        Not yet wired to an endpoint -- add something like:

            @app.get("/api/mood/insight")
            def mood_insight(session_id: str):
                if session_id not in mood_sessions:
                    raise HTTPException(status_code=404, detail="Unknown session_id.")
                return mood_sessions[session_id]["monitor"].get_live_insight()

        to main.py to expose this to the frontend.
        """
        if not self._minute_engagement:
            return {"available": False}

        timeline = [
            {"t": minute, "engagement": round(statistics.mean(vals))}
            for minute, vals in sorted(self._minute_engagement.items())
        ]
        all_values = [v for vals in self._minute_engagement.values() for v in vals]
        avg_engagement = round(statistics.mean(all_values)) if all_values else 0
        elapsed_minutes = round((time.time() - self.session_start_time) / 60, 1)

        narrative_parts = [
            f"The class has averaged {avg_engagement}% engagement over the "
            f"{elapsed_minutes} minute(s) logged so far this session."
        ]

        if len(timeline) >= 4:
            half = len(timeline) // 2
            first_half_avg = statistics.mean(t["engagement"] for t in timeline[:half])
            second_half_avg = statistics.mean(t["engagement"] for t in timeline[half:])
            delta = second_half_avg - first_half_avg
            if delta <= -8:
                narrative_parts.append("Engagement has dropped noticeably as the session has gone on.")
            elif delta >= 8:
                narrative_parts.append("Engagement has picked up as the session has gone on.")
            else:
                narrative_parts.append("Engagement has stayed fairly steady through the session.")

        if avg_engagement < 65:
            narrative_parts.append("Worth a quick check-in with the room.")

        return {
            "available": True,
            "elapsedMinutes": elapsed_minutes,
            "avgEngagement": avg_engagement,
            "timeline": timeline,
            "narrative": " ".join(narrative_parts),
        }

    # ---------- THE NEW PUBLIC ENTRY POINT: one frame in, JSON out ----------

    def process_frame(self, frame, frame_counter, session_id=None, run_emotion_model=True):
        """Replaces the body of the old run_monitoring_session while-loop.
        Call this once per frame the browser sends. Returns a list of dicts
        (one per detected face) that the frontend uses to draw boxes/bars,
        plus appends log rows exactly like the desktop version did."""
        faces = self._detect_faces(frame)
        tracked_faces = self._match_faces_to_tracks(faces)
        results = []
        log_rows = []

        for (track_id, (x, y, w, h)) in tracked_faces:
            pad = int(0.15 * w)
            x1, y1 = max(0, x - pad), max(0, y - pad)
            x2, y2 = min(frame.shape[1], x + w + pad), min(frame.shape[0], y + h + pad)
            face_crop = frame[y1:y2, x1:x2]
            if face_crop.size == 0:
                continue

            # `name` is the internal identity key (e.g. "Unknown-3") used for
            # per-track calibration/state below. `display_name` is what
            # actually reaches the frontend and the CSV log.
            name = self._resolve_identity(track_id, face_crop)
            display_name = self._display_name(name)
            landmarks = self._extract_landmarks_for_crop(face_crop)

            head_direction, direction_confidence, yaw, pitch = self._head_pose(landmarks, face_crop.shape)
            phone_alert, seconds_looking_down = self._track_phone_use(name, pitch, direction_confidence)
            gaze_offset = self._gaze_offset(landmarks)
            ear = self._calculate_eye_aspect_ratio(landmarks)
            mar = self._calculate_mouth_aspect_ratio(landmarks)
            smile = self._detect_smile(landmarks)
            tension = self._calculate_facial_tension(landmarks)

            self._update_calibration(name, head_direction, ear, mar, smile, tension, gaze_offset)

            if run_emotion_model and frame_counter % self.detector_frame_interval == 0:
                raw = self._analyze_emotions_for_face(face_crop)
                smoothed = self._update_smoothed_emotions(name, raw) if raw else self.person_emotion_history[name]
            else:
                smoothed = self.person_emotion_history[name]

            # .get(k, 0.0) here (not smoothed[k]) is the second line of
            # defense against a key-set mismatch from the emotion model --
            # see _update_smoothed_emotions for the primary fix.
            entropy_val = self._entropy([smoothed.get(k, 0.0) for k in self.emotion_keys]) if smoothed else 0.0

            att_scores, perclos = self._score_attentiveness(name, head_direction, direction_confidence, gaze_offset, ear, mar)
            mood_scores = self._score_mood(name, smoothed or {}, entropy_val, smile, tension)

            att_label, att_conf = self._decide_label(self.attentiveness_state[name], att_scores)
            mood_label, mood_conf = self._decide_label(self.mood_state[name], mood_scores)

            instant_load = self._cognitive_load(att_label, mood_label, perclos, entropy_val)
            smoothed_load = self._update_load_window(name, instant_load)

            # Live Engagement Timeline + Insight: feed this frame's engagement
            # (inverse of cognitive load, same convention main.py's reports
            # use) into the current session's per-minute accumulator.
            self._record_live_engagement(display_name, 100.0 - smoothed_load)

            results.append({
                "name": display_name,
                "box": {"x": int(x1), "y": int(y1), "w": int(x2 - x1), "h": int(y2 - y1)},
                "attentiveness": att_label, "attentiveness_confidence": round(float(att_conf), 1),
                "mood": mood_label, "mood_confidence": round(float(mood_conf), 1),
                "cognitive_load": round(float(smoothed_load), 1),
                "perclos": round(float(perclos), 3),
                # include per-emotion probabilities so the frontend can render the full
                # FERPlus-derived distribution (keys match self.emotion_keys)
                "emotion_probs": {k: round(float(smoothed.get(k, 0.0)), 1) for k in self.emotion_keys} if smoothed else {},
                "phone_alert": phone_alert,
                "seconds_looking_down": seconds_looking_down,
            })

            if frame_counter % self.detector_frame_interval == 0:
                timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
                log_rows.append([display_name, att_label, f"{att_conf:.1f}", mood_label, f"{mood_conf:.1f}",
                                  f"{smoothed_load:.2f}", f"{perclos:.2f}", timestamp, session_id or ""])

        if log_rows:
            self._append_log_rows(log_rows)

        return results

    def _append_log_rows(self, rows):
        file_exists = os.path.isfile(self.log_file)
        with open(self.log_file, "a", newline="") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(self._log_header)
            writer.writerows(rows)