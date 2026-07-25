"""
mitmproxy addon: capture Stationhead traffic that is routed through this PC's
WiFi proxy (e.g. from a phone browser) and save matching HTTP request/response
bodies plus WebSocket frames to a git-ignored JSONL file for later analysis.

Setup (once):
  pip install mitmproxy

Run:
  mitmdump -s capture-stationhead-mitmproxy.py -p 8080

Then, on the phone:
  1. Join the same WiFi network as this PC.
  2. Set the phone's WiFi manual proxy to this PC's LAN IP, port 8080.
  3. With the proxy active, open http://mitm.it in the phone's browser and
     install the mitmproxy CA certificate for your OS (see the script
     comments in the PowerShell capture script's companion notes for the
     per-OS trust steps).
  4. Browse to https://stationhead.com/c/buddies and log in / use the app
     normally. Matching traffic is appended live to the output file below.

WARNING: the output contains your live Stationhead session (cookies/tokens)
and other users' buddy/room data. It is written under native/data/, which is
git-ignored - never commit it, send it directly instead.
"""
import os
from datetime import datetime, timezone
import json

from mitmproxy import ctx, http

HOST_FILTER = os.environ.get("STATIONHEAD_CAPTURE_HOST_FILTER", "stationhead").lower()
INCLUDE_STATIC = os.environ.get("STATIONHEAD_CAPTURE_INCLUDE_STATIC", "0") == "1"

STATIC_CONTENT_TYPES = (
    "image/", "font/", "text/css", "application/javascript", "text/javascript",
    "video/", "audio/",
)

_out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "stationhead-capture")
os.makedirs(_out_dir, exist_ok=True)
OUT_FILE = os.path.join(_out_dir, f"capture-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jsonl")


def _write(entry: dict) -> None:
    with open(OUT_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _is_interesting_host(host: str) -> bool:
    return HOST_FILTER in (host or "").lower()


def _is_static(content_type: str) -> bool:
    if not content_type:
        return False
    return any(content_type.startswith(prefix) for prefix in STATIC_CONTENT_TYPES)


def response(flow: http.HTTPFlow) -> None:
    if not _is_interesting_host(flow.request.pretty_host):
        return
    content_type = flow.response.headers.get("content-type", "")
    if not INCLUDE_STATIC and _is_static(content_type):
        return

    try:
        body = flow.response.text
        body_encoding = "text"
    except Exception:
        body = flow.response.content.hex() if flow.response.content else None
        body_encoding = "hex"

    try:
        post_data = flow.request.text if flow.request.content else None
    except Exception:
        post_data = flow.request.content.hex() if flow.request.content else None

    entry = {
        "kind": "http",
        "method": flow.request.method,
        "url": flow.request.pretty_url,
        "requestHeaders": dict(flow.request.headers),
        "postData": post_data,
        "status": flow.response.status_code,
        "mimeType": content_type,
        "responseHeaders": dict(flow.response.headers),
        "body": body,
        "bodyEncoding": body_encoding,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
    }
    _write(entry)
    ctx.log.info(f"[{flow.response.status_code}] {flow.request.method} {flow.request.pretty_url}")


def websocket_message(flow: http.HTTPFlow) -> None:
    if not _is_interesting_host(flow.request.pretty_host):
        return
    message = flow.websocket.messages[-1]
    try:
        payload = message.content.decode("utf-8")
        payload_encoding = "text"
    except UnicodeDecodeError:
        payload = message.content.hex()
        payload_encoding = "hex"

    entry = {
        "kind": "websocket_sent" if message.from_client else "websocket_received",
        "url": flow.request.pretty_url,
        "payloadData": payload,
        "payloadEncoding": payload_encoding,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
    }
    _write(entry)
    ctx.log.info(f"[WS {'sent' if message.from_client else 'recv'}] {flow.request.pretty_url}")


def load(loader) -> None:
    ctx.log.info(f"Stationhead capture writing to: {OUT_FILE}")
