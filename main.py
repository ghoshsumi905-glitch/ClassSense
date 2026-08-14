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

# ... your existing imports (FastAPI, mood_detection, etc.) go below this
import os
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

app = FastAPI(title="ClassSense API")

# Allow your Vercel frontend (and localhost during dev) to call this API.
# Replace "*" with your actual Vercel URL before going to production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: restrict to ["https://class-sense-prototype.vercel.app"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- shared, process-wide state -------------------------------------------
attendance_system = AttendanceSystem(dataset_dir="registered_faces", attendance_file="attendance.csv")

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
    result = attendance_system.process_attendance_frame(frame, session["marked"], session_id)
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


@app.post("/api/mood/frame")
async def mood_frame(session_id: str = Form(...), image: UploadFile = File(...)):
    if session_id not in mood_sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id. Call /api/mood/start first.")
    frame = _read_upload_as_bgr(await image.read())
    state = mood_sessions[session_id]
    # Offload heavy synchronous processing (face mesh, ONNX inference) to a threadpool
    loop = asyncio.get_running_loop()
    # process_frame signature: (frame, frame_counter, session_id=None, run_emotion_model=True)
    results = await loop.run_in_executor(None, state["monitor"].process_frame,
                                         frame, state["frame_counter"], session_id)
    state["frame_counter"] += 1
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
            continue  # unrecognized faces shouldn't show as a "student"
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