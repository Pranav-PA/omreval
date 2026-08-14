"""Local stand-in for the Vercel Python functions.

`vercel dev` can run api/py/*.py directly, but for a plain `npm run dev` you
need something serving those two endpoints. Run:

    python devserver.py            # listens on http://127.0.0.1:8000

then set PYTHON_API_URL=http://127.0.0.1:8000 in .env.local.

Only stdlib + the same OpenCV deps as production - no extra packages.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "api", "py"))

from _handler import decode_b64, run  # noqa: E402
from _omr import OmrError, detect_bubbles, evaluate_sheet, suggest_anchors  # noqa: E402

PORT = int(os.environ.get("PORT", "8000"))


def _detect(body):
    numbering = body.get("numbering") or "column"
    if numbering not in ("column", "row"):
        numbering = "column"
    return detect_bubbles(
        decode_b64(body.get("image"), "template"),
        options_per_question=int(body.get("options_per_question") or 4),
        expected_questions=int(body.get("expected_questions") or 45),
        numbering=numbering,
    )


def _evaluate(body):
    positions = body.get("positions")
    if not isinstance(positions, dict):
        raise OmrError("Template bubble positions are missing or corrupt.")
    return evaluate_sheet(
        decode_b64(body.get("template_image"), "template"),
        decode_b64(body.get("student_image"), "student sheet"),
        positions,
    )


def _suggest(body):
    def positive(key, default, limit):
        try:
            value = int(body.get(key) or default)
        except (TypeError, ValueError):
            raise OmrError("'%s' must be a whole number." % key)
        if value < 1 or value > limit:
            raise OmrError("'%s' must be between 1 and %d." % (key, limit))
        return value

    return suggest_anchors(
        decode_b64(body.get("image"), "template"),
        positive("columns", 4, 20),
        positive("rows", 15, 100),
        positive("options", 4, 6),
    )


ROUTES = {
    "/api/py/detect_bubbles": _detect,
    "/api/py/evaluate_omr": _evaluate,
    "/api/py/suggest_anchors": _suggest,
}


class DevHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        work = ROUTES.get(path)
        if work is None:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        run(self, work)

    def do_GET(self):
        self.send_response(200)
        body = b'{"status":"ok","service":"omreval-python"}'
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[py] %s\n" % (fmt % args))


if __name__ == "__main__":
    print("OMREval python service on http://127.0.0.1:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), DevHandler).serve_forever()
