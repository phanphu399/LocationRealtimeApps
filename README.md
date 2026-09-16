# 📍 GPS Realtime Tracker

Hệ thống theo dõi vị trí GPS theo thời gian thực (real-time): thiết bị **Android** gửi tọa độ GPS lên **Firebase Realtime Database**, **Web Dashboard** (PWA + Leaflet) hiển thị marker, lộ trình, pin, tốc độ và cho phép ra lệnh điều khiển từ xa.

---

## 🏗️ Kiến trúc tổng thể

```
┌──────────────────────┐        ┌─────────────────────────────┐
│   ANDROID CLIENT     │        │     WEB DASHBOARD (PWA)     │
│  (FusedLocation)     │        │   https://your-app.vercel.app │
│                      │  PUT   │    index.html + app.js      │
│  LocationService ────────────▶  Firebase JS SDK (onValue)   │
│   GPS mỗi 5 giây     │        │        │                    │
│   lat, lng, speed,   │        │   Leaflet 1.9 map, marker,  │
│   battery, charging  │        │   polyline lộ trình         │
│   timestamp          │        │   Nominatim reverse geocode │
│                      │        │   Service Worker (offline)  │
│   ┌── command ───────┼────────│   PLAY_SOUND / VOLUME_UP    │
└──────────┬───────────┘        └──────┬──────────────────────┘
           │                          │
           └──────────▶  FIREBASE ◀───┘
              Realtime Database  (real-time sync, tự thay đổi push)
                          ▲
                          │
                   track_coords (optional)
```

### Luồng dữ liệu

1. **Android** (`LocationService` - Foreground Service) lấy GPS qua `FusedLocationProviderClient` mỗi 5 giây → ghi `updateChildren` lên **Firebase RTDB**:
   ```
   /devices/<DEVICE_PATH>   { lat, lng, timestamp, battery, charging, speed }
   ```
2. **Web Dashboard** đăng ký `onValue(ref(db, "devices"))` → nhận **mọi thay đổi theo thời gian thực**, không cần WebSocket/polling (Firebase tự push qua WebSocket).
3. Dashboard render marker trên **Leaflet**, vẽ **polyline lịch sử** (tối đa 250 điểm/thiết bị), hiển thị **telemetry** (pin, sạc, tốc độ km/h) và **trạng thái online/offline** (TTL 60 giây).
4. Người dùng bấm nút → dashboard ghi `command: "PLAY_SOUND"` / `"VOLUME_UP"` vào `/devices/<id>/command` → Android lắng nghe và thực thi, sau đó reset về `"NONE"`.

### Định danh thiết bị

- **Android:** `DEVICE_ID = Build.MODEL` (ví dụ `Pixel 6`), làm sạch ký tự, fallback `device`. Đường dẫn: `/devices/Pixel 6`.
- **Mô phỏng:** thiết bị có tên chứa `python` hoặc bắt đầu bằng `sim` được xem là mô phỏng và ẩn theo mặc định (bật toggle **Sim** để hiện).

---

## 🧩 Công nghệ & Giao thức

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Map | **Leaflet 1.9** + nhiều lớp tile (OSM đường phố mặc định, CARTO Positron sáng, Voyager, vệ tinh Esri) | Hiển thị bản đồ, marker, polyline |
| Realtime DB | **Firebase Realtime Database** (WebSocket push) | Đồng bộ vị trí real-time 2 chiều |
| Reverse geocode | **Nominatim OSM API** (cache + debounce 10s) | Địa chỉ tiếng Việt cho marker |
| Routing | **OSRM Public API** (`router.project-osrm.org`, profile: driving/walking/cycling) | Mô phỏng di chuyển dọc tuyến đường ngắn nhất thực tế |
| Geolocation (web) | **Browser Geolocation API** (`watchPosition`, high accuracy, `maximumAge=0`) | Hiển thị "bạn đang ở đâu" |
| Geolocation (Android) | **FusedLocationProviderClient** (`PRIORITY_HIGH_ACCURACY`, 5s) | Tọa độ GPS điện thoại |
| Android Background | **Foreground Service** (START_STICKY) + battery-optimization whitelist | Chạy ngầm, không bị kill |
| Web App | **PWA** (manifest + Service Worker, cache-first offline) | Cài đặt lên màn hình chính Android/iOS |
| Command | Firebase node `command` (`PLAY_SOUND`, `VOLUME_UP`) | Điều khiển điện thoại từ web |

---

## 📁 Cấu trúc thư mục

```
location_app_realtime/
├── web-dashboard/                 # Frontend PWA
│   ├── index.html                 # Giao diện (sidebar / bottom-sheet mobile)
│   ├── style.css                  # Theme sáng hiện đại, responsive
│   ├── app.js                     # Firebase SDK + Leaflet + logic realtime
│   ├── sw.js                      # Service Worker (offline cache, cache v6)
│   ├── manifest.json              # PWA (standalone, icons 192/512 maskable)
│   └── icons/                     # icon-180/192/512.png, favicon.png
├── android-client/                # Android (Java)
│   └── app/src/main/
│       ├── java/com/example/locationtracker/
│       │   ├── MainActivity.java      # Quyền + battery whitelist + start service
│       │   ├── LocationService.java   # Foreground service: GPS 5s → Firebase
│       │   └── FirebaseConfig.java    # DEVICE_ID từ Build.MODEL, paths
│       ├── res/layout/activity_main.xml
│       ├── res/values/colors.xml
│       └── AndroidManifest.xml
├── background-tracker/tracker.py  # (Optional) tool giả lập GPS Python — tắt mặc định
├── start.py                       # Khởi động dashboard local (không tự chạy tracker)
└── .github/workflows/build-apk.yml# CI build APK mỗi lần push
```

