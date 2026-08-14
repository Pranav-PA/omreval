"""POST /api/py/evaluate_omr

Body:  { "template_image": "<base64>",
         "student_image":  "<base64>",
         "positions": { width, height, questions: [...] } }

Reply: { alignment: { aligned, matches, inliers, reason },
         questions: [ { q, detected, state, margin, fill } ] }

`state` is one of: single | multiple | uncertain | blank.
No marks are computed here - scoring lives in src/lib/scoring.ts so the answer
key never has to leave the Next.js layer.
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from _handler import JsonHandler, decode_b64  # noqa: E402
from _omr import OmrError, evaluate_sheet  # noqa: E402


class handler(JsonHandler):
    def work(self, body):
        template = decode_b64(body.get("template_image"), "template")
        student = decode_b64(body.get("student_image"), "student sheet")
        positions = body.get("positions")
        if not isinstance(positions, dict):
            raise OmrError("Template bubble positions are missing or corrupt.")
        return evaluate_sheet(template, student, positions)
