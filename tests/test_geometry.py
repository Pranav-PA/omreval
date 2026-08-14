"""The anchor geometry must be exact, because nothing downstream second-guesses it."""

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "api", "py"))
sys.path.insert(0, HERE)

from _geometry import GeometryError, anchors_from_questions, build_grid_from_anchors  # noqa: E402
import test_real_layout_60 as sheet  # noqa: E402

failures = []


def check(label, condition, detail=""):
    print(f"{'ok  ' if condition else 'FAIL'} {label}{('  ' + detail) if detail else ''}")
    if not condition:
        failures.append(label)


# ---------------------------------------------------------------------------
# Exact reconstruction of a known layout
# ---------------------------------------------------------------------------
COLS, ROWS, OPTS = sheet.COLS, sheet.ROWS, sheet.OPTS

anchors = {
    "first_option": sheet.centre(0, 0, 0),
    "last_option": sheet.centre(0, 0, OPTS - 1),
    "last_row": sheet.centre(0, ROWS - 1, 0),
    "last_column": sheet.centre(COLS - 1, 0, 0),
}

questions = build_grid_from_anchors(anchors, COLS, ROWS, OPTS, "column")
check("returns every question", len(questions) == COLS * ROWS, f"{len(questions)}")

worst = 0.0
for col in range(COLS):
    for row in range(ROWS):
        q = questions[col * ROWS + row]
        for opt in range(OPTS):
            want = np.array(sheet.centre(col, row, opt), dtype=float)
            got = np.array([q["options"][opt]["x"], q["options"][opt]["y"]], dtype=float)
            worst = max(worst, float(np.linalg.norm(want - got)))
check("every bubble lands on the printed centre", worst < 0.02, f"worst error {worst:.4f}px")

check("Q1 is the top-left question",
      questions[0]["options"][0]["x"] == round(float(anchors["first_option"][0]), 2))
check("column-major numbering: Q2 sits below Q1",
      questions[1]["options"][0]["y"] > questions[0]["options"][0]["y"]
      and abs(questions[1]["options"][0]["x"] - questions[0]["options"][0]["x"]) < 0.01)
check("column-major numbering: Q16 starts the next column",
      questions[ROWS]["options"][0]["x"] > questions[0]["options"][0]["x"])

row_major = build_grid_from_anchors(anchors, COLS, ROWS, OPTS, "row")
check("row-major numbering: Q2 sits to the right of Q1",
      row_major[1]["options"][0]["x"] > row_major[0]["options"][0]["x"])

# ---------------------------------------------------------------------------
# A sheet scanned crooked: the anchors are vectors, so skew is absorbed
# ---------------------------------------------------------------------------
theta = np.radians(7.0)
rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])


def turn(p):
    return tuple(rot @ np.array(p, dtype=float))


skewed = build_grid_from_anchors(
    {k: turn(v) for k, v in anchors.items()}, COLS, ROWS, OPTS, "column"
)
worst_skew = 0.0
for col in range(COLS):
    for row in range(ROWS):
        q = skewed[col * ROWS + row]
        for opt in range(OPTS):
            want = np.array(turn(sheet.centre(col, row, opt)), dtype=float)
            got = np.array([q["options"][opt]["x"], q["options"][opt]["y"]], dtype=float)
            worst_skew = max(worst_skew, float(np.linalg.norm(want - got)))
check("a rotated sheet still reconstructs exactly", worst_skew < 0.02,
      f"worst error {worst_skew:.4f}px")

# ---------------------------------------------------------------------------
# Round trip and validation
# ---------------------------------------------------------------------------
recovered = anchors_from_questions(questions, COLS, ROWS, OPTS, "column")
round_trip = max(
    float(np.linalg.norm(np.array(recovered[k]) - np.array(anchors[k]))) for k in anchors
)
check("anchors survive a round trip", round_trip < 0.02, f"worst {round_trip:.4f}px")

for bad, label in [
    ({}, "missing anchors"),
    (anchors, "too few options"),
]:
    try:
        if label == "too few options":
            build_grid_from_anchors(bad, COLS, ROWS, 1, "column")
        else:
            build_grid_from_anchors(bad, COLS, ROWS, OPTS, "column")
        check(f"rejects {label}", False)
    except GeometryError:
        check(f"rejects {label}", True)

radii = {o["r"] for q in questions for o in q["options"]}
check("radius defaults to something that cannot overlap",
      len(radii) == 1 and 3.0 <= radii.pop() < min(sheet.OPT_DX, sheet.ROW_DY) / 2)

print()
if failures:
    print("FAILURES:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("GEOMETRY CHECKS PASSED")
