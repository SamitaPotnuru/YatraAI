"""Application configuration from environment and paths."""

import os

from dotenv import load_dotenv

# Project root (parent of the yatraai package)
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

load_dotenv(os.path.join(_ROOT, ".env"))


class Config:
    """Flask config and filesystem paths."""

    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-change-me")
    MODEL_PATH = os.path.join(_ROOT, "indian_monuments_classifier.h5")
    CLASS_NAMES_PATH = os.path.join(_ROOT, "data", "class_names.json")

    GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
    OPENWEATHER_API_KEY = os.environ.get("OPENWEATHER_API_KEY", "")
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

    # If local model top-1 softmax probability is >= this (0–1), use its class label; else Groq vision.
    # This is NOT accuracy (accuracy needs a labeled test set). Default 0.80 = 80%.
    # Prefer LOCAL_MODEL_TOP1_THRESHOLD; LOCAL_MODEL_MIN_CONFIDENCE still works for older .env files.
    TOP1_THRESHOLD = float(
        os.environ.get("LOCAL_MODEL_TOP1_THRESHOLD")
        or os.environ.get("LOCAL_MODEL_MIN_CONFIDENCE", "0.8")
    )
    GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
    GROQ_VISION_URL = "https://api.groq.com/openai/v1/chat/completions"