---

## 🚀 Quick Start

### 1. Web Dashboard (PWA)

Chạy local:
```bash
cd web-dashboard
python -m http.server 8080        # hoặc bất kỳ static server nào
# mở http://localhost:8080
```

Hoặc deploy lên **Vercel / Netlify / GitHub Pages** — folder `web-dashboard` là static site thuần.

### 2. Android Client

Build bằng **GitHub Actions** (đã có workflow, push lên `main` là tự build APK trong tab *Actions*) hoặc mở `android-client/` bằng Android Studio → `Run`.

Trên điện thoại:
1. Cài APK, cấp quyền: **Location** (Allow all the time) + mở app.
2. Đồng ý **"Quyền hoạt động ngầm"** (bỏ battery-optimization) → app chạy nền không bị dừng.
3. Mở dashboard → thiết bị `Pixel 6` xuất hiện tự động, cập nhật mỗi 5 giây.

### 3. (Tùy chọn) Mô phỏng GPS bằng Python

```bash
python background-tracker/tracker.py
```
Tạo thiết bị ảo `device_python_01` đi ngẫu nhiên — thành phần này **mặc định tắt** khi chạy `start.py` để không làm nhiễu bản đồ thật.

> 💡 Không có điện thoại? Bấm **"Mô phỏng tuyến đường"** trên dashboard → tap điểm đến trên bản đồ → thiết bị ảo `sim_demo_01` di chuyển dọc tuyến đường ngắn nhất theo phương tiện đã chọn (ô tô/xe máy, đi bộ, xe đạp) qua **OSRM routing**.

---

## 🗄️ Data Schema (Firebase RTDB)

```
/devices/
├── <DEVICE_ID>/
│   ├── lat        : number   # latitude (6 chữ số thập phân)
│   ├── lng        : number   # longitude
│   ├── timestamp  : number   # epoch seconds
│   ├── battery    : number   # % pin (0-100)
│   ├── charging   : boolean  # đang sạc?
│   ├── speed      : number   # km/h (Android: từ Location.getSpeed())
│   └── command    : string   # "NONE" | "PLAY_SOUND" | "VOLUME_UP"
```

> Web đánh dấu thiết bị **offline** nếu `timestamp` cũ hơn **60 giây**.

---

## ⚙️ Cấu hình

| Nơi | Config |
|---|---|
| `web-dashboard/app.js` | `firebaseConfig` (apiKey, databaseURL, projectId, appId) |
| `android-client/.../FirebaseConfig.java` | `API_KEY`, `DATABASE_URL`, `PROJECT_ID`, `APP_ID` |
| Tham số web | `MIN_STEP_M` (15 m dead-zone chống nhiễu GPS), `MAX_JUMP_M` (500 m guard), `DEVICE_TTL_MS` (60 s), `MAX_HISTORY` (250 điểm lộ trình), geolocation `maximumAge=0`/`timeout=10s` (fix GPS mới nhất) |
| Android | `UPDATE_INTERVAL_MS` (5 s), `ALARM_DURATION_MS` (10 s) |
| Mô phỏng | `SIM_SPEED` (driving 45 km/h, walking 5, cycling 20), profile OSRM `driving`/`walking`/`cycling`; OSRM public không có profile đường thủy (`waterway`) |

---

## 🎯 Tính năng

- ✅ Map realtime nhiều lớp nền (OSM đường phố mặc định, CARTO sáng, Voyager, vệ tinh)
- ✅ Chống nhiễu/jitter GPS: dead-zone 15 m, teleport guard, làm mượt marker, vòng tròn sai số giới hạn 300 m → hết hiện tượng "sao băng"
- ✅ Lộ trình dạng polyline + mũi tên hướng di chuyển trên marker
- ✅ Khoảng cách "Đã đi" = tổng chiều dài lộ trình thực tế (breadcrumb tích lũy), không phải đường chim bay
- ✅ Telemetry: pin %, icon ⚡ khi sạc, tốc độ km/h, timestamp
- ✅ Trạng thái online/offline tự động (TTL 60 s)
- ✅ Bám theo ("follow") vị trí của bạn hoặc theo từng thiết bị
- ✅ Điều khiển từ xa: phát âm thanh, tăng âm lượng (PLAY_SOUND / VOLUME_UP)
- ✅ Xóa thiết bị khỏi map, toggle hiện/ẩn thiết bị mô phỏng
- ✅ **Mô phỏng theo routing OSRM**: chọn phương tiện (ô tô/xe máy, đi bộ, xe đạp), tap điểm đến trên bản đồ → tính tuyến ngắn nhất theo đường thực tế → thiết bị ảo chạy dọc tuyến với tốc độ, pin, quãng đường và % tiến độ
- ✅ PWA: cài lên màn hình chính Android/iOS, offline cache
- ✅ Định vị web chính xác hơn: `maximumAge=0` luôn lấy fix GPS mới nhất, `getCurrentPosition` khởi động nhanh
- ✅ Android: Foreground Service START_STICKY + battery whitelist

## License

MIT