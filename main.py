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

CLASS / ROSTER / CONSENT UPDATE (this revision):
Adds the narrow workflow's setup steps ahead of attendance:
  POST /api/classes            -- teacher creates a class (professor+year+period)
  POST /api/students/roster    -- teacher imports a roster of names into that class
  GET  /api/students/roster    -- list a class's roster with consent + registration status
  POST /api/students/{id}/consent -- record a student's consent choice
Registration now requires consent_status == "biometric" before a face
encoding is ever computed -- students who chose the non-biometric
alternative, or haven't answered yet, can't accidentally get a face stored.
Attendance sessions are now class-scoped end to end (start -> frame -> end),
and uncertain matches accumulate into a per-session review queue that the
teacher resolves via /api/attendance/review-correct.
"""
import os
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

import uuid
import numpy as np
import cv2
import pandas as pd
import asyncio
from typing import List, Optional
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
# attendance_sessions[session_id] now also carries:
#   "class_id"       -- scopes recognition + roster lookups (see attendance_system.py)
#   "uncertain_queue" -- list of {"name","confidence"} the teacher hasn't resolved yet
attendance_sessions = {}
mood_sessions = {}        # session_id -> {"monitor": ExtendedMoodClassroomMonitor, "frame_counter": int}


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
            detail="Class/roster/consent features require the database (set DB_URL / install SQLAlchemy)."
        )


# ─── Classes ────────────────────────────────────────────────────────────────

class CreateClassBody(BaseModel):
    professor_name: str
    class_year: str
    period_id: Optional[str] = None
    period_label: Optional[str] = None


@app.post("/api/classes")
def create_class(body: CreateClassBody):
    """Step 1 of the workflow: teacher creates a class. Everything else
    (roster, consent, face registrations, attendance, segments) hangs off
    this class_id."""
    _require_db()
    db = SessionLocal()
    try:
        cls = SchoolClass(
            professor_name=body.professor_name.strip(),
            class_year=body.class_year,
            period_id=body.period_id,
            period_label=body.period_label,
        )
        db.add(cls)
        db.commit()
        db.refresh(cls)
        return {
            "class_id": cls.id,
            "professor_name": cls.professor_name,
            "class_year": cls.class_year,
            "period_id": cls.period_id,
            "period_label": cls.period_label,
        }
    finally:
        db.close()


@app.get("/api/classes/{class_id}")
def get_class(class_id: int):
    _require_db()
    db = SessionLocal()
    try:
        cls = db.query(SchoolClass).filter(SchoolClass.id == class_id).first()
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found.")
        return {
            "class_id": cls.id,
            "professor_name": cls.professor_name,
            "class_year": cls.class_year,
            "period_id": cls.period_id,
            "period_label": cls.period_label,
        }
    finally:
        db.close()


# ─── Roster + consent ───────────────────────────────────────────────────────

class RosterImportBody(BaseModel):
    class_id: int
    names: List[str]


@app.post("/api/students/roster")
def import_roster(body: RosterImportBody):
    """Step 2: teacher imports a roster. Each name becomes a Student row
    scoped to class_id with consent_status='pending' -- no face encoding
    exists for anyone yet, matching the workflow's ordering (roster, THEN
    consent, THEN recognition)."""
    _require_db()
    db = SessionLocal()
    try:
        cls = db.query(SchoolClass).filter(SchoolClass.id == body.class_id).first()
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found.")

        existing_names = {
            s.name.lower() for s in db.query(Student).filter(Student.class_id == body.class_id).all()
        }
        created, skipped = [], []
        for raw_name in body.names:
            name = raw_name.strip()
            if not name:
                continue
            if name.lower() in existing_names:
                skipped.append(name)
                continue
            db.add(Student(class_id=body.class_id, name=name, consent_status="pending", face_registered=False))
            existing_names.add(name.lower())
            created.append(name)
        db.commit()
        return {"class_id": body.class_id, "created": created, "skipped_existing": skipped}
    finally:
        db.close()


@app.get("/api/students/roster")
def get_roster(class_id: int):
    """Roster + consent + face-registration status for one class -- what
    ReportsScreen/StudentsScreen should eventually read instead of the
    hardcoded STUDENTS mock array."""
    _require_db()
    db = SessionLocal()
    try:
        students = (
            db.query(Student)
            .filter(Student.class_id == class_id)
            .order_by(Student.name)
            .all()
        )
        return {
            "class_id": class_id,
            "students": [
                {
                    "id": s.id,
                    "name": s.name,
                    "consent_status": s.consent_status,
                    "face_registered": s.face_registered,
                }
                for s in students
            ],
        }
    finally:
        db.close()


class ConsentBody(BaseModel):
    consent_status: str  # 'biometric' | 'non_biometric' | 'pending'


@app.post("/api/students/{student_id}/consent")
def set_consent(student_id: int, body: ConsentBody):
    """Step 3: student gives consent or opts into the non-biometric
    alternative. Recorded per-student so registration (below) can enforce
    it -- a student who is 'non_biometric' or still 'pending' should never
    have a face encoding computed for them."""
    if body.consent_status not in ("biometric", "non_biometric", "pending"):
        raise HTTPException(status_code=400, detail="consent_status must be 'biometric', 'non_biometric', or 'pending'.")
    _require_db()
    db = SessionLocal()
    try:
        student = db.query(Student).filter(Student.id == student_id).first()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found.")
        student.consent_status = body.consent_status
        db.commit()
        return {"id": student.id, "name": student.name, "consent_status": student.consent_status}
    finally:
        db.close()


# ─── Students / Registration ───────────────────────────────────────────────

@app.get("/api/students")
def list_students():
    names = sorted(set(attendance_system.known_face_names))
    return {"students": names, "total_face_samples": len(attendance_system.known_face_names)}


@app.post("/api/students/register")
async def register_student(
    name: str = Form(...),
    images: List[UploadFile] = File(...),
    class_id: Optional[int] = Form(None),
    student_id: Optional[int] = Form(None),
):
    """Accepts the multiple angle-shots captured in the browser's
    RegistrationScreen and saves them exactly like the old space-bar
    capture loop did -- just sourced from the browser instead of a local
    cv2 window. Now class-scoped: the same name under two different
    class_ids is two separate identities (see attendance_system.py).

    If student_id is provided, this enforces biometric consent BEFORE
    computing any face encoding, and flips that student's
    face_registered flag to True afterwards."""
    student = None
    if SQLALCHEMY_AVAILABLE and student_id is not None:
        db = SessionLocal()
        try:
            student = db.query(Student).filter(Student.id == student_id).first()
            if not student:
                raise HTTPException(status_code=404, detail="Student not found.")
            if student.consent_status != "biometric":
                raise HTTPException(
                    status_code=403,
                    detail="This student hasn't given biometric consent -- use the non-biometric attendance option instead."
                )
            class_id = student.class_id
        finally:
            db.close()

    frames = []
    for img in images:
        content = await img.read()
        frames.append(_read_upload_as_bgr(content))

    if not frames:
        raise HTTPException(status_code=400, detail="No images received.")

    saved = attendance_system.register_face_images(name, frames, class_id=class_id)

    if SQLALCHEMY_AVAILABLE and student_id is not None:
        db = SessionLocal()
        try:
            student = db.query(Student).filter(Student.id == student_id).first()
            if student:
                student.face_registered = True
                db.commit()
        finally:
            db.close()

    return {"name": name, "images_saved": saved, "status": "registered", "class_id": class_id}


# ─── Attendance sessions ────────────────────────────────────────────────────

class StartSessionResponse(BaseModel):
    session_id: str


@app.post("/api/attendance/start", response_model=StartSessionResponse)
def start_attendance_session(class_name: str = Form(""), class_id: Optional[int] = Form(None)):
    """Step 4: teacher starts attendance. class_id scopes recognition to
    this class's registered faces (attendance_system.recognize_faces)."""
    session_id = str(uuid.uuid4())
    attendance_sessions[session_id] = {
        "marked": set(),
        "class_name": class_name,
        "class_id": class_id,
        "uncertain_queue": [],  # step 6: review queue for uncertain/unknown matches
    }
    return {"session_id": session_id}


