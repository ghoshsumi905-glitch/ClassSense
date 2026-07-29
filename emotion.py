import os
import onnxruntime as ort
import numpy as np
import cv2

_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "emotion-ferplus-8.onnx")
_session = ort.InferenceSession(_MODEL_PATH)
_input_name = _session.get_inputs()[0].name

# FERPlus's native 8 classes, in the exact order the model outputs them.
_FERPLUS_CLASSES = ["neutral", "happiness", "surprise", "sadness",
                    "anger", "disgust", "fear", "contempt"]

# Map onto the 7 keys mood_detection.py already expects (same names
# DeepFace used), so nothing downstream (_score_mood, entropy, smoothing)
# needs to change. "contempt" has no dedicated slot in your mood scoring,
# so it folds into "disgust" (closest visual/expressive neighbor).
_TO_APP_KEY = {
    "neutral": "neutral", "happiness": "happy", "surprise": "surprise",
    "sadness": "sad", "anger": "angry", "disgust": "disgust",
    "fear": "fear", "contempt": "disgust",
}

APP_EMOTION_KEYS = ["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]


def predict_emotion_full(face_bgr: np.ndarray) -> dict:
    """Returns {emotion_key: percentage}, summing to ~100 -- same shape
    DeepFace.analyze()['emotion'] used to return."""
    gray = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (64, 64)).astype(np.float32)
    tensor = resized.reshape(1, 1, 64, 64)
    scores = _session.run(None, {_input_name: tensor})[0][0]
    probs = np.exp(scores - scores.max())
    probs /= probs.sum()

    merged = {k: 0.0 for k in APP_EMOTION_KEYS}
    for ferplus_name, p in zip(_FERPLUS_CLASSES, probs):
        merged[_TO_APP_KEY[ferplus_name]] += float(p) * 100.0
    return merged