import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

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

const map = L.map("map").setView([10.762622, 106.660172], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markers = {};
const deviceRef = ref(db, "devices");

onValue(deviceRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  Object.entries(data).forEach(([deviceId, device]) => {
    if (device.lat == null || device.lng == null) return;

    const latLng = [device.lat, device.lng];

    if (markers[deviceId]) {
      markers[deviceId].setLatLng(latLng);
    } else {
      const marker = L.marker(latLng)
        .addTo(map)
        .bindPopup(`<b>${deviceId}</b><br>Lat: ${device.lat}<br>Lng: ${device.lng}`);
      markers[deviceId] = marker;
    }
  });
});
