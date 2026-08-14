"""Emit the Python grid as JSON so the TypeScript port can be diffed against it."""

import json
import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api", "py")
)

from _geometry import build_grid_from_anchors  # noqa: E402

CASES = [
    {
        "label": "krupanidhi 4x15x4 column-major",
        "anchors": {
            "first_option": [156.0, 622.5],
            "last_option": [262.75, 622.5],
            "last_row": [156.0, 1498.25],
            "last_column": [863.5, 622.5],
        },
        "columns": 4, "rows": 15, "options": 4, "numbering": "column", "radius": 12.8,
    },
    {
        "label": "45 questions, 3 columns, row-major",
        "anchors": {
            "first_option": [137.2, 274.4],
            "last_option": [227.9, 274.4],
            "last_row": [137.2, 1391.1],
            "last_column": [795.6, 274.4],
        },
        "columns": 3, "rows": 15, "options": 4, "numbering": "row", "radius": 11.5,
    },
    {
        "label": "skewed sheet, default radius",
        "anchors": {
            "first_option": [100.0, 200.0],
            "last_option": [190.0, 211.0],
            "last_row": [117.0, 1100.0],
            "last_column": [900.0, 288.0],
        },
        "columns": 4, "rows": 15, "options": 4, "numbering": "column", "radius": None,
    },
]

out = []
for case in CASES:
    out.append({
        "label": case["label"],
        "input": case,
        "questions": build_grid_from_anchors(
            case["anchors"], case["columns"], case["rows"], case["options"],
            case["numbering"], case["radius"],
        ),
    })

print(json.dumps(out))
