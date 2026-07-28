FROM python:3.11-slim

# System packages required to build dlib (face_recognition's dependency)
# and to run OpenCV/MediaPipe on a headless server.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    cmake \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libopenblas-dev \
    liblapack-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# dlib compiles from source here - this step alone can take 10-20 minutes
# on a free-tier build machine. This is expected, not a hang.
COPY requirements.txt .

# Install in stages to keep peak memory low during the build.
# Lightweight, no-conflict packages first.
RUN pip install --no-cache-dir \
    fastapi==0.115.0 \
    "uvicorn[standard]==0.30.6" \
    python-multipart==0.0.9 \
    pydantic==2.9.2 \
    "setuptools<81" \
    numpy==1.26.4 \
    pandas==2.2.3 \
    matplotlib==3.9.2

# OpenCV on its own.
RUN pip install --no-cache-dir opencv-python-headless==4.10.0.84

# dlib + face_recognition (now using dlib-bin, so this should be fast).
RUN pip install --no-cache-dir dlib-bin==19.24.6 face_recognition==1.3.0
RUN pip install --no-cache-dir git+https://github.com/ageitgey/face_recognition_models

# protobuf/ml-dtypes before the big TF stack.
RUN pip install --no-cache-dir protobuf==4.25.3 ml-dtypes==0.5.4

# The two heaviest packages, each in their own layer.
RUN pip install --no-cache-dir tensorflow==2.19.1 tf-keras==2.19.0
RUN pip install --no-cache-dir mediapipe==0.10.14

# deepface last, since it depends on tensorflow/tf-keras already being present.
RUN pip install --no-cache-dir deepface==0.0.93

COPY . .

# Data directories that need to persist between requests (and ideally be
# backed by a persistent volume once you're past local testing).
RUN mkdir -p registered_faces session_reports

EXPOSE 8000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}