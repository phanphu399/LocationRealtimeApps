import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, onValue, set, remove } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

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
/*  MAP (LIGHT GOOGLE-LIKE TILES)                                */
/* ============================================================ */

const cartoLight = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20 }
);

const cartoVoyager = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20 }
);

const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19
});

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "&copy; Esri, Maxar, Earthstar Geographics", maxZoom: 18 }
);

const map = L.map("map", {
  center: [10.762622, 106.660172],
  zoom: 13,
  zoomControl: false,
  layers: [cartoLight]
});

L.control.zoom({ position: "bottomright" }).addTo(map);

L.control.layers(
  {
    "Bản đồ sáng (Google-like)": cartoLight,
    "Bản đồ Voyager": cartoVoyager,
    "Bản đồ đường phố": osmLayer,
    "Bản đồ vệ tinh": satelliteLayer
  },
  null,
  { position: "topleft", collapsed: true }
).addTo(map);

/* ============================================================ */
/*  STATE                                                        */
/* ============================================================ */

const DEVICE_TTL_MS = 60_000;
const GEOCODE_COOLDOWN_MS = 10_000;

// ---- GPS drift / jitter filtering ----
const MIN_STEP_M = 15;          // bỏ qua nhiễu GPS dưới 15 m (không cập nhật marker)
const MAX_JUMP_M = 500;         // bỏ qua lỗi nhảy xa kiểu "teleport" (> 500 m)
const SMOOTH_ALPHA = 0.4;       // hệ số làm mượt vị trí
const MAX_CIRCLE_RADIUS = 300;  // chặn vòng tròn sai số phóng to bất thường (m)

// ---- Lịch sử lộ trình ----
const MAX_HISTORY = 250;        // số điểm tối đa trên polyline mỗi thiết bị

let myPos = null;
let myMarker = null;
let myAccCircle = null;
let firstFixDone = false;
let lastGeoTime = 0;
let smoothMyLat = 0;
let smoothMyLng = 0;

const renderedDevicePos = {};
const newDeviceFitted = {};
const deviceMarkers = {};
const deviceData = {};
const devicePaths = {};
const pathLayer = L.layerGroup().addTo(map);
const addressCache = new Map();
const geocodeTimestamps = {};
let lastFitTime = 0;
let showSimulated = false;

// ---- Follow / bám theo ----
let followTarget = null;
let targetDeviceId = null;

// ---- Simulation ----
let simTimer = null;

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
const statSpeed       = $("statSpeed");
const batteryFill     = $("batteryFill");
const batteryStatItem = $("batteryStatItem");
const btnPlaySound    = $("btnPlaySound");
const btnVolumeUp     = $("btnVolumeUp");
const btnFitMap       = $("btnFitMap");
const btnToggle       = $("btnToggle");
const overlay         = $("overlay");
const sidebar         = $("sidebar");
const cbSimDevices    = $("cbSimDevices");
const btnFollowMe     = $("btnFollowMe");
const followBadge     = $("followBadge");
const followMeLabel   = $("followMeLabel");
const btnSimulate     = $("btnSimulate");
const btnInstall      = $("btnInstall");

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
  btnToggle.classList.toggle('active', sidebar.classList.contains('open'));
});

$("btnCloseSheet").addEventListener('click', closeSidebar);
overlay.addEventListener('click', () => {
  closeSidebar();
  btnToggle.classList.remove('active');
});

// Toggle hiện/ẩn thiết bị mô phỏng
cbSimDevices.addEventListener('change', () => {
  showSimulated = cbSimDevices.checked;
  if (!showSimulated) {
    removeSimulatedMarkers();
  }
  renderDeviceList();
});

/* ============================================================ */
/*  FIREBASE CONNECTION STATUS                                   */
/* ============================================================ */

onValue(ref(db, ".info/connected"), (snap) => {
  const connected = snap.val() === true;
  connDot.className = "conn-dot " + (connected ? "online" : "offline");
  connText.textContent = connected ? "Đã kết nối Firebase" : "Mất kết nối Firebase";
  const mtbDot = $("mtbDot");
  if (mtbDot) {
    mtbDot.className = "mtb-dot " + (connected ? "online" : "offline");
    $("mtbConn").textContent = connected ? "GPS Tracker · Trực tuyến" : "GPS Tracker · Mất kết nối";
  }
});

