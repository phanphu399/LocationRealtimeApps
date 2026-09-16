import os
import subprocess
import sys
import threading
import time
import webbrowser

DASHBOARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web-dashboard")
PORT = 8080


def open_browser():
    time.sleep(2)
    webbrowser.open(f"http://localhost:{PORT}")


if __name__ == "__main__":
    print("=" * 50)
    print("  GPS Realtime Tracker - Web Dashboard")
    print("=" * 50)
    print("  (Không chạy simulator tọa độ ảo - dashboard chỉ hiển thị")
    print("   vị trí thật từ Android LocationService.)")
    print("=" * 50)

    print(f"\n[*] Web Dashboard: http://localhost:{PORT}")
    print("[*] Nhấn Ctrl+C để dừng.\n")

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        subprocess.run(
            [sys.executable, "-m", "http.server", str(PORT)],
            cwd=DASHBOARD_DIR,
            check=True
        )
    except KeyboardInterrupt:
        print("\n[*] Shutting down...")
        sys.exit(0)