"""Start Vocalize on the first free port and open the browser.  Usage: python run.py [port]"""
import socket
import sys
import threading
import webbrowser

import uvicorn

CANDIDATES = [8000, 7860, 8080, 5000, 8501, 9000, 18000]


def is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:  # in use, or reserved by Windows (WinError 10013)
            return False


def pick_port() -> int:
    wanted = [int(sys.argv[1])] if len(sys.argv) > 1 else []
    for port in wanted + CANDIDATES:
        if is_free(port):
            return port
    with socket.socket() as s:  # let the OS choose any free port
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


if __name__ == "__main__":
    port = pick_port()
    url = f"http://localhost:{port}"
    print(f"\n  Vocalize is running at: {url}\n")
    threading.Timer(2.0, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=port)