/* ============================================================ */
/*  BROWSER GEOLOCATION (threshold-based, no drift)              */
/* ============================================================ */

function updateMyAccuracyText(accuracy) {
  myAccuracy.textContent = `Độ chính xác ±${Math.round(accuracy)} m · tự cập nhật`;
}

function onGeoSuccess(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const now = position.timestamp || Date.now();
  const candidate = [latitude, longitude];

  updateMyAccuracyText(accuracy);

  // Teleport guard: nhảy quá xa trong thời gian ngắn -> bỏ qua
  if (myPos) {
    const moved = haversine(myPos, candidate);
    const dtSec = Math.max(1, (now - lastGeoTime) / 1000);
    if (moved > MAX_JUMP_M && dtSec < 5) return;
    // Dead-zone: di chuyển < ngưỡng (hoặc nhỏ hơn sai số GPS) -> không rung marker
    const threshold = Math.max(MIN_STEP_M, accuracy * 0.8);
    if (moved < threshold) {
      lastGeoTime = now;
      return;
    }
  }

  lastGeoTime = now;

  // Exponential smoothing
  if (smoothMyLat === 0 && smoothMyLng === 0) {
    smoothMyLat = latitude;
    smoothMyLng = longitude;
  } else {
    smoothMyLat += (latitude - smoothMyLat) * SMOOTH_ALPHA;
    smoothMyLng += (longitude - smoothMyLng) * SMOOTH_ALPHA;
  }
  const firstTime = !myPos;
  myPos = [smoothMyLat, smoothMyLng];

  reverseGeocode(smoothMyLat, smoothMyLng).then(addr => {
    myAddress.textContent = getShortAddress(addr) || `${smoothMyLat.toFixed(6)}, ${smoothMyLng.toFixed(6)}`;
  });

  if (myMarker) {
    myMarker.setLatLng(myPos);
    // Clamp vòng tròn sai số để không phóng to bất thường
    myAccCircle.setLatLng(myPos).setRadius(Math.min(accuracy, MAX_CIRCLE_RADIUS));
  } else {
    myAccCircle = L.circle([0, 0], {
      radius: Math.min(accuracy, MAX_CIRCLE_RADIUS),
      color: "#4285f4",
      weight: 1,
      fillColor: "#4285f4",
      fillOpacity: 0.07
    }).addTo(map).setLatLng(myPos);

    myMarker = L.circleMarker(myPos, {
      radius: 7,
      color: "#ffffff",
      weight: 2.5,
      fillColor: "#4285f4",
      fillOpacity: 1,
      className: "my-pulse"
    }).addTo(map).bindPopup("<b>Bạn đang ở đây</b>");
  }

  if (firstTime && !firstFixDone) {
    firstFixDone = true;
    const realIds = Object.keys(deviceData).filter(id => !isSimulatedDevice(id));
    if (realIds.length === 0) map.setView(myPos, 15);
  }

  if (followTarget === "me") {
    panToTarget(myPos, Math.max(map.getZoom(), 14));
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
    maximumAge: 10000,
    timeout: 20000
  });
}

/* ============================================================ */
/*  FOLLOW / BÁM THEO Logic                                      */
/* ============================================================ */

function updateFollowUI() {
  if (followTarget === "me") {
    btnFollowMe.classList.add("active");
    followMeLabel.textContent = "Đang bám theo tôi";
  } else {
    btnFollowMe.classList.remove("active");
    followMeLabel.textContent = "Bám theo vị trí của tôi";
  }

  if (followTarget) {
    followBadge.style.display = "flex";
    $("followBadgeText").textContent = followTarget === "me"
      ? "Đang bám theo vị trí của bạn"
      : `Đang bám theo: ${followTarget}`;
  } else {
    followBadge.style.display = "none";
  }

  // đánh dấu nút follow trên từng thiết bị
  document.querySelectorAll(".dev-follow").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.follow === followTarget);
  });
}

