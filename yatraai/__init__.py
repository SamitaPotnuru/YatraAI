"""YatraAI / Scout Pro Flask application factory."""

import os

from flask import Flask

from yatraai.config import Config
from yatraai.prediction import MonumentPredictor
from yatraai.routes import bp as main_bp


def create_app(config_class: type = Config) -> Flask:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(
        __name__,
        template_folder=os.path.join(root, "templates"),
        static_folder=os.path.join(root, "static"),
    )
    app.config.from_object(config_class)

    app.config["PREDICTOR"] = MonumentPredictor(
        model_path=config_class.MODEL_PATH,
        class_names_path=config_class.CLASS_NAMES_PATH,
        top1_threshold=config_class.TOP1_THRESHOLD,
    )

    app.register_blueprint(main_bp)
    return app
