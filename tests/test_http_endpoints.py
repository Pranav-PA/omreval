"""Exercise the two HTTP endpoints the way the Next.js layer does."""

import base64
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import test_real_layout_60 as sheet  # noqa: E402

BASE = "http://127.0.0.1:8000"


def post(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


blank = sheet.make_blank()
blank_b64 = base64.b64encode(sheet.encode(blank)).decode()

status, positions = post("/api/py/detect_bubbles", {
    "image": blank_b64, "options_per_question": 4,
    "expected_questions": 60, "numbering": "column",
})
print("detect_bubbles ->", status, "questions:", positions.get("detected_questions"))
assert status == 200 and positions["detected_questions"] == 60, positions

answers = {q: "ABCD"[q % 4] for q in range(1, 61)}
student = sheet.photograph(sheet.fill(blank, answers), 5.0)
status, result = post("/api/py/evaluate_omr", {
    "template_image": blank_b64,
    "student_image": base64.b64encode(sheet.encode(student)).decode(),
    "positions": positions,
})
print("evaluate_omr   ->", status, "method:", result.get("alignment", {}).get("method"))
assert status == 200, result
ok = sum(1 for r in result["questions"] if r["detected"] == answers[r["q"]])
print("               read back %d/60 correctly" % ok)
assert ok == 60, [r for r in result["questions"] if r["detected"] != answers[r["q"]]][:5]

# Error handling: garbage image should give a clean 422, not a stack trace.
status, err = post("/api/py/detect_bubbles", {"image": "bm90LWFuLWltYWdl"})
print("bad image      ->", status, repr(err.get("error"))[:80])
assert status == 422 and "error" in err, (status, err)

status, err = post("/api/py/evaluate_omr", {"template_image": blank_b64})
print("missing field  ->", status, repr(err.get("error"))[:80])
assert status == 422, (status, err)

print("\nHTTP SMOKE TESTS PASSED")
