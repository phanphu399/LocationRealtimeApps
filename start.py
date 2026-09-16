import subprocess
import sys
import os
import time
import webbrowser
import threading

DASHBOARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web-dashboard")
TRACKER_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "background-tracker", "tracker.py")
PORT = 8080

def open_browser():
    time.sleep(2)
    webbrowser.open(f"http://localhost:{PORT}")

if __name__ == "__main__":
    print("=" * 50)
    print("  GPS Realtime Tracker - Starting All Services")
    print("=" * 50)

    tracker_proc = subprocess.Popen(
        [sys.executable, TRACKER_SCRIPT],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )

    def print_tracker_output():
        for line in tracker_proc.stdout:
            print(f"  [Tracker] {line.rstrip()}")

    t = threading.Thread(target=print_tracker_output, daemon=True)
    t.start()

    print(f"\n[*] Web Dashboard: http://localhost:{PORT}")
    print("[*] Tracker running in background.\n")

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        subprocess.run(
            [sys.executable, "-m", "http.server", str(PORT)],
            cwd=DASHBOARD_DIR,
            check=True
        )
    except KeyboardInterrupt:
        print("\n[*] Shutting down...")
        tracker_proc.terminate()
        sys.exit(0)