function panToTarget(latlng, zoom) {
  map.panTo(latlng, { animate: true, duration: 0.5 });
  if (zoom) map.setZoom(zoom, { animate: true });
}

function setFollowMe() {
  followTarget = followTarget === "me" ? null : "me";
  updateFollowUI();
  if (followTarget === "me" && myPos) panToTarget(myPos, Math.max(map.getZoom(), 14));
}

function setFollowDevice(deviceId) {
  followTarget = followTarget === deviceId ? null : deviceId;
  updateFollowUI();
  if (followTarget === deviceId) {
    const d = deviceData[deviceId];
    if (d) panToTarget([d.lat, d.lng], Math.max(map.getZoom(), 14));
  }
}

btnFollowMe.addEventListener("click", setFollowMe);
$("btnUnfollow").addEventListener("click", () => { followTarget = null; updateFollowUI(); });

/* ============================================================ */
/*  FIREBASE DEVICE LISTENER                                     */
/* ============================================================ */

const deviceRef = ref(db, "devices");

onValue(deviceRef, (snapshot) => {
  const data = snapshot.val() || {};

  const visibleData = {};
  for (const [deviceId, device] of Object.entries(data)) {
    if (!showSimulated && isSimulatedDevice(deviceId)) continue;
    visibleData[deviceId] = device;
  }

  // Dọn thiết bị đã bị xóa khỏi Firebase
  const incomingIds = new Set(Object.keys(visibleData));
  for (const deviceId of Object.keys(deviceData)) {
    if (!incomingIds.has(deviceId)) {
      clearDeviceLayers(deviceId);
      delete deviceData[deviceId];
    }
  }

  for (const [deviceId, device] of Object.entries(visibleData)) {
    if (device.lat == null || device.lng == null) continue;

    const existed = !!deviceData[deviceId];

    deviceData[deviceId] = {
      lat: Number(device.lat),
      lng: Number(device.lng),
      ts: (device.timestamp || 0) * 1000,
      command: device.command,
      battery: device.battery != null ? Number(device.battery) : null,
      charging: device.charging === true,
      speed: device.speed != null ? Number(device.speed) : null,
      history: existed ? deviceData[deviceId].history : []
    };

    // Lưu lịch sử lộ trình (polyline)
    const h = deviceData[deviceId].history;
    if (!h.length || haversine(h[h.length - 1], [deviceData[deviceId].lat, deviceData[deviceId].lng]) > MIN_STEP_M) {
      h.push([deviceData[deviceId].lat, deviceData[deviceId].lng]);
      if (h.length > MAX_HISTORY) h.shift();
    }
    drawDevicePath(deviceId);

    upsertDeviceMarker(deviceId);

    if (!targetDeviceId && !isSimulatedDevice(deviceId)) {
      targetDeviceId = deviceId;
    }

    if (!existed && !newDeviceFitted[deviceId]) {
      newDeviceFitted[deviceId] = true;
      autoFitNewDevice(deviceId);
    }
  }

  // Nếu thiết bị đang xem bị xóa -> chuyển sang thiết bị thật khác
  if (targetDeviceId && (deviceData[targetDeviceId] == null || isSimulatedDevice(targetDeviceId))) {
    const realIds = Object.keys(deviceData).filter(id => !isSimulatedDevice(id));
    targetDeviceId = realIds.length ? realIds[0] : null;
  }

  if (!showSimulated) removeSimulatedMarkers();

  if (followTarget && followTarget !== "me") {
    const d = deviceData[followTarget];
    if (d) panToTarget([d.lat, d.lng], Math.max(map.getZoom(), 14));
  }

  renderDeviceList();
  updateDetailCard();
  updateDistances();
});

function deleteDevice(deviceId) {
  const d = deviceData[deviceId];
  if (!d) return;
  if (!confirm(`Xóa thiết bị ${deviceId}? Thiết bị chỉ xuất hiện lại khi nó tự đẩy dữ liệu trở lại.`)) return;
  remove(ref(db, `devices/${deviceId}`))
    .then(() => {
      if (followTarget === deviceId) { followTarget = null; updateFollowUI(); }
      if (targetDeviceId === deviceId) targetDeviceId = null;
    })
    .catch(err => alert("Xóa thất bại: " + err.message));
}

