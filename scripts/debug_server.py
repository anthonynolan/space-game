#!/usr/bin/env python3
"""Serve the game locally with automatic browser reload on file changes."""

from __future__ import annotations

import argparse
import os
import queue
import socket
import sys
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
WATCH_EXTENSIONS = {".html", ".css", ".js"}
RELOAD_ENDPOINT = "/__reload/events"
RELOAD_SNIPPET = """
<script>
(() => {
  const events = new EventSource("/__reload/events");
  events.addEventListener("reload", () => window.location.reload());
  events.onerror = () => console.debug("Waiting for debug reload server...");
})();
</script>
"""

clients: set[queue.Queue[str]] = set()
clients_lock = threading.Lock()


def iter_watched_files() -> list[Path]:
  ignored_dirs = {".git", ".venv", "__pycache__"}
  files: list[Path] = []
  for path in ROOT_DIR.rglob("*"):
    if any(part in ignored_dirs for part in path.parts):
      continue
    if path.is_file() and path.suffix in WATCH_EXTENSIONS:
      files.append(path)
  return files


def file_signature() -> tuple[tuple[str, int, int], ...]:
  signature = []
  for path in iter_watched_files():
    try:
      stat = path.stat()
    except FileNotFoundError:
      continue
    signature.append((str(path.relative_to(ROOT_DIR)), stat.st_mtime_ns, stat.st_size))
  return tuple(sorted(signature))


def notify_reload() -> None:
  with clients_lock:
    stale_clients = []
    for client in clients:
      try:
        client.put_nowait("reload")
      except queue.Full:
        stale_clients.append(client)
    for client in stale_clients:
      clients.discard(client)


def watch_files(poll_interval: float) -> None:
  previous = file_signature()
  while True:
    time.sleep(poll_interval)
    current = file_signature()
    if current != previous:
      previous = current
      print("Change detected. Reloading browsers.", flush=True)
      notify_reload()


class DebugRequestHandler(SimpleHTTPRequestHandler):
  server_version = "StarlineDebugHTTP/1.0"

  def end_headers(self) -> None:
    self.send_header("Cache-Control", "no-store")
    super().end_headers()

  def do_GET(self) -> None:
    if self.path == RELOAD_ENDPOINT:
      self.handle_reload_events()
      return
    super().do_GET()

  def send_head(self):
    path = self.translate_path(self.path)
    if Path(path).name != "index.html":
      return super().send_head()

    try:
      html = Path(path).read_text(encoding="utf-8")
    except OSError:
      self.send_error(HTTPStatus.NOT_FOUND, "File not found")
      return None

    if "</body>" in html:
      html = html.replace("</body>", f"{RELOAD_SNIPPET}</body>", 1)
    else:
      html += RELOAD_SNIPPET

    data = html.encode("utf-8")
    self.send_response(HTTPStatus.OK)
    self.send_header("Content-Type", "text/html; charset=utf-8")
    self.send_header("Content-Length", str(len(data)))
    self.end_headers()
    return _BytesReader(data)

  def handle_reload_events(self) -> None:
    client_queue: queue.Queue[str] = queue.Queue(maxsize=8)
    with clients_lock:
      clients.add(client_queue)

    self.send_response(HTTPStatus.OK)
    self.send_header("Content-Type", "text/event-stream")
    self.send_header("Cache-Control", "no-store")
    self.send_header("Connection", "keep-alive")
    self.end_headers()

    try:
      self.wfile.write(b": connected\n\n")
      self.wfile.flush()
      while True:
        try:
          event = client_queue.get(timeout=15)
          self.wfile.write(f"event: {event}\ndata: now\n\n".encode("utf-8"))
        except queue.Empty:
          self.wfile.write(b": heartbeat\n\n")
        self.wfile.flush()
    except (BrokenPipeError, ConnectionResetError):
      pass
    finally:
      with clients_lock:
        clients.discard(client_queue)

  def log_message(self, format: str, *args) -> None:
    print(f"{self.address_string()} - {format % args}", flush=True)


class _BytesReader:
  def __init__(self, data: bytes) -> None:
    self.data = data
    self.sent = False

  def read(self, _size: int = -1) -> bytes:
    if self.sent:
      return b""
    self.sent = True
    return self.data

  def close(self) -> None:
    return None


def local_ip() -> str:
  try:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
      sock.connect(("8.8.8.8", 80))
      return sock.getsockname()[0]
  except OSError:
    return "127.0.0.1"


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Run Starline Run locally with browser autoreload.")
  parser.add_argument("--host", default="0.0.0.0", help="Host interface to bind. Default: 0.0.0.0")
  parser.add_argument("--port", default=8000, type=int, help="Port to serve on. Default: 8000")
  parser.add_argument("--poll", default=0.5, type=float, help="File watch poll interval in seconds. Default: 0.5")
  return parser.parse_args()


def main() -> int:
  args = parse_args()
  os.chdir(ROOT_DIR)

  watcher = threading.Thread(target=watch_files, args=(args.poll,), daemon=True)
  watcher.start()

  server = ThreadingHTTPServer((args.host, args.port), DebugRequestHandler)
  display_host = "localhost" if args.host in {"0.0.0.0", ""} else args.host
  print(f"Serving {ROOT_DIR}", flush=True)
  print(f"Local:   http://{display_host}:{args.port}", flush=True)
  if args.host == "0.0.0.0":
    print(f"Network: http://{local_ip()}:{args.port}", flush=True)
  print("Watching .html, .css, and .js files. Press Ctrl+C to stop.", flush=True)

  try:
    server.serve_forever()
  except KeyboardInterrupt:
    print("\nStopping debug server.", flush=True)
  finally:
    server.server_close()
  return 0


if __name__ == "__main__":
  sys.exit(main())
