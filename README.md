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
├── android-client/         # Android (Java) - real device GPS tracker
│   ├── AndroidManifest.xml   # Permissions + LocationService declaration
│   ├── build.gradle          # Firebase / Play Services dependencies
│   ├── LocationService.java  # Foreground Service (GPS 5s → Firebase)
│   └── MainActivity.java     # Runtime permission + start service
├── start.py                # One-click launcher (dashboard + tracker)
├── firebaseConfig.txt      # Firebase configuration reference
└── README.md
```

## Tech Stack

| Component        | Technology                                  |
| ---------------- | ------------------------------------------- |
| Map              | [LeafletJS](https://leafletjs.com) + OSM   |
| Realtime DB      | Firebase Realtime Database                  |
| Tracker (sim)    | Python 3 + `requests`                       |
| Tracker (Android)| Java, Foreground Service + FusedLocation   |
| Web Server       | Python `http.server`                        |

## Android Client (thay thế tool giả lập Python)

`android-client/` là mã nguồn Android (Java) để thay thế tool giả lập Python: thay vì tọa độ giả, **LocationService** sẽ lấy tọa độ GPS thật từ thiết bị và đẩy lên Firebase Realtime DB.

- **Đường dẫn đẩy dữ liệu:** `/devices/device_android_01` (cùng cấu trúc `{lat, lng, timestamp}` với tracker Python → web dashboard render được ngay).
- **Cấu hình Firebase** đọc từ `firebaseConfig.txt` (`databaseURL: https://locationrealtimeapps-default-rtdb.firebaseio.com`).
- **Permission flow:** `MainActivity` xin `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` rồi gọi `startForegroundService()` → `LocationService` chạy ngầm, cập nhật vị trí mỗi 5 giây bằng `FusedLocationProviderClient`.

### Copy vào Android Studio

1. Tạo project mới với package `com.example.locationtracker`.
2. Copy `AndroidManifest.xml`, `LocationService.java`, `MainActivity.java` vào `app/src/main/java/com/example/locationtracker/`.
3. Copy dependencies từ `build.gradle` vào `app/build.gradle`.
4. Chạy trên thiết bị thật (FusedLocation cần GPS/Play Services).
5. Bật quyền "Allow all the time" cho app trên Android 11+ để lấy tọa độ khi chạy ngầm.

> Lưu ý: có thể bỏ quyền `ACCESS_BACKGROUND_LOCATION` nếu chỉ cần chạy khi app đang mở.

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
