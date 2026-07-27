FROM python:3.11-slim

# System packages required to build dlib (face_recognition's dependency)
# and to run OpenCV/MediaPipe on a headless server.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# dlib compiles from source here - this step alone can take 10-20 minutes
# on a free-tier build machine. This is expected, not a hang.
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Data directories that need to persist between requests (and ideally be
# backed by a persistent volume once you're past local testing).
RUN mkdir -p registered_faces session_reports

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]