import requests
import time
import random

FIREBASE_DB_URL = "https://locationrealtimeapps-default-rtdb.firebaseio.com"
DEVICE_ID = "device_python_01"

INITIAL_LAT = 10.762622
INITIAL_LNG = 106.660172
MAX_DRIFT = 0.01  # max ~1.1 km from initial position

lat = INITIAL_LAT
lng = INITIAL_LNG

print(f"[*] Starting GPS tracker for device: {DEVICE_ID}")
print(f"[*] Firebase DB: {FIREBASE_DB_URL}")
print(f"[*] Initial position: ({lat}, {lng})")
print("[*] Press Ctrl+C to stop.\n")

while True:
    lat += random.uniform(-0.0005, 0.0005)
    lng += random.uniform(-0.0005, 0.0005)

    lat = max(INITIAL_LAT - MAX_DRIFT, min(INITIAL_LAT + MAX_DRIFT, lat))
    lng = max(INITIAL_LNG - MAX_DRIFT, min(INITIAL_LNG + MAX_DRIFT, lng))

    payload = {
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "timestamp": int(time.time())
    }

    url = f"{FIREBASE_DB_URL}/devices/{DEVICE_ID}.json"

    try:
        resp = requests.put(url, json=payload, timeout=10)
        print(f"[+] Sent: lat={payload['lat']}, lng={payload['lng']} | Status: {resp.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"[!] Error: {e}")

    time.sleep(3)
