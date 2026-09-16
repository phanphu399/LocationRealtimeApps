import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* ==================================================================
   FIREBASE CONFIG - đồng bộ với firebaseConfig.txt
   ================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyD_mMdWjE7xcI4fqAX03iP5p4joq1af838",
  authDomain: "locationrealtimeapps.firebaseapp.com",
  databaseURL: "https://locationrealtimeapps-default-rtdb.firebaseio.com",
  projectId: "locationrealtimeapps",
  storageBucket: "locationrealtimeapps.firebasestorage.app",
  messagingSenderId: "549557847899",
  appId: "1:549557847899:web:18339736baa351804c3c7e",
  measurementId: "G-MKSWLH97HQ"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* ==================================================================
   MAP - 2 lớp bản đồ (OSM + Satellite)
   ================================================================== */

const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
});

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "&copy; Esri, Maxar, Earthstar Geographics" }
);

const map = L.map("map", {
  center: [10.762622, 106.660172],
  zoom: 12,
  layers: [satelliteLayer]
});

L.control.layers(
  { "Bản đồ đường phố": osmLayer, "Bản đồ vệ tinh": satelliteLayer },
  null,
  { position: "topright", collapsed: false }
).addTo(map);

/* ==================================================================
   STATE
   ================================================================== */

const DEVICE_TTL_MS = 60_000;          // 60s không nhận dữ liệu => coi như offline
let myPos = null;                       // [lat, lng] của trình duyệt
let myMarker = null;                    // L.circleMarker "bạn đang ở đây"
let myAccuracyCircle = null;
const deviceMarkers = {};               // deviceId -> L.marker
const deviceData = {};                  // deviceId -> { lat, lng, ts, command }
let didMoveToFirstFix = false;          // đã tự di chuyển bản đồ lần đầu

/* ==================================================================
   DOM REFS
   ================================================================== */

const $ = (id) => document.getElementById(id);
const connDot      = $("connDot");
const connText     = $("connText");
const myLat        = $("myLat");
const myLng        = $("myLng");
const myAccuracy   = $("myAccuracy");
const deviceList   = $("deviceList");
const listEmpty    = $("deviceListEmpty");
const devStatus    = $("deviceStatus");
const statLat      = $("statLat");
const statLng      = $("statLng");
const statTime     = $("statTime");
const statDistance = $("statDistance");
const btnPlaySound = $("btnPlaySound");
const TARGET_DEVICE = "device_android_01";

/* ==================================================================
   TRẠNG THÁI KẾT NỐI FIREBASE (.info/connected)
   ================================================================== */

onValue(ref(db, ".info/connected"), (snap) => {
  const connected = snap.val() === true;
  connDot.className = "conn-dot " + (connected ? "online" : "offline");
  connText.textContent = connected
    ? "Đã kết nối Firebase"
    : "Mất kết nối Firebase";
});

/* ==================================================================
   VỊ TRÍ CỦA BẠN (Browser Geolocation - realtime, tự cập nhật)
   ================================================================== */

function logMyLocation (position) {
  const { latitude, longitude, accuracy } = position.coords;
  myPos = [latitude, longitude];

  myLat.textContent = latitude.toFixed(6);
  myLng.textContent = longitude.toFixed(6);
  myAccuracy.textContent = `Độ chính xác ±${Math.round(accuracy)} m · tự cập nhật`;

  if (myMarker) {
    myMarker.setLatLng(myPos);
    myAccuracyCircle.setLatLng(myPos).setRadius(accuracy);
  } else {
    myAccuracyCircle = L.circle(myPos, {
      radius: accuracy,
      color: "#1a73e8",
      weight: 1,
      fillColor: "#1a73e8",
      fillOpacity: 0.08
    }).addTo(map);

    myMarker = L.circleMarker(myPos, {
      radius: 7,
      color: "#ffffff",
      weight: 2.5,
      fillColor: "#1a73e8",
      fillOpacity: 1,
      className: "my-pulse"
    }).addTo(map).bindPopup("<b>Bạn đang ở đây</b>");
  }

  fitView();
  updateDistances();
}

function failMyLocation (err) {
  myAccuracy.textContent = `Không lấy được vị trí: ${err.message || "đã từ chối quyền"}`;
}

function initMyLocation () {
  if (!("geolocation" in navigator)) {
    myAccuracy.textContent = "Trình duyệt không hỗ trợ định vị";
    return;
  }
  // watchPosition: cập nhật liên tục khi người dùng di chuyển (realtime)
  navigator.geolocation.watchPosition(logMyLocation, failMyLocation, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  });
}

/* ==================================================================
   LẮNG NGHE /devices (realtime từ Firebase)
   ================================================================== */

const deviceRef = ref(db, "devices");

onValue(deviceRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) { renderDeviceList(); return; }

  for (const [deviceId, device] of Object.entries(data)) {
    if (device.lat == null || device.lng == null) continue;

    deviceData[deviceId] = {
      lat: Number(device.lat),
      lng: Number(device.lng),
      ts: (device.timestamp || 0) * 1000,
      command: device.command
    };

    upsertDeviceMarker(deviceId);
  }

  renderDeviceList();
  updateDetailCard();
  updateDistances();
  fitView();
});

