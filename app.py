from flask import Flask, render_template, request, jsonify
import os
import json
import tensorflow as tf
import numpy as np
from PIL import Image

app = Flask(__name__)

MODEL_PATH = "indian_monuments_classifier.h5"


def _create_placeholder_model(save_path: str, num_classes: int) -> tf.keras.Model:
    """Create a minimal model so /predict works when the trained .h5 is missing."""
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(128, 128, 3)),
        tf.keras.layers.Flatten(),
        tf.keras.layers.Dense(64, activation="relu"),
        tf.keras.layers.Dense(num_classes, activation="softmax"),
    ])
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    model.save(save_path, save_format="h5")
    return model


# Load model, or create and save a placeholder if missing
model = None
with open("class_names.json", "r") as f:
    _class_names = json.load(f)
num_classes = len(_class_names)

if os.path.isfile(MODEL_PATH):
    model = tf.keras.models.load_model(MODEL_PATH)
    print("Model output shape:", model.output_shape)
    print("Model input shape:", model.input_shape)
else:
    print("Model file not found. Creating placeholder model (replace with your trained model for real predictions).")
    model = _create_placeholder_model(MODEL_PATH, num_classes)
    print("Placeholder model saved and loaded.")

class_names = _class_names
print("Number of class names:", len(class_names))

@app.route("/")
def home():
    return render_template("index.html")  # must be inside templates folder

@app.route("/predict", methods=["POST"])
def predict():
    if model is None:
        return jsonify({
            "prediction": "Error",
            "confidence": 0,
            "error": "Model not loaded. Add indian_monuments_classifier.h5 to the project root."
        }), 503
    try:
        file = request.files["image"]

        img = Image.open(file).convert("RGB")
        img = img.resize((128, 128))
        img = np.array(img) / 255.0
        img = np.expand_dims(img, axis=0)

        prediction = model.predict(img)
        class_index = int(np.argmax(prediction))
        confidence = float(np.max(prediction))

        # Safety check
        if class_index < len(class_names):
            result = class_names[class_index]
        else:
            result = "Unknown Landmark"

        return jsonify({
            "prediction": result,
            "confidence": round(confidence * 100, 2)
        })

    except Exception as e:
        print("Prediction error:", e)
        return jsonify({
            "prediction": "Error",
            "confidence": 0
        }), 500

if __name__ == "__main__":
    app.run(debug=True)