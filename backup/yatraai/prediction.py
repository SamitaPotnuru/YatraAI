"""TensorFlow monument classifier with optional Groq vision fallback."""

from __future__ import annotations

import base64
import json
import os
import re
from io import BytesIO
from typing import Any

import numpy as np
import requests
try:
    import tensorflow as tf
except (ImportError, Exception):
    tf = None
from PIL import Image
from werkzeug.datastructures import FileStorage

# Max longest side sent to Groq (keeps detail, limits payload)
_VISION_MAX_SIDE = 1280
_VISION_JPEG_QUALITY = 88
_TOP_K_HINTS = 5


def _create_placeholder_model(save_path: str, num_classes: int) -> tf.keras.Model:
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(128, 128, 3)),
            tf.keras.layers.Flatten(),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )
    model.compile(
        optimizer="adam",
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.save(save_path, save_format="h5")
    return model


def _load_or_create_model(model_path: str, num_classes: int) -> tf.keras.Model:
    if os.path.isfile(model_path):
        try:
            return tf.keras.models.load_model(model_path)
        except Exception:
            # If load fails (corrupt, incompatible version), fall back to placeholder
            pass
    return _create_placeholder_model(model_path, num_classes)


def _encode_pil_jpeg_b64(img: Image.Image) -> str:
    """Resize (if huge) and encode as real JPEG for vision APIs (fixes PNG/WebP mislabeled as jpeg)."""
    rgb = img.convert("RGB")
    rgb.thumbnail((_VISION_MAX_SIDE, _VISION_MAX_SIDE), Image.Resampling.LANCZOS)
    buf = BytesIO()
    rgb.save(buf, format="JPEG", quality=_VISION_JPEG_QUALITY, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _top_k_candidates(probs: np.ndarray, class_names: list[str], k: int) -> list[tuple[str, float]]:
    k = min(k, len(class_names))
    idx = np.argsort(probs)[-k:][::-1]
    return [(class_names[i], float(probs[i]) * 100.0) for i in idx]


def _build_groq_monument_prompt(
    top_candidates: list[tuple[str, float]],
    all_labels: list[str],
) -> str:
    """Bias vision model toward our label set and disambiguate similar rock-cut sites."""
    lines = [
        "You are an expert on Indian heritage monuments (UNESCO sites, ASI monuments, rock-cut caves).",
        "",
        "A CNN trained only on Indian monuments produced these candidates (scores are softmax %; they can be wrong):",
    ]
    for i, (name, pct) in enumerate(top_candidates, start=1):
        lines.append(f"  {i}. {name} — {pct:.2f}%")
    lines.extend(
        [
            "",
            "Disambiguation: Ajanta Caves are near Aurangabad/Jalgaon (Maharashtra), famous for Buddhist mural paintings in horseshoe-shaped facades. "
            "Karla/Karle Caves are near Lonavala (Maharashtra) with a large chaitya hall facade. "
            "Ellora is near Aurangabad with Hindu/Buddhist/Jain caves. Do not confuse these.",
            "",
            "If the photo clearly matches one of the numbered candidates, respond with that monument's usual English name and city/state.",
            "If none fit, give the correct monument name and city/state you see in the image.",
            "",
            "Respond with exactly ONE line, no preamble, format:",
            "Name — City/State, India",
            'Do not start with "The monument", "This is", or similar.',
            "",
            "Known labels this app uses (match spelling when applicable): "
            + ", ".join(all_labels),
        ]
    )
    return "\n".join(lines)


def _clean_vision_reply(text: str) -> str:
    """Strip filler phrases models often add."""
    t = " ".join(text.replace("\r", "\n").split())
    patterns = (
        r"^the monument in the image is[:\s,]*",
        r"^the monument is[:\s,]*",
        r"^this (is|appears to be)[:\s,]*",
        r"^based on the image,?\s*",
        r"^identification[:\s]*",
    )
    for _ in range(3):
        orig = t
        for p in patterns:
            t = re.sub(p, "", t, flags=re.IGNORECASE).strip()
        if t == orig:
            break
    return t.strip()


class MonumentPredictor:
    """Local TF first; if top-1 softmax p is below threshold, call Groq. Reported % is not classification accuracy."""

    def __init__(self, model_path: str, class_names_path: str, top1_threshold: float) -> None:
        try:
            with open(class_names_path, "r", encoding="utf-8") as f:
                self.class_names: list[str] = json.load(f)
        except Exception:
            self.class_names = []
            
        self._num_classes = len(self.class_names)
        self.top1_threshold = top1_threshold
        
        if tf is None:
            self.model = None
            return

        self.model = _load_or_create_model(model_path, self._num_classes)

    def predict(
        self,
        file: FileStorage,
        *,
        groq_api_key: str,
        groq_url: str,
        groq_model: str,
    ) -> dict[str, Any]:
        file.seek(0)
        raw_bytes = file.read()
        pil_full = Image.open(BytesIO(raw_bytes)).convert("RGB")

        p_top1 = 0.0
        class_index = 0
        top_candidates = []

        if self.model:
            img_resized = pil_full.resize((128, 128), Image.Resampling.LANCZOS)
            arr = np.array(img_resized) / 255.0
            batch = np.expand_dims(arr, axis=0)

            try:
                raw = self.model.predict(batch, verbose=0)
                probs = raw[0].astype(np.float64)
                class_index = int(np.argmax(probs))
                p_top1 = float(np.max(probs))
                top_candidates = _top_k_candidates(probs, self.class_names, _TOP_K_HINTS)
            except Exception:
                p_top1 = 0.0
                top_candidates = []
        
        # If local model exists and confidence is high, use it.
        if self.model and p_top1 >= self.top1_threshold:
            name = (
                self.class_names[class_index]
                if class_index < len(self.class_names)
                else "Unknown"
            )
            return {
                "prediction": name,
                "engine": "Local TensorFlow model",
            }

        if not groq_api_key:
            name = (
                self.class_names[class_index]
                if class_index < len(self.class_names)
                else "Unknown"
            )
            return {
                "prediction": f"{name} (add GROQ_API_KEY for AI vision fallback)",
                "engine": "Local (Groq not configured)",
            }

        img_b64 = _encode_pil_jpeg_b64(pil_full)
        user_prompt = _build_groq_monument_prompt(top_candidates, self.class_names)

        payload = {
            "model": groq_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"},
                        },
                    ],
                }
            ],
            "max_tokens": 120,
            "temperature": 0.2,
        }
        try:
            response = requests.post(
                groq_url,
                headers={
                    "Authorization": f"Bearer {groq_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=60,
            )
        except requests.RequestException:
            name = self.class_names[class_index] if class_index < len(self.class_names) else "Unknown"
            return {
                "prediction": f"{name} (network error calling Groq)",
                "engine": "Local (Groq unreachable)",
            }

        if response.status_code == 200:
            data = response.json()
            text = data["choices"][0]["message"]["content"].strip()
            text = _clean_vision_reply(text)
            return {
                "prediction": text,
                "engine": "Llama-4-Scout (Groq API)",
            }

        name = self.class_names[class_index] if class_index < len(self.class_names) else "Unknown"
        return {
            "prediction": f"{name} (Groq error {response.status_code})",
            "engine": "Local (Groq API error)",
        }