@app.post("/api/attendance/frame")
async def attendance_frame(session_id: str = Form(...), image: UploadFile = File(...)):
    """Steps 5-6: recognize students with confidence scores; matched faces
    are auto-marked present, uncertain faces accumulate into this
    session's review queue instead of being silently marked or dropped."""
    if session_id not in attendance_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id. Call /api/attendance/start first.")
    frame = _read_upload_as_bgr(await image.read())
    session = attendance_sessions[session_id]
    loop = asyncio.get_running_loop()
    # Offloaded to the thread pool -- face_recognition is CPU-heavy and
    # blocking; running it inline on the event loop freezes every other
    # request on the server while it runs.
    result = await loop.run_in_executor(
        _executor,
        attendance_system.process_attendance_frame,
        frame, session["marked"], session_id, session.get("class_id"),
    )

    # Accumulate newly-seen uncertain matches into the review queue, deduped
    # by name so a face lingering across several frames doesn't spam entries.
    existing_names = {u["name"] for u in session["uncertain_queue"]}
    for u in result.get("uncertain", []):
        if u["name"] and u["name"] not in existing_names:
            session["uncertain_queue"].append(u)
            existing_names.add(u["name"])

    result["uncertain_queue"] = session["uncertain_queue"]
    return result


@app.get("/api/attendance/review-queue")
def get_review_queue(session_id: str):
    """Standalone poll for the review queue, in case the frontend wants to
    render it in a dedicated sheet/screen rather than reading it off every
    frame response."""
    if session_id not in attendance_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id.")
    return {"uncertain": attendance_sessions[session_id]["uncertain_queue"]}