function isSimulatedDevice(deviceId) {
  const id = deviceId.toLowerCase();
  return id.includes("python") || id.startsWith("sim");
}

function clearDeviceLayers(deviceId) {
  if (deviceMarkers[deviceId]) {
    map.removeLayer(deviceMarkers[deviceId]);
    delete deviceMarkers[deviceId];
  }
  if (devicePaths[deviceId]) {
    pathLayer.removeLayer(devicePaths[deviceId]);
    delete devicePaths[deviceId];
  }
  delete renderedDevicePos[deviceId];
  delete newDeviceFitted[deviceId];
}

function removeSimulatedMarkers() {
  for (const deviceId of Object.keys(deviceMarkers)) {
    if (isSimulatedDevice(deviceId)) clearDeviceLayers(deviceId);
  }
  for (const deviceId of Object.keys(devicePaths)) {
    if (isSimulatedDevice(deviceId)) pathLayer.removeLayer(devicePaths[deviceId]);
  }
}

function drawDevicePath(deviceId) {
  const d = deviceData[deviceId];
  const h = d.history;
  if (!h || h.length < 2) {
    if (devicePaths[deviceId]) {
      pathLayer.removeLayer(devicePaths[deviceId]);
      delete devicePaths[deviceId];
    }
    return;
  }
  const path = devicePaths[deviceId];
  if (path) {
    path.setLatLngs(h);
  } else {
    devicePaths[deviceId] = L.polyline(h, {
      color: "#4285f4",
      weight: 3,
      opacity: 0.75,
      dashArray: null,
      lineCap: "round"
    }).addTo(pathLayer);
  }
}

/* ============================================================ */
/*  DEVICE MARKERS (with heading arrow)                          */
/* ============================================================ */

