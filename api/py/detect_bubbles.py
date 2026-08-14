"""POST /api/py/detect_bubbles

Body:  { "image": "<base64 jpg/png>",
         "options_per_question": 4,
         "expected_questions": 45,
         "numbering": "column" | "row" }

Reply: { width, height, options_per_question, numbering,
         detected_questions, expected_questions,
         questions: [ { q, options: [ { option, x, y, r } ] } ] }
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from _handler import JsonHandler, decode_b64  # noqa: E402
from _omr import detect_bubbles  # noqa: E402


class handler(JsonHandler):
    def work(self, body):
        image = decode_b64(body.get("image"), "template")
        numbering = body.get("numbering") or "column"
        if numbering not in ("column", "row"):
            numbering = "column"
        return detect_bubbles(
            image,
            options_per_question=int(body.get("options_per_question") or 4),
            expected_questions=int(body.get("expected_questions") or 45),
            numbering=numbering,
        )
