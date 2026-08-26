"""
ClassSense API — the bridge between your React frontend (browser camera)
and your Python detection logic (attendance_system.py, mood_detection.py).

Flow:
  1. Browser captures frames from the user's webcam via getUserMedia().
  2. Frontend POSTs each frame (as JPEG bytes) to this API.
  3. This API decodes the frame, runs it through your existing detection
     code, and returns JSON results.
  4. Frontend draws the boxes/bars/charts using those JSON numbers.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Then your frontend calls http://localhost:8000/... during development,
and your deployed backend URL (e.g. https://classsense-api.onrender.com)
in production.

CHANGELOG (this revision):
  - Classes & roster: SchoolClass/Student now live in the DB (models.py).
    A class is created at login (professor + year + period), a roster is
    bulk-imported under it, and each Student's consent_status and
    face_registered flag are tracked per class -- this is what the
    Students page should read going forward instead of deriving names
    from cognitive_load_log.csv, since a student now exists independently
    of whether they've had a monitored session yet.
  - Lesson segments: a teacher can mark "we're in lecture / group_work /
    quiz / discussion" mid-session. /api/mood/frame now looks up whichever
    segment is currently open for that session_id and stamps it onto each
    EmotionEvent row as it's written, so segment-level engagement falls
    out of data already being logged.
  - Interventions: a teacher can record a note against a class/session/
    segment, and /api/classes/{id}/interventions/effectiveness compares
    that segment's engagement in the session right before vs. right after
    -- an honest average-delta comparison, not a trained model.
  - BUGFIX: removed a duplicate /api/students/{student_id}/consent route.
    Two identical route paths were declared; FastAPI matches routes in
    declaration order, so the first (correct) one was always winning, but
    the second was dead code that referenced a nonexistent payload.status
    field (ConsentPayload only has consent_status) -- would have thrown
    an AttributeError -> 500 if it were ever reachable. Deleted the
    duplicate rather than leave a landmine in the file.

STILL BLOCKED: recognition confidence scores + review queue + manual
correction (the "uncertain match" workflow) depend entirely on
attendance_system.py's recognition internals, which haven't been shared
yet. Nothing here should be read as that being done -- it isn't started.
"""
import os
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

import uuid
import statistics
from typing import Optional, List
import numpy as np
import cv2
import pandas as pd
import asyncio
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from attendance_system import AttendanceSystem
from mood_detection import ExtendedMoodClassroomMonitor
from session_report import generate_report

# DB and monitoring helpers
import sqlite3
import json
import io
import base64
from collections import defaultdict
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
from monitor_flags import evaluate_user_events

app = FastAPI(title="ClassSense API")

# Allow your Vercel frontend (and localhost during dev) to call this API.
# Replace "*" with your actual Vercel URL before going to production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: restrict to ["https://class-sense-prototype-classsense.vercel.app"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- shared, process-wide state -------------------------------------------
# AttendanceSystem now reads DB_URL from the environment itself (Postgres
# via Neon/Supabase in production), falling back to local filesystem if
# DB_URL isn't set. See attendance_system.py.
attendance_system = AttendanceSystem(dataset_dir="registered_faces", attendance_file="attendance.csv")

# Initialize DB (SQLAlchemy). Use DB_URL env var for Postgres in production; fallback to sqlite file.
from db import SQLALCHEMY_AVAILABLE
if SQLALCHEMY_AVAILABLE:
    from db import engine, SessionLocal
    from models import Base, EmotionEvent, Flag, SchoolClass, Student, LessonSegment, Intervention
    Base.metadata.create_all(bind=engine)

    def get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()
else:
    # sqlite3 fallback (no SQLAlchemy installed, or no DB_URL set)
    MOOD_DB_PATH = os.environ.get("MOOD_DB_PATH") or "mood_events.db"
    _sqlite_conn = sqlite3.connect(MOOD_DB_PATH, check_same_thread=False)
    _sqlite_cur = _sqlite_conn.cursor()
    _sqlite_cur.execute("""
    CREATE TABLE IF NOT EXISTS emotion_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        recognized_name TEXT,
        session_id TEXT,
        ts TEXT NOT NULL,
        emotion_probs TEXT NOT NULL,
        source TEXT,
        meta TEXT
    )
    """)
    _sqlite_cur.execute("""
    CREATE TABLE IF NOT EXISTS flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        recognized_name TEXT,
        ts TEXT NOT NULL,
        reason TEXT,
        metrics TEXT,
        severity TEXT,
        status TEXT DEFAULT 'open',
        reviewed_by TEXT,
        reviewed_at TEXT,
        meta TEXT
    )
    """)
    _sqlite_conn.commit()

    def _sqlite_insert_event(user_id, name, session_id, ts, ep_json, source, meta_json):
        try:
            _sqlite_cur.execute(
                "INSERT INTO emotion_events (user_id, recognized_name, session_id, ts, emotion_probs, source, meta) VALUES (?,?,?,?,?,?,?)",
                (user_id, name, session_id, ts, ep_json, source, meta_json)
            )
            _sqlite_conn.commit()
        except Exception:
            _sqlite_conn.rollback()

    def _sqlite_fetch_events(user_id=None, name=None, from_date=None, to_date=None):
        clauses, params = [], []
        if user_id:
            clauses.append("user_id = ?"); params.append(user_id)
        if name:
            clauses.append("recognized_name = ?"); params.append(name)
        if from_date:
            clauses.append("ts >= ?"); params.append(from_date)
        if to_date:
            clauses.append("ts <= ?"); params.append(to_date)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        q = f"SELECT ts, emotion_probs FROM emotion_events{where} ORDER BY ts ASC"
        _sqlite_cur.execute(q, params)
        return _sqlite_cur.fetchall()

    def _sqlite_fetch_all_since(cutoff_iso):
        _sqlite_cur.execute(
            "SELECT user_id, recognized_name, ts, emotion_probs FROM emotion_events WHERE ts >= ?",
            (cutoff_iso,)
        )
        return _sqlite_cur.fetchall()

    def _sqlite_insert_flag(user_id, name, ts, reason, metrics_json, severity, status):
        _sqlite_cur.execute(
            "INSERT INTO flags (user_id, recognized_name, ts, reason, metrics, severity, status) VALUES (?,?,?,?,?,?,?)",
            (user_id, name, ts, reason, metrics_json, severity, status)
        )
        _sqlite_conn.commit()