function bearingArrow(h) {
  if (!h || h.length < 2) return 0;
  const [a, b] = [h[h.length - 2], h[h.length - 1]];
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function buildDeviceIcon(deviceId) {
  const isSim = isSimulatedDevice(deviceId);
  const color = isSim ? "#7b1fa2" : "#ea4335";
  const deg = bearingArrow(deviceData[deviceId].history);
  const content = isSim
    ? `<div class="pin-arrow"></div><div class="pin-dot sim"></div>`
    : `<div class="pin-arrow"></div><div class="pin-dot">${targetDeviceId === deviceId ? '<span class="pin-core"></span>' : ""}</div>`;
  return L.divIcon({
    className: "leaflet-div-icon",
    html: `<div class="device-pin${isSim ? " sim" : ""}" style="--heading:${deg}deg">${content}</div>`,
    iconSize: [24, 30],
    iconAnchor: [12, 14]
  });
}

function upsertDeviceMarker(deviceId) {
  const d = deviceData[deviceId];
  const latLng = [d.lat, d.lng];

  if (deviceMarkers[deviceId]) {
    const prev = renderedDevicePos[deviceId];
    if (prev && haversine(prev, latLng) < MIN_STEP_M) return;
    renderedDevicePos[deviceId] = latLng;
    deviceMarkers[deviceId].setLatLng(latLng).setIcon(buildDeviceIcon(deviceId));
    buildPopup(deviceId).then(html => deviceMarkers[deviceId].setPopupContent(html));
    return;
  }

  const marker = L.marker(latLng, { icon: buildDeviceIcon(deviceId) }).addTo(map);
  deviceMarkers[deviceId] = marker;
  renderedDevicePos[deviceId] = latLng;

  marker.on("click", () => {
    targetDeviceId = deviceId;
    setFollowDevice(deviceId);
    renderDeviceList();
    updateDetailCard();
  });

  buildPopup(deviceId).then(html => marker.bindPopup(html));
}

async function buildPopup(deviceId) {
  const d = deviceData[deviceId];
  const dist = myPos ? fmtDistance(haversine(myPos, [d.lat, d.lng])) : "--";
  const addr = await reverseGeocode(d.lat, d.lng);
  const short = getShortAddress(addr);
  const spd = d.speed != null ? fmtSpeed(d.speed) : "--";
  return `<div class="pop-title">${deviceId}</div>
          <div class="pop-addr">${short || d.lat.toFixed(6) + ', ' + d.lng.toFixed(6)}</div>
          <div class="pop-dist">Cách bạn ${dist} · Tốc độ ${spd}</div>`;
}

/* ============================================================ */
/*  RENDER DEVICE LIST                                           */
/* ============================================================ */

function renderDeviceList() {
  const ids = Object.keys(deviceData).filter(id => !isSimulatedDevice(id) || showSimulated);
  listEmpty.style.display = ids.length ? "none" : "block";
  deviceList.innerHTML = "";

  const now = Date.now();
  for (const deviceId of ids) {
    const d = deviceData[deviceId];
    const fresh = isFresh(d);
    const ageSec = Math.max(0, Math.floor((now - d.ts) / 1000));
    const dist = myPos ? fmtDistance(haversine(myPos, [d.lat, d.lng])) : "--";
    const battery = d.battery;

    const item = document.createElement("div");
    item.className = "device-list-item" + (deviceId === targetDeviceId ? " active" : "");
    item.innerHTML = `
      <span class="dev-dot ${fresh ? "online" : "offline"}"></span>
      <div class="dev-info">
        <div class="dev-name">${deviceId}${d.command && d.command !== "NONE" ? ' <span class="cmd-badge">' + d.command + "</span>" : ""}</div>
        <div class="dev-sub">${labelDevice(d, fresh, ageSec)} · ${dist}</div>
      </div>
      ${battery != null ? `<div class="dev-battery ${batteryClass(battery)}">${d.charging ? "⚡" : ""}${battery}%</div>` : ''}
      <div class="dev-actions">
        <button class="dev-follow ${followTarget === deviceId ? "active" : ""}" data-follow="${deviceId}" title="Bám theo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>
        </button>
        <button class="dev-delete" data-del="${deviceId}" title="Xóa">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
        </button>
      </div>`;

    item.addEventListener("click", (ev) => {
      if (ev.target.closest(".dev-follow")) { targetDeviceId = deviceId; setFollowDevice(deviceId); renderDeviceList(); updateDetailCard(); return; }
      if (ev.target.closest(".dev-delete")) { deleteDevice(deviceId); return; }
      targetDeviceId = deviceId; setFollowDevice(deviceId); renderDeviceList(); updateDetailCard();
      if (window.innerWidth <= 860) closeSidebar();
    });

    deviceList.appendChild(item);
  }
}

function isFresh(d) {
  return Date.now() - d.ts < DEVICE_TTL_MS;
}

function labelDevice(d, fresh, ageSec) {
  if (!fresh) return `Mất tín hiệu · ${ageSec}s trước`;
  const t = timeAgoVietnamese(ageSec);
  return d.speed != null ? `${t} · ${fmtSpeed(d.speed)}` : t;
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

function fmtSpeed(s) {
  if (s == null) return "--";
  const v = Number(s);
  if (v < 1) return `${Math.round(v * 100) / 100} km/h`;
  return `${v.toFixed(1)} km/h`;
}

/* ============================================================ */
/*  DETAIL CARD (+ telemetry)                                    */
/* ============================================================ */

function updateDetailCard() {
  const d = deviceData[targetDeviceId];
  if (!d) return;

  const fresh = isFresh(d);
  devName.textContent = targetDeviceId;
  devStatus.textContent = fresh ? "Đang hoạt động" : "Mất tín hiệu";
  devStatus.className = "device-status " + (fresh ? "online" : "offline");

  updateDetailCardAddress();

  if (d.battery != null) {
    batteryStatItem.style.display = "";
    statBattery.textContent = (d.charging ? "⚡ " : "") + d.battery + "%";
    batteryFill.style.width = d.battery + "%";
    batteryFill.className = "battery-fill " + batteryClass(d.battery);
  } else {
    batteryStatItem.style.display = "none";
  }

  statSpeed.textContent = fmtSpeed(d.speed);
}

function updateDetailCardAddress() {
  const d = deviceData[targetDeviceId];
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
  const d = deviceData[targetDeviceId];
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
  const d = deviceData[targetDeviceId];
  if (d) statDistance.textContent = fmtDistance(haversine(myPos, [d.lat, d.lng]));
}

/* ============================================================ */
/*  MANUAL FIT VIEW                                              */
/* ============================================================ */

btnFitMap.addEventListener('click', () => {
  const pts = [];
  if (myPos) pts.push(myPos);
  for (const d of Object.values(deviceData)) pts.push([d.lat, d.lng]);
  if (pts.length === 0) return;
  try { map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 16 }); } catch (_) {}
});

