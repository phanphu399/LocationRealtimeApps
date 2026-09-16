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
   MAP - Khởi tạo bản đồ với 2 lớp (OSM + Satellite)
   ================================================================== */

// Lớp bản đồ cơ bản: OpenStreetMap
const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
});

// Lớp bản đồ vệ tinh: Esri World Imagery
const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "&copy; Esri, Maxar, Earthstar Geographics"
  }
);

// Khởi tạo bản đồ, mặc định hiển thị bản đồ vệ tinh (chuyên nghiệp hơn)
const map = L.map("map", {
  center: [10.762622, 106.660172],
  zoom: 13,
  zoomControl: true,
  layers: [satelliteLayer]  // Mặc định hiển thị vệ tinh
});

// Layer Control: cho phép người dùng chuyển đổi giữa 2 loại bản đồ
const baseLayers = {
  "Bản đồ đường phố": osmLayer,
  "Bản đồ vệ tinh": satelliteLayer
};

L.control.layers(baseLayers, null, {
  position: "topright",
  collapsed: false
}).addTo(map);

/* ==================================================================
   DEVICE DATA - Quản lý marker trên bản đồ
   ================================================================== */

const markers = {};
const deviceRef = ref(db, "devices");

// DOM refs cho sidebar
const elStatus    = document.getElementById("deviceStatus");
const elLat       = document.getElementById("statLat");
const elLng       = document.getElementById("statLng");
const elTime      = document.getElementById("statTime");
const elBattery   = document.getElementById("batteryValue");
const btnPlaySound = document.getElementById("btnPlaySound");

// Pin giả lập (giá trị random khi load trang, cập nhật mỗi 30s cho giống thật)
let simulatedBattery = Math.floor(Math.random() * 30) + 60; // 60-89%
elBattery.textContent = simulatedBattery + "%";
setInterval(() => {
  simulatedBattery = Math.max(10, simulatedBattery - Math.floor(Math.random() * 3));
  elBattery.textContent = simulatedBattery + "%";
}, 30000);

/* ==================================================================
   FIREBASE LISTENER - Lắng nghe thay đổi tại /devices
   ================================================================== */

onValue(deviceRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  Object.entries(data).forEach(([deviceId, device]) => {
    if (device.lat == null || device.lng == null) return;

    const latLng = [device.lat, device.lng];

    // Cập nhật sidebar nếu là thiết bị android_01
    if (deviceId === "device_android_01") {
      elStatus.textContent = "Đang hoạt động";
      elStatus.classList.add("online");
      elLat.textContent = device.lat.toFixed(6);
      elLng.textContent = device.lng.toFixed(6);

      if (device.timestamp) {
        const d = new Date(device.timestamp * 1000);
        elTime.textContent = d.toLocaleTimeString("vi-VN");
      }
    }

    // Tạo hoặc cập nhật marker trên bản đồ
    if (markers[deviceId]) {
      markers[deviceId].setLatLng(latLng);
      markers[deviceId].setPopupContent(
        `<b>${deviceId}</b><br>` +
        `Lat: ${device.lat.toFixed(6)}<br>` +
        `Lng: ${device.lng.toFixed(6)}`
      );
    } else {
      const marker = L.marker(latLng)
        .addTo(map)
        .bindPopup(
          `<b>${deviceId}</b><br>` +
          `Lat: ${device.lat.toFixed(6)}<br>` +
          `Lng: ${device.lng.toFixed(6)}`
        );
      markers[deviceId] = marker;
      // Di chuyển bản đồ đến vị trí thiết bị đầu tiên được phát hiện
      map.setView(latLng, 15);
    }
  });
});

/* ==================================================================
   PLAY SOUND - Gửi lệnh PLAY_SOUND lên Firebase
   ================================================================== */

btnPlaySound.addEventListener("click", async () => {
  // Chặn click nhiều lần trong lúc đang xử lý
  if (btnPlaySound.classList.contains("loading")) return;

  // Hiển thị loading
  btnPlaySound.classList.add("loading");
  btnPlaySound.disabled = true;

  try {
    const commandRef = ref(db, "devices/device_android_01/command");
    await set(commandRef, "PLAY_SOUND");
    console.log("[Play Sound] Lệnh PLAY_SOUND đã được gửi lên Firebase");
  } catch (err) {
    console.error("[Play Sound] Lỗi khi gửi lệnh:", err);
  } finally {
    // Tắt loading sau 1.5s (cho người dùng thấy hiệu ứng)
    setTimeout(() => {
      btnPlaySound.classList.remove("loading");
      btnPlaySound.disabled = false;
    }, 1500);
  }
});
