# ClassSense

**Attendance & wellbeing insights for the classroom.**

ClassSense is a teacher-facing classroom monitoring system that combines face-recognition attendance tracking with real-time engagement monitoring, built as a college project with hackathon ambitions.

🔗 **Live app:** [class-sense-prototype.vercel.app](https://class-sense-prototype.vercel.app)
🔗 **Backend API:** [classsense-backend-8kuy.onrender.com](https://classsense-backend-8kuy.onrender.com)

---

## Monorepo structure

```
ClassSense/
├── frontend/     React + TypeScript + Vite (deployed on Vercel)
└── backend/      FastAPI + Python (deployed on Render)
```

This repo combines what were previously two separate repositories — `ClassSense-prototype` (frontend) and `ClassSense-backend` (backend) — merged into a single monorepo with full commit history preserved from both.

---

## Features

- **Face recognition attendance** — automatic student identification and attendance logging via `dlib` / `face_recognition`
- **Real-time engagement monitoring** — per-student attentiveness and mood classification using MediaPipe facial landmarks and a lightweight ONNX FERPlus emotion model
- **Teacher dashboard** — live class overview, per-student reports, and session summaries
- **Session reporting** — exportable attendance and engagement summaries per class session

---

## Tech stack

### Frontend (`/frontend`)
- React + TypeScript + Vite
- Package manager: `pnpm`
- Deployed on **Vercel**

### Backend (`/backend`)
- FastAPI (Python)
- Face recognition: `dlib` / `face_recognition` (via `dlib-bin` prebuilt wheels for lightweight builds)
- Facial landmarks: MediaPipe
- Emotion classification: custom FERPlus model via `onnxruntime`
- Deployed on **Render** (Docker, free tier)

---

## Local development

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt --break-system-packages
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

---

## Deployment notes

- **Vercel (frontend):** Root Directory set to `frontend`, framework preset Vite, build command `vite build`, output directory `dist`.
- **Render (backend):** Root Directory set to `backend`, deployed via Docker. Free-tier build machines are memory-constrained — prefer prebuilt binaries (`dlib-bin`) and lightweight inference runtimes (ONNX) over heavier dependencies like TensorFlow.
- **Persistence:** Render's filesystem is ephemeral — locally written data (e.g. face encodings, SQLite) is wiped on restart/redeploy. A persistent external database (e.g. Render Postgres) is recommended for production use.

---

## Status

Core system deployed and functional end-to-end: face recognition attendance, real-time mood/engagement tracking, and a live teacher dashboard backed by real session data.

---

## License

Not yet specified.