function autoFitNewDevice(deviceId) {
  // Chỉ auto-fit khi thiết bị mới xuất hiện lần đầu (tránh map bị giật liên tục)
  if (Date.now() - lastFitTime < 8000) return;
  lastFitTime = Date.now();
  const pts = [];
  if (myPos) pts.push(myPos);
  if (deviceData[deviceId]) pts.push([deviceData[deviceId].lat, deviceData[deviceId].lng]);
  if (pts.length === 0) return;
  try { map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 16 }); } catch (_) {}
}

/* ============================================================ */
/*  SEND COMMANDS                                                */
/* ============================================================ */

async function sendCommand(command, btn) {
  if (btn.classList.contains("loading")) return;
  btn.classList.add("loading");
  btn.disabled = true;
  try {
    if (!targetDeviceId) throw new Error("Chưa chọn thiết bị để điều khiển");
    await set(ref(db, `devices/${targetDeviceId}/command`), command);
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
/*  SIMULATION MODE (test when no real device)                   */
/* ============================================================ */

const SIM_DEVICE = "sim_demo_01";
const SIM_CENTER = [10.762622, 106.660172];
let simHeadingRad = 0;

function startSimulation() {
  if (simTimer) return;
  btnSimulate.classList.add("active");
  btnSimulate.textContent = "Đang mô phỏng...";
  showSimulated = true;
  cbSimDevices.checked = true;

  simHeadingRad = Math.random() * Math.PI * 2;
  let sLat = SIM_CENTER[0];
  let sLng = SIM_CENTER[1];

  simTimer = setInterval(() => {
    simHeadingRad += (Math.random() - 0.5) * 0.6;
    sLat += Math.cos(simHeadingRad) * 0.0005;
    sLng += Math.sin(simHeadingRad) * 0.0005;
    set(ref(db, `devices/${SIM_DEVICE}`), {
      lat: sLat,
      lng: sLng,
      timestamp: Math.floor(Date.now() / 1000),
      battery: 55 + Math.floor(Math.random() * 40),
      speed: (Math.random() * 40).toFixed(1),
      command: "NONE"
    }).catch(() => {});
  }, 2000);
}

function stopSimulation() {
  if (!simTimer) return;
  clearInterval(simTimer);
  simTimer = null;
  btnSimulate.classList.remove("active");
  btnSimulate.textContent = "Mô phỏng di chuyển";
  remove(ref(db, `devices/${SIM_DEVICE}`)).catch(() => {});
}

btnSimulate.addEventListener("click", () => {
  if (simTimer) {
    stopSimulation();
  } else {
    startSimulation();
  }
});

/* ============================================================ */
/*  PWA INSTALL PROMPT                                           */
/* ============================================================ */

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.style.display = "flex";
});

btnInstall.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  if (choice.outcome === "accepted") btnInstall.style.display = "none";
  deferredPrompt = null;
});

// iOS: hướng dẫn thêm vào màn hình chính
if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
  btnInstall.style.display = "flex";
  btnInstall.textContent = "Chia sẻ → Thêm vào Màn hình chính";
  btnInstall.addEventListener("click", () => {
    alert("iOS: Mở trình duyệt → Nhấn nút Chia sẻ → chọn 'Thêm vào Màn hình chính'.");
  });
}

/* ============================================================ */
/*  SERVICE WORKER (PWA)                                         */
/* ============================================================ */

if ('serviceWorker' in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ============================================================ */
/*  INIT                                                         */
/* ============================================================ */

initGeolocation();
renderDeviceList();