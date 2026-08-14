"""Shared boilerplate for the Vercel Python functions."""

import base64
import binascii
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from _omr import OmrError  # noqa: E402

MAX_BODY_BYTES = 12 * 1024 * 1024


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        raise OmrError("Empty request body.")
    if length > MAX_BODY_BYTES:
        raise OmrError("Image is too large. Please upload a smaller photo.")
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise OmrError("Malformed request body.")


def decode_b64(value, field):
    if not value or not isinstance(value, str):
        raise OmrError("Missing image data (%s)." % field)
    if "," in value[:64] and value.lstrip().startswith("data:"):
        value = value.split(",", 1)[1]
    try:
        return base64.b64decode(value, validate=False)
    except (binascii.Error, ValueError):
        raise OmrError("Image data (%s) is not valid base64." % field)


def check_secret(handler):
    """Optional shared secret so only the Next.js app can call these endpoints."""
    expected = os.environ.get("PY_SHARED_SECRET")
    if not expected:
        return True
    return handler.headers.get("X-OMREval-Secret") == expected


def run(handler, work):
    """Wrap a unit of work with auth, error handling and JSON serialisation."""
    try:
        if not check_secret(handler):
            _json_response(handler, 401, {"error": "Unauthorised."})
            return
        body = read_json_body(handler)
        _json_response(handler, 200, work(body))
    except OmrError as exc:
        _json_response(handler, 422, {"error": str(exc)})
    except Exception as exc:  # noqa: BLE001 - never leak a stack trace to a teacher
        print("omreval unhandled error: %r" % (exc,), file=sys.stderr)
        _json_response(handler, 500, {
            "error": "Image processing failed unexpectedly. Please try another photo."
        })


class JsonHandler(BaseHTTPRequestHandler):
    """Subclasses implement `work(body) -> dict`."""

    def work(self, body):  # pragma: no cover - overridden
        raise NotImplementedError

    def do_POST(self):
        run(self, self.work)

    def do_GET(self):
        _json_response(self, 405, {"error": "Use POST."})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))
