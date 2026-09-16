import requests
import time
import random

FIREBASE_DB_URL = "https://locationrealtimeapps-default-rtdb.firebaseio.com"
DEVICE_ID = "device_python_01"

lat = 10.762622
lng = 106.660172

print(f"[*] Starting GPS tracker for device: {DEVICE_ID}")
print(f"[*] Firebase DB: {FIREBASE_DB_URL}")
print(f"[*] Initial position: ({lat}, {lng})")
print("[*] Press Ctrl+C to stop.\n")

while True:
    lat += random.uniform(-0.0005, 0.0005)
    lng += random.uniform(-0.0005, 0.0005)

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