# Create a bounded ThreadPoolExecutor for mood inference tasks
import concurrent.futures
MAX_WORKERS = int(os.environ.get("MOOD_WORKERS", max(2, (os.cpu_count() or 2)//2)))
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS)

# In-memory session registries. Fine for a single-instance deployment;
# if you ever scale to multiple server instances, move this to Redis.
attendance_sessions = {}  # session_id -> {"marked": set(), "class_name": str}
# mood_sessions now also carries an optional "class_id" so /api/mood/frame
# can stamp EmotionEvent rows with the class they belong to -- needed for
# per-class/per-segment engagement aggregation below.
mood_sessions = {}        # session_id -> {"monitor": ..., "frame_counter": int, "class_id": int|None}


def _read_upload_as_bgr(file_bytes: bytes):
    arr = np.frombuffer(file_bytes, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")
    return frame


def _require_db():
    if not SQLALCHEMY_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="This feature requires SQLAlchemy + DB_URL to be configured (see db.py)."
        )


# ─── Classes & Roster ───────────────────────────────────────────────────────

class ClassCreatePayload(BaseModel):
    professor_name: str
    class_year: str
    period_id: Optional[str] = None
    period_label: Optional[str] = None


@app.post("/api/classes")
def create_class(payload: ClassCreatePayload):
    _require_db()
    db = SessionLocal()
    try:
        cls = SchoolClass(
            professor_name=payload.professor_name, class_year=payload.class_year,
            period_id=payload.period_id, period_label=payload.period_label,
        )
        db.add(cls)
        db.commit()
        db.refresh(cls)
        return {
            "class_id": cls.id, "professor_name": cls.professor_name, "class_year": cls.class_year,
            "period_id": cls.period_id, "period_label": cls.period_label,
        }
    finally:
        db.close()

@app.get("/api/classes")
def list_classes(class_year: Optional[str] = None):
    if not SQLALCHEMY_AVAILABLE:
        return {"classes": []}
    db = SessionLocal()
    try:
        q = db.query(SchoolClass)
        if class_year:
            q = q.filter(SchoolClass.class_year == class_year)
        rows = q.order_by(SchoolClass.created_at.desc()).all()
        return {"classes": [
            {
                "id": c.id, "professor_name": c.professor_name, "class_year": c.class_year,
                "period_id": c.period_id, "period_label": c.period_label,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in rows
        ]}
    finally:
        db.close()


class RosterImportPayload(BaseModel):
    names: List[str]


@app.post("/api/classes/{class_id}/roster")
def import_roster(class_id: int, payload: RosterImportPayload):
    """Bulk-imports a roster: one Student row per name, consent_status
    'pending' until set via /api/students/{id}/consent, face_registered
    False until register_face_images() succeeds for them under this
    class_id. Names already on the roster are skipped, not duplicated,
    so re-importing an updated CSV is safe."""
    _require_db()
    db = SessionLocal()
    try:
        cls = db.query(SchoolClass).filter(SchoolClass.id == class_id).first()
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found.")
        created = []
        for raw_name in payload.names:
            name = raw_name.strip()
            if not name:
                continue
            existing = db.query(Student).filter(Student.class_id == class_id, Student.name == name).first()
            if existing:
                continue
            db.add(Student(class_id=class_id, name=name, consent_status="pending", face_registered=False))
            created.append(name)
        db.commit()
        return {"class_id": class_id, "imported": created, "skipped_existing": len(payload.names) - len(created)}
    finally:
        db.close()

class RosterImportPayloadFlat(BaseModel):
    class_id: int
    names: List[str]


@app.post("/api/students/roster")
def import_roster_flat(payload: RosterImportPayloadFlat):
    return import_roster(payload.class_id, RosterImportPayload(names=payload.names))


@app.get("/api/students/roster")
def get_roster_flat(class_id: int):
    return list_class_students(class_id)

@app.get("/api/classes/{class_id}/students")

def list_class_students(class_id: int):
    """Persistent, per-class-year student directory. This is the
    replacement for deriving the Students page from cognitive_load_log.csv
    -- a student now exists here as soon as they're on a roster, whether
    or not they've had a monitored session yet, and 'Amara Diallo' in one
    class_year is a distinct row from 'Amara Diallo' in another."""
    if not SQLALCHEMY_AVAILABLE:
        return {"students": []}
    db = SessionLocal()
    try:
        rows = db.query(Student).filter(Student.class_id == class_id).order_by(Student.name.asc()).all()
        return {"students": [
            {"id": s.id, "name": s.name, "consent_status": s.consent_status, "face_registered": s.face_registered}
            for s in rows
        ]}
    finally:
        db.close()

class ConsentPayload(BaseModel):
    consent_status: str  # 'biometric' | 'non_biometric' | 'pending'


@app.post("/api/students/{student_id}/consent")
def set_student_consent(student_id: int, payload: ConsentPayload):
    """Records whether a student (or their guardian) has consented to
    biometric face recognition, or opted into the non-biometric
    alternative (e.g. manual roll call for that student). This is a
    per-student flag, not all-or-nothing for the class -- a class can mix
    biometric and non-biometric students."""
    if payload.consent_status not in ("biometric", "non_biometric", "pending"):
        raise HTTPException(status_code=400, detail="consent_status must be 'biometric', 'non_biometric', or 'pending'.")
    _require_db()
    db = SessionLocal()
    try:
        s = db.query(Student).filter(Student.id == student_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="Student not found.")
        s.consent_status = payload.consent_status
        db.commit()
        return {"id": s.id, "name": s.name, "consent_status": s.consent_status}
    finally:
        db.close()


# ─── Students / Registration ───────────────────────────────────────────────

@app.get("/api/students")
def list_students():
    """Legacy, class-unscoped list from AttendanceSystem's in-memory
    encodings. Prefer /api/classes/{class_id}/students for anything
    year-scoped -- this endpoint is kept for backward compatibility only."""
    names = sorted(set(attendance_system.known_face_names))
    return {"students": names, "total_face_samples": len(attendance_system.known_face_names)}


@app.post("/api/students/register")
async def register_student(name: str = Form(...), images: List[UploadFile] = File(...),
                            class_id: Optional[int] = Form(None)):
    """Accepts the multiple angle-shots captured in the browser's
    RegistrationScreen and saves them exactly like the old space-bar
    capture loop did -- just sourced from the browser instead of a local
    cv2 window.

    If class_id is given and the DB is configured, this also flips the
    matching roster Student's face_registered flag to True (creating the
    roster row if it doesn't exist yet, e.g. registering someone ahead of
    a roster import). Face encodings themselves still live in
    AttendanceSystem -- this only updates the class-scoped directory
    flag, since AttendanceSystem's storage format wasn't shared and
    shouldn't be guessed at."""
    frames = []
    for img in images:
        content = await img.read()
        frames.append(_read_upload_as_bgr(content))

    if not frames:
        raise HTTPException(status_code=400, detail="No images received.")

    saved = attendance_system.register_face_images(name, frames, class_id=class_id)

    if class_id is not None and SQLALCHEMY_AVAILABLE and saved:
        db = SessionLocal()
        try:
            s = db.query(Student).filter(Student.class_id == class_id, Student.name == name).first()
            if not s:
                s = Student(class_id=class_id, name=name, consent_status="pending", face_registered=False)
                db.add(s)
            s.face_registered = True
            db.commit()
        finally:
            db.close()

    return {"name": name, "images_saved": saved, "status": "registered"}


# ─── Attendance sessions ────────────────────────────────────────────────────

class StartSessionResponse(BaseModel):
    session_id: str


@app.post("/api/attendance/start", response_model=StartSessionResponse)
def start_attendance_session(class_name: str = Form(""), class_id: Optional[int] = Form(None)):
    session_id = str(uuid.uuid4())
    attendance_sessions[session_id] = {
        "marked": set(), "class_name": class_name, "class_id": class_id,
        "started_at": datetime.utcnow(),
    }
    return {"session_id": session_id}


@app.post("/api/attendance/frame")
async def attendance_frame(session_id: str = Form(...), image: UploadFile = File(...)):
    if session_id not in attendance_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id. Call /api/attendance/start first.")
    frame = _read_upload_as_bgr(await image.read())
    session = attendance_sessions[session_id]
    loop = asyncio.get_running_loop()
    # Offloaded to the thread pool -- face_recognition is CPU-heavy and
    # blocking; running it inline on the event loop freezes every other
    # request on the server while it runs.
    result = await loop.run_in_executor(
        _executor, attendance_system.process_attendance_frame, frame, session["marked"], session_id
    )
    return result


# Assumption, stated plainly so it's defensible if asked: a teacher doing a
# verbal roll call takes about this many seconds per student on average.
MANUAL_ROLLCALL_SECONDS_PER_STUDENT = 1.5


def _roster_count(class_id: Optional[int]) -> Optional[int]:
    if class_id is None or not SQLALCHEMY_AVAILABLE:
        return None
    db = SessionLocal()
    try:
        return db.query(Student).filter(Student.class_id == class_id).count()
    finally:
        db.close()


@app.post("/api/attendance/end")
def end_attendance_session(session_id: str = Form(...)):
    if session_id not in attendance_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id.")
    session = attendance_sessions.pop(session_id)
    summary = attendance_system.finalize_session(session["marked"], session_id)

    started_at = session.get("started_at")
    automated_seconds = (datetime.utcnow() - started_at).total_seconds() if started_at else None
    roster_count = _roster_count(session.get("class_id"))

    time_saved = None
    if automated_seconds is not None and roster_count:
        manual_estimate_seconds = roster_count * MANUAL_ROLLCALL_SECONDS_PER_STUDENT
        time_saved = {
            "automatedSeconds": round(automated_seconds, 1),
            "manualEstimateSeconds": manual_estimate_seconds,
            "savedSeconds": round(max(0.0, manual_estimate_seconds - automated_seconds), 1),
            "rosterCount": roster_count,
            "assumptionSecondsPerStudent": MANUAL_ROLLCALL_SECONDS_PER_STUDENT,
        }

    if isinstance(summary, dict):
        summary["timeSaved"] = time_saved
    return summary


# ─── Mood / attentiveness sessions ─────────────────────────────────────────

@app.post("/api/mood/start", response_model=StartSessionResponse)
def start_mood_session(class_id: Optional[int] = (None)):
    session_id = str(uuid.uuid4())
    monitor = ExtendedMoodClassroomMonitor(attendance_system, log_file="cognitive_load_log.csv")
    mood_sessions[session_id] = {"monitor": monitor, "frame_counter": 0, "class_id": class_id}
    return {"session_id": session_id}


# ----------------- New endpoints: log, summary, flags ---------------------

@app.post("/api/mood/log")
async def log_mood_event(payload: dict):
    """Record a per-face emotion event for long-term aggregation and flagging.
    Expects JSON: {user_id(optional), name(optional), session_id, ts(optional ISO), emotion_probs: {k: pct}}
    """
    required = ["emotion_probs"]
    if not all(k in payload for k in required):
        raise HTTPException(status_code=400, detail="Missing emotion_probs in payload")
    ts = payload.get("ts") or datetime.utcnow().isoformat()
    emotion_probs = payload["emotion_probs"]
    try:
        ep_json = json.dumps(emotion_probs)
    except Exception:
        raise HTTPException(status_code=400, detail="emotion_probs must be JSON-serializable")

    if SQLALCHEMY_AVAILABLE:
        db = SessionLocal()
        try:
            ev = EmotionEvent(
                user_id=payload.get("user_id"),
                recognized_name=payload.get("name"),
                session_id=payload.get("session_id"),
                emotion_probs=ep_json,
                source=payload.get("source"),
                meta=json.dumps(payload.get("meta") or {}),
            )
            db.add(ev)
            db.commit()
        finally:
            db.close()
    else:
        _sqlite_insert_event(
            payload.get("user_id"), payload.get("name"), payload.get("session_id"),
            ts, ep_json, payload.get("source"), json.dumps(payload.get("meta") or {})
        )

    return {"status": "ok", "ts": ts}


@app.get("/api/mood/summary")
async def mood_summary(user_id: str = None, name: str = None, from_date: str = None, to_date: str = None):
    """Return aggregated emotion distribution and a pie-chart (base64 PNG) for a user or name in a date range.
    Dates are ISO-style (YYYY-MM-DD). If none provided, last 7 days are used.
    """
    if not from_date and not to_date and not user_id and not name:
        to_dt = datetime.utcnow()
        fr_dt = to_dt - timedelta(days=7)
        from_date = fr_dt.isoformat()

    rows = []
    if SQLALCHEMY_AVAILABLE:
        db = SessionLocal()
        try:
            q = db.query(EmotionEvent.ts, EmotionEvent.emotion_probs)
            if user_id:
                q = q.filter(EmotionEvent.user_id == user_id)
            if name:
                q = q.filter(EmotionEvent.recognized_name == name)
            if from_date:
                q = q.filter(EmotionEvent.ts >= from_date)
            if to_date:
                q = q.filter(EmotionEvent.ts <= to_date)
            rows = q.order_by(EmotionEvent.ts.asc()).all()
        finally:
            db.close()
    else:
        rows = _sqlite_fetch_events(user_id=user_id, name=name, from_date=from_date, to_date=to_date)

    events = []
    overall = defaultdict(float)
    total = 0
    for ts, ep_json in rows:
        try:
            ep = json.loads(ep_json)
        except Exception:
            continue
        events.append({"ts": str(ts), "emotion_probs": ep})
        for k, v in ep.items():
            overall[k] += float(v)
        total += 1

    overall_pct = {k: round(v / total, 2) for k, v in overall.items()} if total > 0 else {}

    eval_res = evaluate_user_events(events)

    png_b64 = None
    try:
        labels = list(overall_pct.keys())
        vals = [overall_pct.get(k, 0.0) for k in labels]
        fig, ax = plt.subplots(figsize=(6, 4))
        if sum(vals) > 0:
            ax.pie(vals, labels=labels, autopct="%1.1f%%")
        else:
            ax.text(0.5, 0.5, "No data", horizontalalignment='center')
        ax.set_title('Emotion distribution')
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight')
        plt.close(fig)
        buf.seek(0)
        png_b64 = base64.b64encode(buf.read()).decode('ascii')
    except Exception:
        png_b64 = None

    return {"total_samples": total, "distribution": overall_pct, "flag_evaluation": eval_res, "pie_chart_base64": png_b64}


@app.get("/api/mood/flags")
async def mood_flags(since_days: int = 7, sadness_threshold: float = 0.55, required_days: int = 4, instability_threshold: float = 0.05):
    """Scan all users and return flags where heuristic criteria met. This is a simple scan suitable for small deployments.
    In production run this as a background job and store flags in flags table.
    """
    cutoff = (datetime.utcnow() - timedelta(days=since_days)).isoformat()

    rows = []
    if SQLALCHEMY_AVAILABLE:
        db = SessionLocal()
        try:
            rows = db.query(
                EmotionEvent.user_id, EmotionEvent.recognized_name, EmotionEvent.ts, EmotionEvent.emotion_probs
            ).filter(EmotionEvent.ts >= cutoff).all()
        finally:
            db.close()
    else:
        rows = _sqlite_fetch_all_since(cutoff)

    users = defaultdict(list)
    for user_id, name, ts, ep_json in rows:
        try:
            ep = json.loads(ep_json)
        except Exception:
            continue
        key = user_id or name or "unknown"
        users[key].append({"ts": str(ts), "emotion_probs": ep})

    results = []
    for key, evs in users.items():
        res = evaluate_user_events(
            evs, since_days=since_days, sadness_threshold=sadness_threshold,
            required_days=required_days, instability_threshold=instability_threshold
        )
        if res.get("flag"):
            results.append({"user": key, "evaluation": res})
            now_iso = datetime.utcnow().isoformat()
            reason = res.get("reason")
            metrics_json = json.dumps(res.get("metrics"))
            user_key = None if key == 'unknown' else key
            if SQLALCHEMY_AVAILABLE:
                db = SessionLocal()
                try:
                    flag = Flag(
                        user_id=None, recognized_name=user_key, ts=now_iso,
                        reason=reason, metrics=metrics_json, severity='medium', status='open'
                    )
                    db.add(flag)
                    db.commit()
                finally:
                    db.close()
            else:
                _sqlite_insert_flag(None, user_key, now_iso, reason, metrics_json, 'medium', 'open')

    return {"flags": results}


def _open_segment_type(db, session_id):
    """Looks up whichever LessonSegment is currently open (end_ts is null)
    for this session_id, if any. Used to stamp each EmotionEvent row with
    the segment that was active when it was logged."""
    seg = (db.query(LessonSegment)
           .filter(LessonSegment.session_id == session_id, LessonSegment.end_ts.is_(None))
           .first())
    return seg.segment_type if seg else None


@app.post("/api/mood/frame")
async def mood_frame(session_id: str = Form(...), image: UploadFile = File(...)):
    if session_id not in mood_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id. Call /api/mood/start first.")
    frame = _read_upload_as_bgr(await image.read())
    state = mood_sessions[session_id]
    class_id = state.get("class_id")
    loop = asyncio.get_running_loop()

    # Hold this session's lock for the whole process_frame() call, so if
    # the frontend ever sends overlapping requests for the same session
    # (slow network, retry, multiple tabs), the second call simply waits
    # its turn instead of racing the first one inside MediaPipe.
    lock = _mood_session_locks[session_id]

    def _process_locked():
        with lock:
            return state["monitor"].process_frame(frame, state["frame_counter"], session_id)

    results = await loop.run_in_executor(_executor, _process_locked)
    state["frame_counter"] += 1

    try:
        def _log_faces(faces, session_id, class_id):
            try:
                if SQLALCHEMY_AVAILABLE:
                    db = SessionLocal()
                    try:
                        segment_type = _open_segment_type(db, session_id)
                        for f in faces:
                            ep = f.get("emotion_probs") or {}
                            if not ep:
                                continue
                            ev = EmotionEvent(
                                user_id=None,
                                recognized_name=f.get("name"),
                                session_id=session_id,
                                class_id=class_id,
                                segment_type=segment_type,
                                emotion_probs=json.dumps(ep),
                                source='mood_frame',
                                meta=json.dumps({"box": f.get("box")})
                            )
                            db.add(ev)
                        db.commit()
                    except Exception:
                        db.rollback()
                    finally:
                        db.close()
                else:
                    for f in faces:
                        ep = f.get("emotion_probs") or {}
                        if not ep:
                            continue
                        _sqlite_insert_event(None, f.get("name"), session_id, datetime.utcnow().isoformat(), json.dumps(ep), 'mood_frame', json.dumps({"box": f.get("box")}))
            except Exception:
                pass
        _executor.submit(_log_faces, results, session_id, class_id)
    except Exception:
        pass

    return {"faces": results}

import threading

# Per-session lock so concurrent /api/mood/frame calls for the SAME
# session_id never run through the same monitor's MediaPipe FaceMesh/
# FaceDetection objects at once -- MediaPipe's Python API is not
# thread-safe, and the frontend's MoodScreen capture loop can fire
# overlapping requests on a slow (Render free tier) backend. This is
# defense-in-depth alongside the frontend fix (self-pacing capture loop,
# same pattern AttendanceScreen already uses).
_mood_session_locks = defaultdict(threading.Lock)

@app.post("/api/mood/end")
def end_mood_session(session_id: str = Form(...)):
    if session_id not in mood_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id.")
    mood_sessions.pop(session_id)
    # Clean up the lock too, or _mood_session_locks (a defaultdict) will
    # quietly accumulate one Lock object per session forever, for the
    # lifetime of the process.
    _mood_session_locks.pop(session_id, None)
    return {"status": "ended", "session_id": session_id}

# ─── Lesson segments ────────────────────────────────────────────────────────

class SegmentStartPayload(BaseModel):
    session_id: str
    segment_type: str  # 'lecture' | 'group_work' | 'quiz' | 'discussion'
    class_id: Optional[int] = None


SEGMENT_TYPES = ("lecture", "group_work", "quiz", "discussion")


@app.post("/api/segments/start")
def start_segment(payload: SegmentStartPayload):
    """Marks the start of a lesson segment. Any previously open segment for
    this session_id is closed first -- a session only has one active
    segment at a time, matching a teacher tapping 'now we're in group
    work' mid-class."""
    if payload.segment_type not in SEGMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"segment_type must be one of: {', '.join(SEGMENT_TYPES)}.")
    _require_db()
    db = SessionLocal()
    try:
        open_seg = (db.query(LessonSegment)
                    .filter(LessonSegment.session_id == payload.session_id, LessonSegment.end_ts.is_(None))
                    .first())
        if open_seg:
            open_seg.end_ts = datetime.utcnow()
        seg = LessonSegment(session_id=payload.session_id, class_id=payload.class_id, segment_type=payload.segment_type)
        db.add(seg)
        db.commit()
        db.refresh(seg)
        return {
            "id": seg.id, "session_id": seg.session_id, "segment_type": seg.segment_type,
            "start_ts": seg.start_ts.isoformat() if seg.start_ts else None,
        }
    finally:
        db.close()


@app.post("/api/segments/end")
def end_current_segment(session_id: str = Form(...)):
    """Closes whichever segment is currently open for this session, without
    starting a new one -- e.g. the teacher stops tagging for the rest of
    the class."""
    _require_db()
    db = SessionLocal()
    try:
        open_seg = (db.query(LessonSegment)
                    .filter(LessonSegment.session_id == session_id, LessonSegment.end_ts.is_(None))
                    .first())
        if not open_seg:
            return {"status": "no_open_segment"}
        open_seg.end_ts = datetime.utcnow()
        db.commit()
        return {"status": "ended", "segment_id": open_seg.id}
    finally:
        db.close()


def _engagement_proxy(emotion_probs: dict) -> float:
    """A rough positive-engagement proxy from stored FERPlus-style emotion
    probabilities: 'happy' fully, 'neutral' half-weighted, everything else
    (sad/angry/fear/etc.) contributes nothing. This is deliberately coarser
    than mood_detection.py's cognitive_load score, since EmotionEvent rows
    only store raw emotion_probs, not the full attentiveness/PERCLOS state
    that feeds cognitive_load -- good enough to compare segments against
    each other, not meant to replace the real per-session engagement
    numbers in /api/reports/summary and /api/reports/weekly."""
    return emotion_probs.get("happy", 0.0) + emotion_probs.get("neutral", 0.0) * 0.5


@app.get("/api/sessions/{session_id}/segments/engagement")
def segment_engagement(session_id: str):
    """Engagement broken out by lesson segment for one session -- answers
    'did engagement drop during the lecture portion vs. group work'."""
    if not SQLALCHEMY_AVAILABLE:
        return {"available": False}
    db = SessionLocal()
    try:
        segments = (db.query(LessonSegment)
                    .filter(LessonSegment.session_id == session_id)
                    .order_by(LessonSegment.start_ts.asc())
                    .all())
        if not segments:
            return {"available": False}

        events = (db.query(EmotionEvent.segment_type, EmotionEvent.emotion_probs)
                  .filter(EmotionEvent.session_id == session_id, EmotionEvent.segment_type.isnot(None))
                  .all())

        by_segment = defaultdict(list)
        for seg_type, ep_json in events:
            try:
                ep = json.loads(ep_json)
            except Exception:
                continue
            by_segment[seg_type].append(_engagement_proxy(ep))

        results = []
        lowest = None
        for seg in segments:
            vals = by_segment.get(seg.segment_type, [])
            avg = round(statistics.mean(vals), 1) if vals else None
            duration_min = round((seg.end_ts - seg.start_ts).total_seconds() / 60, 1) if seg.end_ts else None
            entry = {"segment_type": seg.segment_type, "avgEngagementProxy": avg, "durationMinutes": duration_min}
            results.append(entry)
            if avg is not None and (lowest is None or avg < lowest["avgEngagementProxy"]):
                lowest = entry

        insight = None
        if lowest and lowest.get("durationMinutes"):
            insight = (f"Engagement looked lowest during the {lowest['durationMinutes']:.0f}-minute "
                       f"{lowest['segment_type'].replace('_', ' ')} segment.")

        return {"available": True, "segments": results, "insight": insight}
    finally:
        db.close()


# ─── Interventions ──────────────────────────────────────────────────────────

class InterventionPayload(BaseModel):
    class_id: int
    session_id: Optional[str] = None
    segment_type: Optional[str] = None
    note: str


@app.post("/api/interventions")
def record_intervention(payload: InterventionPayload):
    """Records a teacher's note that they tried something -- e.g. 'switched
    to think-pair-share' -- in response to a segment's engagement dip."""
    _require_db()
    db = SessionLocal()
    try:
        iv = Intervention(
            class_id=payload.class_id, session_id=payload.session_id,
            segment_type=payload.segment_type, note=payload.note,
        )
        db.add(iv)
        db.commit()
        db.refresh(iv)
        return {
            "id": iv.id, "class_id": iv.class_id, "session_id": iv.session_id,
            "segment_type": iv.segment_type, "note": iv.note,
            "created_at": iv.created_at.isoformat() if iv.created_at else None,
        }
    finally:
        db.close()


@app.get("/api/classes/{class_id}/interventions")
def list_interventions(class_id: int):
    if not SQLALCHEMY_AVAILABLE:
        return {"interventions": []}
    db = SessionLocal()
    try:
        rows = (db.query(Intervention)
                .filter(Intervention.class_id == class_id)
                .order_by(Intervention.created_at.desc())
                .all())
        return {"interventions": [
            {"id": iv.id, "session_id": iv.session_id, "segment_type": iv.segment_type,
             "note": iv.note, "created_at": iv.created_at.isoformat() if iv.created_at else None}
            for iv in rows
        ]}
    finally:
        db.close()

@app.get("/api/classes/{class_id}/recommended-action")
def recommended_action(class_id: int):
    """Combines session-level (lowest-engagement segment from the most
    recent session) and student-level (existing <65% flag rule) signals
    into one recommendation. Rule-based, same numbers-only philosophy as
    the AI Weekly Report narrative -- never a diagnostic claim, just what
    the logged data actually shows."""
    if not SQLALCHEMY_AVAILABLE:
        return {"available": False}
    db = SessionLocal()
    try:
        latest_segment = (db.query(LessonSegment)
                          .filter(LessonSegment.class_id == class_id)
                          .order_by(LessonSegment.start_ts.desc())
                          .first())
        latest_session_id = latest_segment.session_id if latest_segment else None
    finally:
        db.close()

    session_action = None
    if latest_session_id:
        seg_data = segment_engagement(latest_session_id)
        if seg_data.get("available") and seg_data.get("insight"):
            session_action = seg_data["insight"]

    student_action = None
    if os.path.isfile("cognitive_load_log.csv"):
        df = pd.read_csv("cognitive_load_log.csv")
        if not df.empty:
            df["Engagement"] = (100 - df["CognitiveLoad"]).clip(lower=0)
            per_student = df.groupby("Name")["Engagement"].mean()
            per_student = per_student[~per_student.index.astype(str).str.startswith("Unknown")]
            flagged = per_student[per_student < 65].sort_values()
            if len(flagged) > 0:
                lowest_name = flagged.index[0]
                lowest_val = round(flagged.iloc[0])
                student_action = f"{lowest_name} is averaging {lowest_val}% engagement — worth a check-in."

    if not session_action and not student_action:
        return {"available": False}

    return {"available": True, "sessionAction": session_action, "studentAction": student_action}

@app.get("/api/classes/{class_id}/interventions/effectiveness")
def intervention_effectiveness(class_id: int):
    """Session-over-session comparison: for each recorded intervention,
    compares that segment's average engagement proxy in the session right
    after the intervention against the session right before it.

    This is an honest average-delta comparison across two real sessions,
    not a trained or learned model -- 'the system learns which
    interventions work' means a teacher can see which past notes
    correlated with a real bump, stated in the same numbers-only style as
    the AI Weekly Report narrative, not that anything is being trained on
    this data."""
    if not SQLALCHEMY_AVAILABLE:
        return {"available": False}
    db = SessionLocal()
    try:
        interventions = (db.query(Intervention)
                         .filter(Intervention.class_id == class_id)
                         .order_by(Intervention.created_at.asc())
                         .all())
        if not interventions:
            return {"available": False}

        # Chronological list of distinct session_ids for this class, so we
        # can find "the session right before/after" a given intervention.
        segments = (db.query(LessonSegment)
                   .filter(LessonSegment.class_id == class_id)
                   .order_by(LessonSegment.start_ts.asc())
                   .all())
        session_order = []
        seen = set()
        for seg in segments:
            if seg.session_id not in seen:
                session_order.append(seg.session_id)
                seen.add(seg.session_id)

        def segment_avg(session_id, segment_type):
            if not session_id or not segment_type:
                return None
            rows = (db.query(EmotionEvent.emotion_probs)
                   .filter(EmotionEvent.session_id == session_id, EmotionEvent.segment_type == segment_type)
                   .all())
            vals = []
            for (ep_json,) in rows:
                try:
                    vals.append(_engagement_proxy(json.loads(ep_json)))
                except Exception:
                    continue
            return round(statistics.mean(vals), 1) if vals else None

        results = []
        for iv in interventions:
            if not iv.session_id or not iv.segment_type or iv.session_id not in session_order:
                results.append({
                    "intervention_id": iv.id, "note": iv.note,
                    "before": None, "after": None, "delta": None,
                    "status": "Not enough session data to compare yet.",
                })
                continue
            idx = session_order.index(iv.session_id)
            before_id = session_order[idx - 1] if idx > 0 else None
            after_id = session_order[idx + 1] if idx + 1 < len(session_order) else None
            before = segment_avg(before_id, iv.segment_type)
            after = segment_avg(after_id, iv.segment_type)
            results.append({
                "intervention_id": iv.id, "note": iv.note, "segment_type": iv.segment_type,
                "before": before, "after": after,
                "delta": round(after - before, 1) if (before is not None and after is not None) else None,
                "status": None,
            })

        return {"available": True, "comparisons": results}
    finally:
        db.close()


# ─── Reports ────────────────────────────────────────────────────────────────

@app.post("/api/reports/generate")
def create_report():
    result = generate_report(log_file="cognitive_load_log.csv", output_dir="session_reports")
    if result is None:
        raise HTTPException(status_code=404, detail="No session data logged yet.")
    pdf_path, flags_csv_path, png_dir = result
    return {"pdf": os.path.basename(pdf_path), "flags_csv": os.path.basename(flags_csv_path)}


@app.get("/api/reports/summary")
def reports_summary():
    """Real class + per-student engagement summary, computed from
    cognitive_load_log.csv (written by mood_detection.py sessions).
    IMPORTANT: declared BEFORE /api/reports/{filename} below -- FastAPI
    matches routes in declaration order, and a wildcard path param route
    declared first would otherwise swallow this literal path (treating
    "summary" as a filename to look up)."""
    if not os.path.isfile("cognitive_load_log.csv"):
        return {"students": [], "avgEngagement": None, "topPerformer": None,
                "needsCheckIn": 0, "timeline": []}

    df = pd.read_csv("cognitive_load_log.csv")
    if df.empty:
        return {"students": [], "avgEngagement": None, "topPerformer": None,
                "needsCheckIn": 0, "timeline": []}

    df["Engagement"] = (100 - df["CognitiveLoad"]).clip(lower=0)

    per_student = df.groupby("Name")["Engagement"].mean().round().astype(int)
    students = []
    for name, eng in per_student.items():
        if name.startswith("Unknown"):
            continue
        students.append({"name": name, "engagementAvg": int(eng), "flag": bool(eng < 65)})
    students.sort(key=lambda s: -s["engagementAvg"])

    avg_engagement = int(df["Engagement"].mean())
    top_performer = students[0]["name"] if students else None
    needs_check_in = sum(1 for s in students if s["flag"])

    df["Timestamp"] = pd.to_datetime(df["Timestamp"])
    df["Minute"] = df["Timestamp"].dt.strftime("%H:%M")
    timeline_df = df.groupby("Minute")["Engagement"].mean().round().astype(int)
    timeline = [{"t": t, "engagement": int(v)} for t, v in timeline_df.items()]

    return {
        "students": students,
        "avgEngagement": avg_engagement,
        "topPerformer": top_performer,
        "needsCheckIn": needs_check_in,
        "timeline": timeline,
    }

from fastapi.responses import StreamingResponse
import csv as csv_module


@app.get("/api/classes/{class_id}/export/sis")
def export_sis_csv(class_id: int):
    """Mock SIS-compatible attendance export. Generic Name/Date/Status/Class
    schema -- not a real vendor integration, but a believable stand-in for
    'syncs to the school's existing system' until a specific SIS/format is
    chosen."""
    _require_db()
    db = SessionLocal()
    try:
        cls = db.query(SchoolClass).filter(SchoolClass.id == class_id).first()
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found.")
        students = db.query(Student).filter(Student.class_id == class_id).order_by(Student.name.asc()).all()
    finally:
        db.close()

    buf = io.StringIO()
    writer = csv_module.writer(buf)
    writer.writerow(["StudentName", "Date", "ClassYear", "Period", "Status"])
    today = datetime.utcnow().strftime("%Y-%m-%d")
    for s in students:
        status = "Present" if s.consent_status != "pending" else "Unknown"
        writer.writerow([s.name, today, cls.class_year, cls.period_label or "", status])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=classsense_export_{class_id}_{today}.csv"}
    )

def _weekly_trend_narrative(daily_engagement, avg_engagement, prev_avg_engagement,
                             flagged_count, most_improved, most_declined, num_students):
    """Rule-based natural-language summary of the week's engagement data --
    the 'AI' in 'AI Weekly Report'. Deliberately template-driven rather than
    a model call: it only ever states numbers that were actually computed
    from cognitive_load_log.csv, so it can't hallucinate a trend that isn't
    there. See the same reasoning in session_report.py's flagging language."""
    lines = []

    num_days = len(daily_engagement)
    day_word = "day" if num_days == 1 else "days"

    if prev_avg_engagement is None:
        lines.append(
            f"This is the first full reporting period with enough data — the class averaged "
            f"{avg_engagement}% engagement across {num_days} logged {day_word} and {num_students} student(s)."
        )
    else:
        delta = avg_engagement - prev_avg_engagement
        if delta >= 3:
            lines.append(
                f"Engagement is trending up this week, averaging {avg_engagement}% "
                f"(up {delta:.0f} point{'s' if abs(delta) != 1 else ''} from the prior period)."
            )
        elif delta <= -3:
            lines.append(
                f"Engagement dipped this week, averaging {avg_engagement}% "
                f"(down {abs(delta):.0f} point{'s' if abs(delta) != 1 else ''} from the prior period)."
            )
        else:
            lines.append(f"Engagement held steady this week, averaging {avg_engagement}% across the class.")

    if most_improved:
        lines.append(
            f"{most_improved['name']} showed the biggest improvement, "
            f"up {most_improved['delta']:.0f} points versus last period."
        )
    if most_declined:
        lines.append(
            f"{most_declined['name']} saw the largest drop, "
            f"down {abs(most_declined['delta']):.0f} points — worth a check-in."
        )

    if flagged_count > 0:
        lines.append(
            f"{flagged_count} student{'s' if flagged_count != 1 else ''} "
            f"{'are' if flagged_count != 1 else 'is'} currently averaging below 65% engagement "
            f"and may benefit from follow-up."
        )
    else:
        lines.append("No students are currently flagged for low engagement — nice week.")

    return " ".join(lines)


@app.get("/api/reports/weekly")
def weekly_report(days: int = 7):
    """AI Weekly Report Generator.

    Aggregates cognitive_load_log.csv over the trailing `days` window
    (default 7) and compares it against the preceding window of equal
    length, producing:
      - a per-day engagement series (for the chart)
      - per-student weekly averages, with the existing <65% flag rule
      - the single most-improved and most-declined student week-over-week
      - a short rule-based narrative summary (see _weekly_trend_narrative)

    Declared as a literal path before /api/reports/{filename} for the same
    routing reason documented on /api/reports/summary above."""
    if not os.path.isfile("cognitive_load_log.csv"):
        return {"available": False}

    df = pd.read_csv("cognitive_load_log.csv")
    if df.empty:
        return {"available": False}

    df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")
    df = df.dropna(subset=["Timestamp"])
    if df.empty:
        return {"available": False}

    df["Engagement"] = (100 - df["CognitiveLoad"]).clip(lower=0)
    df = df[~df["Name"].astype(str).str.startswith("Unknown")]
    if df.empty:
        return {"available": False}

    now = df["Timestamp"].max()
    period_start = now - pd.Timedelta(days=days)
    prev_start = period_start - pd.Timedelta(days=days)

    current = df[(df["Timestamp"] > period_start) & (df["Timestamp"] <= now)].copy()
    previous = df[(df["Timestamp"] > prev_start) & (df["Timestamp"] <= period_start)]

    if current.empty:
        return {"available": False}

    # Per-day engagement, for the bar chart
    current["Date"] = current["Timestamp"].dt.strftime("%Y-%m-%d")
    daily = current.groupby("Date")["Engagement"].mean().round().astype(int)
    daily_engagement = [{"date": d, "avgEngagement": int(v)} for d, v in daily.items()]

    # Per-student current-window averages (same <65% flag rule as /summary)
    per_student_current = current.groupby("Name")["Engagement"].mean()
    students = []
    for name, eng in per_student_current.items():
        students.append({"name": name, "engagementAvg": int(round(eng)), "flag": bool(eng < 65)})
    students.sort(key=lambda s: -s["engagementAvg"])
    flagged_count = sum(1 for s in students if s["flag"])

    avg_engagement = int(round(current["Engagement"].mean()))

    prev_avg_engagement = None
    most_improved = None
    most_declined = None
    if not previous.empty:
        prev_avg_engagement = int(round(previous["Engagement"].mean()))
        per_student_prev = previous.groupby("Name")["Engagement"].mean()
        deltas = []
        for name, cur_eng in per_student_current.items():
            if name in per_student_prev.index:
                deltas.append({"name": name, "delta": float(cur_eng) - float(per_student_prev[name])})
        if deltas:
            deltas.sort(key=lambda d: d["delta"], reverse=True)
            if deltas[0]["delta"] > 0.5:
                most_improved = deltas[0]
            if deltas[-1]["delta"] < -0.5:
                most_declined = deltas[-1]

    narrative = _weekly_trend_narrative(
        daily_engagement, avg_engagement, prev_avg_engagement,
        flagged_count, most_improved, most_declined, len(students)
    )

    return {
        "available": True,
        "periodStart": period_start.isoformat(),
        "periodEnd": now.isoformat(),
        "avgEngagement": avg_engagement,
        "prevAvgEngagement": prev_avg_engagement,
        "dailyEngagement": daily_engagement,
        "students": students,
        "flaggedCount": flagged_count,
        "mostImproved": most_improved,
        "mostDeclined": most_declined,
        "narrative": narrative,
    }


@app.get("/api/reports/{filename}")
def download_report(filename: str):
    path = os.path.join("session_reports", filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Report not found.")
    return FileResponse(path)


@app.get("/api/health")
def health():
    return {"status": "ok"}