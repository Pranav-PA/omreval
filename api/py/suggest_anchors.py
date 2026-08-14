"""POST /api/py/suggest_anchors

Body:  { "image": "<base64>", "columns": 4, "rows": 15, "options": 4 }

Reply: { width, height, columns, rows, options_per_question,
         anchors: { first_option, last_option, last_row, last_column },
         radius, detected_groups }

Only a starting position for the four markers the teacher drags. Nothing
downstream trusts it, which is the whole point: detection is allowed to be
wrong here in a way it never was when it defined the grid outright.
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from _handler import JsonHandler, decode_b64  # noqa: E402
from _omr import OmrError, suggest_anchors  # noqa: E402


def _positive(body, key, default, limit):
    try:
        value = int(body.get(key) or default)
    except (TypeError, ValueError):
        raise OmrError("'%s' must be a whole number." % key)
    if value < 1 or value > limit:
        raise OmrError("'%s' must be between 1 and %d." % (key, limit))
    return value


class handler(JsonHandler):
    def work(self, body):
        image = decode_b64(body.get("image"), "template")
        columns = _positive(body, "columns", 4, 20)
        rows = _positive(body, "rows", 15, 100)
        options = _positive(body, "options", 4, 6)
        if options < 2:
            raise OmrError("A question needs at least two options.")
        return suggest_anchors(image, columns, rows, options)
