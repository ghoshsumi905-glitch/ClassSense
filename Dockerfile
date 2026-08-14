FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir \
    fastapi==0.115.0 \
    "uvicorn[standard]==0.30.6" \
    python-multipart==0.0.9 \
    pydantic==2.9.2 \
    "setuptools<81" \
    numpy==1.26.4 \
    pandas==2.2.3 \
    matplotlib==3.9.2

RUN pip install --no-cache-dir opencv-python-headless==4.10.0.84

# dlib-bin provides the same `dlib` module as the real `dlib` package,
# but under a different pip name — install it alone first.
RUN pip install --no-cache-dir dlib-bin==19.24.6

# --no-deps is essential: face_recognition's metadata lists "dlib" (not
# "dlib-bin") as a dependency, which would otherwise make pip try to
# build the real dlib from source and fail (no compiler installed here).
RUN pip install --no-cache-dir --no-deps face_recognition==1.3.0

RUN pip install --no-cache-dir face_recognition_models==0.3.0
RUN pip install --no-cache-dir protobuf==4.25.3 mediapipe==0.10.14
RUN pip install --no-cache-dir onnxruntime==1.19.2

COPY . .
# models/emotion-ferplus-8.onnx gets copied here along with everything else

RUN mkdir -p registered_faces session_reports

EXPOSE 8000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}