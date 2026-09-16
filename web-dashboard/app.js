import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* ============================================================ */
/*  FIREBASE CONFIG                                              */
/* ============================================================ */

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

/* ============================================================ */
/*  MAP                                                          */
/* ============================================================ */

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

/* ============================================================ */
/*  STATE                                                        */
/* ============================================================ */

const DEVICE_TTL_MS = 60_000;
const TARGET_DEVICE = "device_android_01";
const GEOCODE_COOLDOWN_MS = 10_000;

let myPos = null;
let myMarker = null;
let myAccuracyCircle = null;
let firstFixDone = false;
const newDeviceFitted = {};
const deviceMarkers = {};
const deviceData = {};
const addressCache = new Map();
const geocodeTimestamps = {};
let lastFitTime = 0;

/* ============================================================ */
/*  DOM REFS                                                     */
/* ============================================================ */

const $ = (id) => document.getElementById(id);
const connDot         = $("connDot");
const connText        = $("connText");
const myAddress       = $("myAddress");
const myAccuracy      = $("myAccuracy");
const deviceList      = $("deviceList");
const listEmpty       = $("deviceListEmpty");
const devName         = $("deviceName");
const devStatus       = $("deviceStatus");
const deviceAddress   = $("deviceAddress");
const statTime        = $("statTime");
const statDistance    = $("statDistance");
const statAddress     = $("statAddress");
const statBattery     = $("statBattery");
const batteryFill     = $("batteryFill");
const batteryStatItem = $("batteryStatItem");
const btnPlaySound    = $("btnPlaySound");
const btnVolumeUp     = $("btnVolumeUp");
const btnFitMap       = $("btnFitMap");
const btnToggle       = $("btnToggle");
const overlay         = $("overlay");
const sidebar         = $("sidebar");

/* ============================================================ */
/*  REVERSE GEOCODING (Nominatim)                                */
/* ============================================================ */

