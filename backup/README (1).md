# YatraAI — Scout Pro

A Flask web app for **Indian heritage travel**: upload a monument photo for AI-assisted identification, check weather with a 7-day forecast, chat with a travel assistant using voice, plan routes on a map, manage your trip budget, and explore nearby places. The UI is branded **Scout Pro**.

---

## Key Features

| Feature | Description | Tech / API |
|---------|-------------|------------|
| **Scan Landmark** | Identity monuments via photo upload (Local TF + Groq Vision). | TensorFlow, Groq |
| **Weather & Brief** | Current conditions + **7-day forecast** + Wikipedia intel. | OpenWeather, Open-Meteo, Wikipedia |
| **Voice Search** | Speech-to-text input for weather, chat, and navigation. | Web Speech API |
| **Travel Chat** | Conversational AI assistant for travel tips and info. | Groq (Llama 3) |
| **Budget Planner** | Log expenses by category with visual chart breakdown. | Chart.js, LocalStorage |
| **Navigation** | Real-time routing, GPS tracking, and location persistence. | Leaflet, OSM, Nominatim |
| **Nearby Places** | Find beaches, temples, hotels, and more near your destination. | Overpass API |
| **Authentication** | Premium, standalone Login and Sign Up interface. | HTML/CSS (Stationary) |

---

## How it works

1. **Flask Server**: The backend handles image processing (`/predict`) and serves the static assets.
2. **AI Vision**: If the local model's confidence is low, the app utilizes **Groq's Vision API** to identify the monument.
3. **Voice Input**: Integrated microphone icons (🎤) allow for hands-free searching and chatting across the app.
4. **Data Persistence**: Your theme preference, last known location, and budget logs are saved locally in your browser for a seamless experience across refreshes.

---

## Quick Start

### 1. Installation

```bash
# Clone and enter the project
cd YatraAI

# Create virtual environment
python -m venv .venv
# Windows:
.\.venv\Scripts\pip.exe install -r requirements.txt
# macOS/Linux:
source .venv/bin/activate && pip install -r requirements.txt
```

### 2. Configuration

Copy `.env.example` to `.env` and configure your keys:
- `GROQ_API_KEY`: Required for chat and AI vision.
- `OPENWEATHER_API_KEY`: Required for current weather.
- `SECRET_KEY`: Set a random string for Flask sessions.

### 3. Run the App

```bash
python app.py
```
Visit **http://127.0.0.1:5000/** for the main app or **http://127.0.0.1:5000/login** for the auth page.

---

## Project Layout

```
YatraAI/
├── app.py                 # Application entry point
├── templates/
│   ├── index.html         # Main Scout Pro interface
│   └── login.html         # Premium authentication page
├── static/
│   ├── css/scout.css      # Core styling & glassmorphism
│   ├── js/scout.js        # Core logic: Map, Weather, Voice, Budget
│   └── images/
│       └── login_bg.png   # Themed background for login
├── yatraai/               # Backend logic & routes
├── data/
│   └── class_names.json   # Monument labels
└── ML_Model.ipynb         # Model training workspace
```

---

## Security & Usage
- **Local Use Recommended**: This app passes API keys to the browser for direct client-side calls. Do not host this publicly without migrating those calls to server-side routes.
- **Microphone Access**: Voice features require HTTPS or `localhost` to access the browser's `SpeechRecognition` API.

---

## Summary
**YatraAI / Scout Pro** is an all-in-one travel companion for exploring Indian landmarks. It combines deep learning, live weather data, budget management, and AI assistance into a single, premium visual package.
