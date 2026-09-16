# GPS Realtime Tracker

A real-time GPS tracking system with a web dashboard and background tracker tool powered by Firebase Realtime Database.

## Architecture

```
location_app_realtime/
├── web-dashboard/          # Frontend - LeafletJS map dashboard
│   ├── index.html
│   ├── style.css
│   └── app.js
├── background-tracker/     # Backend - Python GPS simulator
│   ├── tracker.py
│   └── requirements.txt
├── start.py                # One-click launcher (dashboard + tracker)
├── firebaseConfig.txt      # Firebase configuration reference
└── README.md
```

## Tech Stack

| Component        | Technology                                  |
| ---------------- | ------------------------------------------- |
| Map              | [LeafletJS](https://leafletjs.com) + OSM   |
| Realtime DB      | Firebase Realtime Database                  |
| Tracker          | Python 3 + `requests`                       |
| Web Server       | Python `http.server`                        |

## Quick Start

### Prerequisites

- Python 3.7+
- Internet connection (for Firebase + OSM tiles)

### Install dependencies

```bash
pip install -r background-tracker/requirements.txt
```

### Run everything

```bash
python start.py
```

This will:
1. Start the GPS tracker (`tracker.py`) sending coordinates to Firebase every 3 seconds.
2. Launch the web dashboard on **http://localhost:8080**.
3. Auto-open your default browser.

### Run manually

**Web Dashboard only:**
```bash
cd web-dashboard
python -m http.server 8080
```

**Tracker only:**
```bash
python background-tracker/tracker.py
```

## How It Works

1. **Tracker** writes device coordinates (`lat`, `lng`, `timestamp`) to Firebase path `/devices/device_python_01.json` via REST API every 3 seconds.
2. **Dashboard** listens to `/devices` on Firebase Realtime Database via the Firebase JS SDK.
3. When data changes, markers are created or updated on the LeafletJS map in real time.

## Configuration

Edit `firebaseConfig.txt` or update the config object in `web-dashboard/app.js` and `background-tracker/tracker.py` to use your own Firebase project.

| Key              | Description                    |
| ---------------- | ------------------------------ |
| `databaseURL`    | Firebase Realtime DB endpoint  |
| `apiKey`         | Firebase Web API key           |
| `projectId`      | Firebase project ID            |

## License

MIT
