"""Desktop entry point for Lune.

Starts the local API on a free port in a background thread, then opens it in a
native window. This is what the packaged, downloadable build runs.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# A frozen build unpacks next to the executable rather than the source tree.
if getattr(sys, "frozen", False):
    os.environ.setdefault("LUNE_BUNDLE", "1")
    sys.path.insert(0, str(Path(sys._MEIPASS)))  # type: ignore[attr-defined]

WINDOW_TITLE = "Lune"
STARTUP_TIMEOUT = 30.0


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def serve(port: int) -> None:
    import uvicorn

    from backend.main import app

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    # Signal handlers can only be installed on the main thread, and the window
    # owns that thread here.
    server.install_signal_handlers = lambda: None  # type: ignore[method-assign]
    server.run()


def wait_for_server(port: int, timeout: float = STARTUP_TIMEOUT) -> bool:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/api/health"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1):
                return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.15)
    return False


def main() -> int:
    port = free_port()
    threading.Thread(target=serve, args=(port,), daemon=True).start()

    if not wait_for_server(port):
        sys.stderr.write("Lune could not start its local server.\n")
        return 1

    import webview

    webview.create_window(
        WINDOW_TITLE,
        f"http://127.0.0.1:{port}/",
        width=1180,
        height=820,
        min_size=(760, 560),
        background_color="#0a0a0b",
    )
    webview.start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