async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (addressCache.has(key)) return addressCache.get(key);

  const now = Date.now();
  if (geocodeTimestamps[key] && now - geocodeTimestamps[key] < GEOCODE_COOLDOWN_MS) {
    return addressCache.get(key) || '';
  }
  geocodeTimestamps[key] = now;

  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&accept-language=vi`,
      { headers: { 'User-Agent': 'GPSTracker/1.0' } }
    );
    const data = await resp.json();
    const addr = data.display_name || '';
    addressCache.set(key, addr);
    return addr;
  } catch {
    return addressCache.get(key) || '';
  }
}

function getShortAddress(full) {
  if (!full) return '--';
  const parts = full.split(',').map(s => s.trim());
  return parts.length > 3 ? parts.slice(0, 3).join(', ') + '...' : full;
}

/* ============================================================ */
/*  HAMBURGER / MOBILE MENU                                      */
/* ============================================================ */

function openSidebar() {
  sidebar.classList.add('open');
  overlay.classList.add('open');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
}

btnToggle.addEventListener('click', () => {
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});

overlay.addEventListener('click', closeSidebar);

/* ============================================================ */
/*  FIREBASE CONNECTION STATUS                                   */
/* ============================================================ */

onValue(ref(db, ".info/connected"), (snap) => {
  const connected = snap.val() === true;
  connDot.className = "conn-dot " + (connected ? "online" : "offline");
  connText.textContent = connected ? "Đã kết nối Firebase" : "Mất kết nối Firebase";
});

/* ============================================================ */
/*  BROWSER GEOLOCATION                                          */
/* ============================================================ */

function onGeoSuccess(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const firstTime = !myPos;
  myPos = [latitude, longitude];

  myAccuracy.textContent = `Độ chính xác ±${Math.round(accuracy)} m · tự cập nhật`;

  reverseGeocode(latitude, longitude).then(addr => {
    myAddress.textContent = getShortAddress(addr) || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  });

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

  if (firstTime && !firstFixDone) {
    firstFixDone = true;
    const deviceIds = Object.keys(deviceData);
    if (deviceIds.length === 0) {
      map.setView(myPos, 15);
    }
  }

  updateDistances();
  updateDetailCardAddress();
}

function onGeoError(err) {
  myAccuracy.textContent = `Không lấy được vị trí: ${err.message || "đã từ chối quyền"}`;
}

function initGeolocation() {
  if (!("geolocation" in navigator)) {
    myAccuracy.textContent = "Trình duyệt không hỗ trợ định vị";
    return;
  }
  navigator.geolocation.watchPosition(onGeoSuccess, onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  });
}

/* ============================================================ */
/*  FIREBASE DEVICE LISTENER                                     */
/* ============================================================ */

const deviceRef = ref(db, "devices");

onValue(deviceRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) {
    renderDeviceList();
    return;
  }

  for (const [deviceId, device] of Object.entries(data)) {
    if (device.lat == null || device.lng == null) continue;

    const existed = !!deviceData[deviceId];

    deviceData[deviceId] = {
      lat: Number(device.lat),
      lng: Number(device.lng),
      ts: (device.timestamp || 0) * 1000,
      command: device.command,
      battery: device.battery != null ? Number(device.battery) : null
    };

    upsertDeviceMarker(deviceId);

    if (!existed && !newDeviceFitted[deviceId]) {
      newDeviceFitted[deviceId] = true;
      autoFitNewDevice(deviceId);
    }
  }

  renderDeviceList();
  updateDetailCard();
  updateDistances();
});

function autoFitNewDevice(deviceId) {
  const d = deviceData[deviceId];
  if (!d) return;
  const now = Date.now();
  if (now - lastFitTime < 5000) return;
  lastFitTime = now;
  const pts = [];
  if (myPos) pts.push(myPos);
  pts.push([d.lat, d.lng]);
  if (pts.length >= 2) {
    try { map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 }); } catch (_) {}
  }
}

/* ============================================================ */
/*  DEVICE MARKERS                                               */
/* ============================================================ */

function upsertDeviceMarker(deviceId) {
  const d = deviceData[deviceId];
  const latLng = [d.lat, d.lng];

  if (deviceMarkers[deviceId]) {
    deviceMarkers[deviceId].setLatLng(latLng);
    buildPopup(deviceId).then(html => {
      deviceMarkers[deviceId].setPopupContent(html);
    });
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
  deviceMarkers[deviceId] = marker;

  buildPopup(deviceId).then(html => {
    marker.bindPopup(html);
  });
}

async function buildPopup(deviceId) {
  const d = deviceData[deviceId];
  const dist = myPos ? fmtDistance(haversine(myPos, [d.lat, d.lng])) : "--";
  const addr = await reverseGeocode(d.lat, d.lng);
  const short = getShortAddress(addr);
  return `<div class="pop-title">${deviceId}</div>
          <div class="pop-addr">${short || d.lat.toFixed(6) + ', ' + d.lng.toFixed(6)}</div>
          <div class="pop-dist">Cách bạn ${dist}</div>`;
}

/* ============================================================ */
/*  RENDER DEVICE LIST                                           */
/* ============================================================ */

function renderDeviceList() {
  const ids = Object.keys(deviceData);
  listEmpty.style.display = ids.length ? "none" : "block";
  deviceList.innerHTML = "";

  const now = Date.now();
  for (const [deviceId, d] of Object.entries(deviceData)) {
    const fresh = now - d.ts < DEVICE_TTL_MS;
    const ageSec = Math.max(0, Math.floor((now - d.ts) / 1000));
    const dist = myPos ? fmtDistance(haversine(myPos, [d.lat, d.lng])) : "--";
    const battery = d.battery;

    const item = document.createElement("div");
    item.className = "device-list-item";
    item.innerHTML = `
      <span class="dev-dot ${fresh ? "online" : "offline"}"></span>
      <div class="dev-info">
        <div class="dev-name">${deviceId}</div>
        <div class="dev-sub">${fresh ? timeAgoVietnamese(ageSec) : `Mất tín hiệu · ${ageSec}s trước`}</div>
      </div>
      ${battery != null ? `<div class="dev-battery ${batteryClass(battery)}">${battery}%</div>` : ''}
      <div class="dev-dist">${dist}</div>`;
    deviceList.appendChild(item);
  }
}

function timeAgoVietnamese(sec) {
  if (sec < 3) return "Vừa xong";
  if (sec < 60) return `${sec}s trước`;
  return `${Math.floor(sec / 60)} phút trước`;
}

function batteryClass(pct) {
  if (pct <= 10) return "bat-critical";
  if (pct <= 20) return "bat-low";
  return "bat-ok";
}

/* ============================================================ */
/*  DETAIL CARD                                                  */
/* ============================================================ */

function updateDetailCard() {
  const d = deviceData[TARGET_DEVICE];
  if (!d) return;

  const fresh = Date.now() - d.ts < DEVICE_TTL_MS;
  devName.textContent = TARGET_DEVICE;
  devStatus.textContent = fresh ? "Đang hoạt động" : "Mất tín hiệu";
  devStatus.className = "device-status " + (fresh ? "online" : "offline");

  updateDetailCardAddress();

  if (d.battery != null) {
    batteryStatItem.style.display = "";
    statBattery.textContent = d.battery + "%";
    batteryFill.style.width = d.battery + "%";
    batteryFill.className = "battery-fill " + batteryClass(d.battery);
  } else {
    batteryStatItem.style.display = "none";
  }
}

function updateDetailCardAddress() {
  const d = deviceData[TARGET_DEVICE];
  if (!d) return;
  reverseGeocode(d.lat, d.lng).then(addr => {
    const display = addr || `${d.lat.toFixed(6)}, ${d.lng.toFixed(6)}`;
    deviceAddress.textContent = display;
    statAddress.textContent = display;
  });
}

/* ============================================================ */
/*  TIMER — update every second                                  */
/* ============================================================ */

setInterval(() => {
  const d = deviceData[TARGET_DEVICE];
  if (d) {
    const sec = Math.max(0, Math.floor((Date.now() - d.ts) / 1000));
    statTime.textContent = sec < 1 ? "Vừa xong" : `${sec}s trước`;
  }
  renderDeviceList();
}, 1000);

/* ============================================================ */
/*  DISTANCE (Haversine)                                         */
/* ============================================================ */

function haversine([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDistance(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function updateDistances() {
  if (!myPos) return;
  const d = deviceData[TARGET_DEVICE];
  if (d) statDistance.textContent = fmtDistance(haversine(myPos, [d.lat, d.lng]));
}

/* ============================================================ */
/*  MANUAL FIT VIEW                                              */
/* ============================================================ */

btnFitMap.addEventListener('click', () => {
  const pts = [];
  if (myPos) pts.push(myPos);
  for (const d of Object.values(deviceData)) {
    pts.push([d.lat, d.lng]);
  }
  if (pts.length === 0) return;
  try {
    map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
  } catch (_) {}
});

/* ============================================================ */
/*  SEND COMMANDS                                                */
/* ============================================================ */

async function sendCommand(command, btn) {
  if (btn.classList.contains("loading")) return;
  btn.classList.add("loading");
  btn.disabled = true;
  try {
    await set(ref(db, `devices/${TARGET_DEVICE}/command`), command);
  } catch (err) {
    console.error(`[Command] Lỗi:`, err);
  } finally {
    setTimeout(() => {
      btn.classList.remove("loading");
      btn.disabled = false;
    }, 1500);
  }
}

btnPlaySound.addEventListener('click', () => sendCommand("PLAY_SOUND", btnPlaySound));
btnVolumeUp.addEventListener('click', () => sendCommand("VOLUME_UP", btnVolumeUp));

/* ============================================================ */
/*  SERVICE WORKER                                               */
/* ============================================================ */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ============================================================ */
/*  INIT                                                         */
/* ============================================================ */

initGeolocation();
renderDeviceList();