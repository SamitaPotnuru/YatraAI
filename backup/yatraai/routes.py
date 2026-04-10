"""HTTP routes for Scout Pro."""

from flask import Blueprint, current_app, jsonify, render_template, request

bp = Blueprint("main", __name__)


@bp.route("/")
def home():
    cfg = current_app.config
    return render_template(
        "index.html",
        groq_key=cfg.get("GROQ_API_KEY", ""),
        weather_key=cfg.get("OPENWEATHER_API_KEY", ""),
        gemini_key=cfg.get("GEMINI_API_KEY", ""),
    )


@bp.route("/login")
def login():
    return render_template("login.html")


@bp.route("/predict", methods=["POST"])
def predict():
    predictor = current_app.config.get("PREDICTOR")
    if predictor is None:
        return jsonify({"prediction": "Error", "error": "Predictor not initialized"}), 503

    if "image" not in request.files:
        return jsonify({"prediction": "Error", "error": "No image field"}), 400

    file = request.files["image"]
    if not file or not file.filename:
        return jsonify({"prediction": "Error", "error": "Empty file"}), 400

    # Basic extension validation
    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ["jpg", "jpeg", "png", "webp"]:
        return jsonify({"prediction": "Error", "error": f"Unsupported file type: {ext}"}), 400

    cfg = current_app.config
    try:
        result = predictor.predict(
            file,
            groq_api_key=cfg.get("GROQ_API_KEY", ""),
            groq_url=cfg["GROQ_VISION_URL"],
            groq_model=cfg["GROQ_VISION_MODEL"],
        )
        return jsonify(result)
    except Exception:  # noqa: BLE001 — image/model failures
        current_app.logger.exception("predict failed")
        return jsonify({"prediction": "Error", "error": "Prediction failed"}), 500
