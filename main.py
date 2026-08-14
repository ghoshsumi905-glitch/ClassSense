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
"""
import os
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

import uuid
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
    from models import Base, EmotionEvent, Flag
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
mood_sessions = {}        # session_id -> {"monitor": ExtendedMoodClassroomMonitor, "frame_counter": int}


def _read_upload_as_bgr(file_bytes: bytes):
    arr = np.frombuffer(file_bytes, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")
    return frame


# ─── Students / Registration ───────────────────────────────────────────────

@app.get("/api/students")
def list_students():
    names = sorted(set(attendance_system.known_face_names))
    return {"students": names, "total_face_samples": len(attendance_system.known_face_names)}


@app.post("/api/students/register")
async def register_student(name: str = Form(...), images: list[UploadFile] = File(...)):
    """Accepts the multiple angle-shots captured in the browser's
    RegistrationScreen and saves them exactly like the old space-bar
    capture loop did -- just sourced from the browser instead of a local
    cv2 window."""
    frames = []
    for img in images:
        content = await img.read()
        frames.append(_read_upload_as_bgr(content))

    if not frames:
        raise HTTPException(status_code=400, detail="No images received.")

    saved = attendance_system.register_face_images(name, frames)
    return {"name": name, "images_saved": saved, "status": "registered"}


# ─── Attendance sessions ────────────────────────────────────────────────────

class StartSessionResponse(BaseModel):
    session_id: str


@app.post("/api/attendance/start", response_model=StartSessionResponse)
def start_attendance_session(class_name: str = Form("")):
    session_id = str(uuid.uuid4())
    attendance_sessions[session_id] = {"marked": set(), "class_name": class_name}
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


@app.post("/api/attendance/end")
def end_attendance_session(session_id: str = Form(...)):
    if session_id not in attendance_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id.")
    session = attendance_sessions.pop(session_id)
    summary = attendance_system.finalize_session(session["marked"], session_id)
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


@app.get("/api/reports/{filename}")
def download_report(filename: str):
    path = os.path.join("session_reports", filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Report not found.")
    return FileResponse(path)


@app.get("/api/health")
def health():
    return {"status": "ok"}