class ReviewCorrectionBody(BaseModel):
    session_id: str
    original_name: str            # the queue entry's best-guess name being resolved
    corrected_name: Optional[str] = None  # confirmed/corrected name; omit/None to dismiss (not present)


@app.post("/api/attendance/review-correct")
def correct_review_match(body: ReviewCorrectionBody):
    """Step 7: teacher corrects mistakes. Removes the entry from the review
    queue; if a corrected_name is given, marks that student Present exactly
    like an auto-match would (writes the same attendance.csv row type)."""
    if body.session_id not in attendance_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id.")
    session = attendance_sessions[body.session_id]
    session["uncertain_queue"] = [
        u for u in session["uncertain_queue"] if u["name"] != body.original_name
    ]
    if body.corrected_name and body.corrected_name not in session["marked"]:
        attendance_system._append_attendance_row(body.corrected_name, "Present", body.session_id)
        session["marked"].add(body.corrected_name)
    return {"marked": sorted(session["marked"]), "uncertain": session["uncertain_queue"]}


@app.post("/api/attendance/end")
def end_attendance_session(session_id: str = Form(...)):
    """Step 8 (pre-sync): finalize present/absent for the class roster.
    Actual sync to the school's existing SIS/attendance system is a
    separate integration step -- see the TODO where finalize_session
    returns, once you tell me which system/format it needs to match."""
    if session_id not in attendance_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id.")
    session = attendance_sessions.pop(session_id)
    summary = attendance_system.finalize_session(
        session["marked"], session_id, class_id=session.get("class_id")
    )
    return summary


# ─── Mood / attentiveness sessions ─────────────────────────────────────────

@app.post("/api/mood/start", response_model=StartSessionResponse)
def start_mood_session():
    session_id = str(uuid.uuid4())
    monitor = ExtendedMoodClassroomMonitor(attendance_system, log_file="cognitive_load_log.csv")
    mood_sessions[session_id] = {"monitor": monitor, "frame_counter": 0}
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


@app.post("/api/mood/frame")
async def mood_frame(session_id: str = Form(...), image: UploadFile = File(...)):
    if session_id not in mood_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id. Call /api/mood/start first.")
    frame = _read_upload_as_bgr(await image.read())
    state = mood_sessions[session_id]
    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(_executor, state["monitor"].process_frame, frame, state["frame_counter"], session_id)
    state["frame_counter"] += 1

    try:
        def _log_faces(faces, session_id):
            try:
                if SQLALCHEMY_AVAILABLE:
                    db = SessionLocal()
                    try:
                        for f in faces:
                            ep = f.get("emotion_probs") or {}
                            if not ep:
                                continue
                            ev = EmotionEvent(
                                user_id=None,
                                recognized_name=f.get("name"),
                                session_id=session_id,
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
        _executor.submit(_log_faces, results, session_id)
    except Exception:
        pass

    return {"faces": results}


@app.post("/api/mood/end")
def end_mood_session(session_id: str = Form(...)):
    if session_id not in mood_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id.")
    mood_sessions.pop(session_id)
    return {"status": "ended", "session_id": session_id}


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