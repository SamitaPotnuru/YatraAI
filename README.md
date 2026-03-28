# YatraAI — Scout Pro

A Flask web app for **Indian heritage travel**: upload a monument photo for AI-assisted identification, check weather, chat with a travel assistant, plan routes on a map, and explore nearby places. The UI is branded **Scout Pro**.

---

## What you can do

| Feature | What it needs |
|--------|----------------|
| **Scan landmark** | TensorFlow model (`.h5`) + optional **Groq** API key for vision fallback |
| **Weather & brief** | **OpenWeather** API key (browser calls OpenWeather + Wikipedia) |
| **Travel chat** | **Groq** API key (browser calls Groq) |
| **Navigation & nearby** | No API key (OpenStreetMap, Nominatim, Overpass) |
| **Feedback** | Formspree endpoint (already wired in the template) |

---

## How it works (simple)

1. You run the **Flask server** on your machine.
2. The browser loads **one page** (`/`) with maps, forms, and scripts.
3. **Landmark scan**: the image is sent to **`POST /predict`**. A **local neural network** guesses the monument class. If its top prediction is **strong enough** (see threshold below), that label is returned. If not, the server can call **Groq’s vision model** using your `GROQ_API_KEY` (image is re-encoded as JPEG for the API).
4. **Groq / OpenWeather keys** are read from **`.env`** on the server and injected into the page for client-side calls (anyone who opens the page can see them in the HTML/Network tab—**do not expose this app publicly** without moving those calls server-side).

---

## Requirements

- **Python 3.10+** (3.11/3.12 work well)
- **pip** and a **virtual environment** (recommended)
- **RAM**: TensorFlow loads the model; 4 GB+ free RAM is comfortable for local dev

---

## Quick start

### 1. Clone and enter the project

```bash
cd YatraAI
```

### 2. Create a virtual environment and install dependencies

**Windows (PowerShell):**

```powershell
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
```

**macOS / Linux:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If `pip` inside the venv points to the wrong Python (e.g. after moving the folder), run `scripts/recreate_venv.ps1` from the repo root on Windows, or recreate the venv manually.

### 3. Configure environment variables

```bash
copy .env.example .env
```

On macOS/Linux: `cp .env.example .env`

Edit **`.env`** and set at least what you need:

| Variable | Purpose |
|----------|---------|
| `SECRET_KEY` | Flask secret; use a long random string in production |
| `GROQ_API_KEY` | Groq: chat + optional vision fallback for scans |
| `OPENWEATHER_API_KEY` | OpenWeather: geocoding + current weather |
| `GEMINI_API_KEY` | Reserved for future use in the UI |
| `LOCAL_MODEL_TOP1_THRESHOLD` | **0–1**. If the local model’s top softmax probability is **≥ this**, the app uses the **local** class name only; otherwise it tries **Groq vision** (if the key is set). Default is **0.8** if unset. Alias: `LOCAL_MODEL_MIN_CONFIDENCE`. |

Never commit **`.env`** (it is listed in `.gitignore`).

### 4. Add the trained model (optional but recommended)

Place your Keras model at the **project root** as:

`indian_monuments_classifier.h5`

It must match the class list in **`data/class_names.json`**.  
If the file is missing, the app **creates a small placeholder model** so `/predict` still runs (predictions will not be meaningful until you add a real model).

> **Note:** `*.h5` is ignored by git in this repo (large files). Share the model separately or train your own using **`ML_Model.ipynb`**.

### 5. Run the app

**Windows:**

```powershell
.\.venv\Scripts\python.exe app.py
```

**macOS / Linux:**

```bash
source .venv/bin/activate
python app.py
```

Open **http://127.0.0.1:5000/** in your browser.

---

## Project layout

```
YatraAI/
├── app.py                 # Dev entry: creates Flask app, runs debug server
├── requirements.txt       # Python dependencies
├── .env.example             # Template for environment variables
├── data/
│   └── class_names.json     # Labels for the monument classifier (order matches model output)
├── templates/
│   └── index.html           # Scout Pro UI (Tailwind CDN + Leaflet)
├── static/
│   ├── css/scout.css        # Theme, layout, accessible light/dark mode
│   └── js/scout.js          # Map, weather, chat, routing, nearby POIs
├── yatraai/                 # Application package
│   ├── __init__.py          # create_app(), wires predictor + routes
│   ├── config.py            # Paths, env-loaded settings
│   ├── routes.py            # GET /, POST /predict
│   └── prediction.py        # TensorFlow inference + Groq vision fallback
├── scripts/
│   └── recreate_venv.ps1    # Windows: rebuild venv if paths break
└── ML_Model.ipynb           # Notebook used to train / experiment with the model
```

---

## API (for developers)

### `POST /predict`

- **Body**: `multipart/form-data` with field name **`image`** (file).
- **Success**: JSON like `{ "prediction": "...", "engine": "Local TensorFlow model" | "Llama-4-Scout (Groq API)" | ... }`.
- **Errors**: `{ "prediction": "Error", "error": "..." }` with appropriate HTTP status.

Supported image types are whatever **Pillow** can open after upload (JPEG, PNG, WebP, GIF, BMP, TIFF, etc.). Phone **HEIC** files may need extra libraries.

---

## Troubleshooting

| Problem | What to try |
|--------|-------------|
| `ModuleNotFoundError` (Flask, dotenv, …) | Activate the correct venv and run `pip install -r requirements.txt`. |
| `pip` launcher error on Windows | Venv was created in another folder; run `scripts/recreate_venv.ps1` or recreate `.venv`. |
| Scan always wrong or generic | Add a real `indian_monuments_classifier.h5` and verify `data/class_names.json` matches training. |
| Weather / chat not working | Set `OPENWEATHER_API_KEY` / `GROQ_API_KEY` in `.env` and restart Flask. |
| TensorFlow slow or noisy logs | Normal on CPU; set `TF_ENABLE_ONEDNN_OPTS=0` if you want to silence oneDNN messages (optional). |

---

## Security notes

- Treat **API keys** as secrets. This project passes some keys to the **browser** for simplicity; that is **not safe** for a public production site.
- For production, use a strong `SECRET_KEY`, HTTPS, and move third-party API calls to **server-side routes** so keys never appear in client code.

---

## License

Add a license file if you distribute this project; none is set in the repository by default.

---

## Summary

**YatraAI / Scout Pro** is a single-page Flask app plus a TensorFlow monument classifier, with optional Groq vision and OpenWeather. Configure **`.env`**, add **`indian_monuments_classifier.h5`**, run **`python app.py`**, and open **http://127.0.0.1:5000** to use it.