/** Tạo mới hoặc di chuyển marker của thiết bị (hiệu ứng realtime). */
function upsertDeviceMarker (deviceId) {
  const d = deviceData[deviceId];
  const latLng = [d.lat, d.lng];

  if (deviceMarkers[deviceId]) {
    deviceMarkers[deviceId].setLatLng(latLng);
    deviceMarkers[deviceId].setPopupContent(buildPopup(deviceId));
    return;
  }

  const isPython = deviceId.includes("python");
  const icon = L.divIcon({
    className: "leaflet-div-icon",
    html: `<div class="device-pin">
             <span class="pulse-ring"></span>
             <span class="pin-dot ${isPython ? "python" : ""}"></span>
           </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  const marker = L.marker(latLng, { icon }).addTo(map);
  marker.bindPopup(buildPopup(deviceId));
  deviceMarkers[deviceId] = marker;
}

function buildPopup (deviceId) {
  const d = deviceData[deviceId];
  const dist = myPos ? fmtDistance(haversine(myPos, [d.lat, d.lng])) : "--";
  return `<div class="pop-title">${deviceId}</div>
          <div class="pop-row">Lat: ${d.lat.toFixed(6)}</div>
          <div class="pop-row">Lng: ${d.lng.toFixed(6)}</div>
          <div class="pop-dist">Cách bạn ${dist}</div>`;
}

/* ==================================================================
   RENDER DANH SÁCH THIẾT BỊ (freshness = realtime offline/online)
   ================================================================== */

function renderDeviceList () {
  const ids = Object.keys(deviceData);
  listEmpty.style.display = ids.length ? "none" : "block";
  deviceList.innerHTML = "";

  const now = Date.now();
  for (const [deviceId, d] of Object.entries(deviceData)) {
    const fresh = now - d.ts < DEVICE_TTL_MS;
    const ageSec = Math.max(0, Math.floor((now - d.ts) / 1000));
    const dist = myPos ? fmtDistance(haversine(myPos, [d.lat, d.lng])) : "--";

    const item = document.createElement("div");
    item.className = "device-list-item";
    item.innerHTML = `
      <span class="dev-dot ${fresh ? "online" : "offline"}"></span>
      <div class="dev-info">
        <div class="dev-name">${deviceId}</div>
        <div class="dev-sub">${fresh ? activeLabel(ageSec) : `Không tín hiệu · ${ageSec}s trước`}</div>
      </div>
      <div class="dev-dist">${dist}</div>`;
    deviceList.appendChild(item);
  }
}

function activeLabel (sec) {
  if (sec < 3) return "Đang hoạt động";
  if (sec < 60) return `Cập nhật ${sec}s trước`;
  return `Cập nhật ${Math.floor(sec / 60)} phút trước`;
}

function updateDetailCard () {
  const d = deviceData[TARGET_DEVICE];
  if (!d) return;

  const fresh = Date.now() - d.ts < DEVICE_TTL_MS;
  devStatus.textContent = fresh ? "Đang hoạt động" : "Mất tín hiệu";
  devStatus.className = "device-status " + (fresh ? "online" : "offline");

  statLat.textContent = d.lat.toFixed(6);
  statLng.textContent = d.lng.toFixed(6);
}

/* ==================================================================
   ĐẾM NGƯỢC THỜI GIAN CẬP NHẬT (realtime mỗi giây)
   ================================================================== */

setInterval(() => {
  const d = deviceData[TARGET_DEVICE];
  if (!d) return;
  const sec = Math.max(0, Math.floor((Date.now() - d.ts) / 1000));
  statTime.textContent = sec < 1 ? "Vừa xong" : `${sec}s trước`;

  // Refresh lại danh sách để chuyển trạng thái online/offline đúng hạn
  renderDeviceList();
}, 1000);

/* ==================================================================
   KHOẢNG CÁCH (Haversine) + AUTO-FIT BẢN ĐỒ
   ================================================================== */

function haversine ([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDistance (m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function updateDistances () {
  if (!myPos) return;
  const d = deviceData[TARGET_DEVICE];
  if (d) statDistance.textContent = fmtDistance(haversine(myPos, [d.lat, d.lng]));
}

/** Tự động thu bản đồ vừa "bạn" vừa tất cả thiết bị khi có đủ thông tin. */
function fitView () {
  const hasMy = !!myPos;
  const deviceIds = Object.keys(deviceData);
  if (!hasMy && deviceIds.length === 0) return;

  if (!didMoveToFirstFix) {
    didMoveToFirstFix = true;
    if (hasMy && deviceIds.length === 0) return map.setView(myPos, 15);
  }

  const pts = [];
  if (hasMy) pts.push(myPos);
  deviceIds.forEach((id) => pts.push([deviceData[id].lat, deviceData[id].lng]));
  try {
    map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
  } catch (_) { /* ignore */ }
}

/* ==================================================================
   PLAY SOUND - Gửi lệnh PLAY_SOUND lên Firebase
   ================================================================== */

btnPlaySound.addEventListener("click", async () => {
  if (btnPlaySound.classList.contains("loading")) return;

  btnPlaySound.classList.add("loading");
  btnPlaySound.disabled = true;

  try {
    await set(ref(db, `devices/${TARGET_DEVICE}/command`), "PLAY_SOUND");
  } catch (err) {
    console.error("[Play Sound] Lỗi:", err);
  } finally {
    setTimeout(() => {
      btnPlaySound.classList.remove("loading");
      btnPlaySound.disabled = false;
    }, 1500);
  }
});

/* ==================================================================
   KHỞI ĐỘNG
   ================================================================== */

initMyLocation();
renderDeviceList();