"""Reproduces the failure seen on a real Krupanidhi photo.

Two things happen on a real sheet that clean synthetics never show:

  * Unrelated bubble blocks (the roll-number grid, the "correct method" example)
    get detected as answer groups. A partially-detected roll row leaves exactly
    four survivors, which looks identical to a real question.
  * Faint print means genuine rows are missed entirely.

Either one shifts every question number after it, which silently misattributes
answers. The lattice fit must discard the impostors and rebuild the missing
rows, returning exactly the expected question count in the right order.
"""

import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "api", "py"))
sys.path.insert(0, HERE)

from _omr import detect_bubbles, evaluate_sheet  # noqa: E402
import test_real_layout_60 as sheet  # noqa: E402

LETTERS = "ABCD"
FAINT_ROWS = {1, 13, 14, 17, 18, 20, 26, 29, 30, 44, 47, 53}


def make_sheet_with_faint_rows(faint=FAINT_ROWS):
    """The reference layout, but some rows printed too faintly to detect."""
    img = np.full((sheet.H, sheet.W, 3), 255, np.uint8)
    cv2.rectangle(img, (40, 30), (sheet.W - 40, sheet.H - 30), (0, 0, 0), 2)
    cv2.putText(img, "KRUPANIDHI PRE UNIVERSITY COLLEGE", (150, 90),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)

    # Roll-number block: 11 x 10. Detection often recovers only part of a row,
    # and any surviving run of four looks exactly like an answer group.
    cv2.rectangle(img, (70, 190), (620, 620), (0, 0, 0), 2)
    for row in range(10):
        y = 270 + row * 34
        for col in range(11):
            cv2.circle(img, (110 + col * 44, y), 11, (0, 0, 0), 2)

    # Test-ID block: 3 x 10.
    cv2.rectangle(img, (650, 190), (860, 620), (0, 0, 0), 2)
    for row in range(10):
        for col in range(3):
            cv2.circle(img, (700 + col * 44, 270 + row * 34), 11, (0, 0, 0), 2)

    # The "CORRECT METHOD" example: four bubbles, genuinely indistinguishable
    # from an answer group except that it is nowhere near the answer lattice.
    for i in range(4):
        cv2.circle(img, (980 + i * 40, 560), 11, (0, 0, 0), 2)
    cv2.circle(img, (980 + 3 * 40, 560), 9, (20, 20, 20), -1)

    cv2.rectangle(img, (60, 650), (sheet.W - 60, sheet.H - 60), (0, 0, 0), 2)
    for col in range(sheet.COLS):
        for row in range(sheet.ROWS):
            q = sheet.qnum(col, row)
            # Faint rows are printed pale enough that thresholding loses them.
            shade = (205, 205, 205) if q in faint else (0, 0, 0)
            for opt in range(sheet.OPTS):
                cv2.circle(img, sheet.centre(col, row, opt), sheet.R, shade, 2)
    return img


def main():
    failures = []

    blank = make_sheet_with_faint_rows()
    cv2.imwrite(os.path.join(HERE, "lattice_blank.jpg"), blank)
    blank_bytes = sheet.encode(blank)

    positions = detect_bubbles(blank_bytes, options_per_question=4,
                               expected_questions=60, numbering="column")
    n = positions["detected_questions"]
    print(f"[detect] {n} questions (expected 60, with {len(FAINT_ROWS)} rows faint "
          f"and 3 junk blocks present)")
    if n != 60:
        failures.append(f"got {n} questions, expected exactly 60")

    # Every question must sit inside the answer grid, not in the header blocks.
    top = min(o["y"] for q in positions["questions"] for o in q["options"])
    print(f"[detect] topmost question y = {top:.0f} (answer grid starts ~{sheet.ROW_Y0})")
    if top < 400:
        failures.append("a question was placed in the header area (junk block kept)")

    # Numbering must be correct: Q1 top-left, Q2 directly below, Q16 next column.
    if n == 60:
        q1 = positions["questions"][0]["options"][0]
        q2 = positions["questions"][1]["options"][0]
        q16 = positions["questions"][15]["options"][0]
        print(f"[order]  Q1=({q1['x']:.0f},{q1['y']:.0f}) "
              f"Q2=({q2['x']:.0f},{q2['y']:.0f}) Q16=({q16['x']:.0f},{q16['y']:.0f})")
        if abs(q1["x"] - q2["x"]) > 8 or q2["y"] <= q1["y"]:
            failures.append("Q2 is not directly below Q1")
        if q16["x"] <= q1["x"] + 50:
            failures.append("Q16 is not in the next column")

    # The reconstructed positions must actually read a filled sheet correctly,
    # including the rows that were never detected.
    if n == 60:
        answers = {q: LETTERS[q % 4] for q in range(1, 61)}
        # Students mark every row, including the faintly printed ones.
        clean = sheet.make_blank()
        student = sheet.photograph(sheet.fill(clean, answers), 4.0)
        result = evaluate_sheet(blank_bytes, sheet.encode(student), positions)
        ok = sum(1 for r in result["questions"] if r["detected"] == answers[r["q"]])
        faint_ok = sum(
            1 for r in result["questions"]
            if r["q"] in FAINT_ROWS and r["detected"] == answers[r["q"]]
        )
        print(f"[read]   {ok}/60 correct  "
              f"({faint_ok}/{len(FAINT_ROWS)} of the reconstructed rows)")
        if ok < 58:
            failures.append(f"only read {ok}/60 from the reconstructed lattice")

    print()
    if failures:
        print("FAILURES:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("LATTICE RECOVERY PASSED")


if __name__ == "__main__":
    main()
