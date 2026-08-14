"""End-to-end exercise of the OMREval OpenCV pipeline against a synthetic sheet.

Builds a fake 45-question NEET-style OMR (3 columns x 15 rows x 4 options),
runs detection, then fills a known answer pattern, rotates/skews the sheet like
a phone photo, and checks that evaluation recovers the answers.
"""

import os
import random
import sys

import cv2
import numpy as np

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api", "py")
)

from _omr import detect_bubbles, evaluate_sheet  # noqa: E402

W, H = 1240, 1754           # A4-ish at 150dpi
COLS, ROWS, OPTS = 3, 15, 4
R = 11
OPT_DX = 34                 # spacing between options inside a question
COL_X0 = 150                # left edge of first column's option A
COL_DX = 360                # spacing between columns
ROW_Y0 = 300
ROW_DY = 88
LETTERS = "ABCD"


def bubble_centre(col, row, opt):
    return (COL_X0 + col * COL_DX + opt * OPT_DX, ROW_Y0 + row * ROW_DY)


def question_number(col, row):
    """Column-major numbering: Q1..Q15 down column 0, Q16.. down column 1."""
    return col * ROWS + row + 1


def make_blank():
    img = np.full((H, W, 3), 255, np.uint8)
    cv2.putText(img, "SUNRISE JUNIOR COLLEGE - OMR", (150, 120),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    for col in range(COLS):
        for row in range(ROWS):
            q = question_number(col, row)
            x0, y = bubble_centre(col, row, 0)
            cv2.putText(img, str(q), (x0 - 55, y + 7),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
            for opt in range(OPTS):
                cx, cy = bubble_centre(col, row, opt)
                cv2.circle(img, (cx, cy), R, (0, 0, 0), 2)
    return img


def fill(img, answers, multiples=(), faint=()):
    out = img.copy()
    for col in range(COLS):
        for row in range(ROWS):
            q = question_number(col, row)
            if q in multiples:
                for opt in (0, 2):
                    cv2.circle(out, bubble_centre(col, row, opt), R - 2, (20, 20, 20), -1)
                continue
            letter = answers.get(q)
            if letter is None:
                continue
            opt = LETTERS.index(letter)
            shade = (150, 150, 150) if q in faint else (25, 25, 25)
            cv2.circle(out, bubble_centre(col, row, opt), R - 2, shade, -1)
    return out


def photograph(img, angle=6.0, perspective=0.02):
    """Simulate a hand-held phone photo: rotate, skew, dim one corner."""
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 0.97)
    out = cv2.warpAffine(img, m, (w, h), borderValue=(255, 255, 255))

    dx = w * perspective
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[dx, dx * 0.5], [w - dx * 0.4, 0], [w, h - dx], [dx * 0.3, h]])
    out = cv2.warpPerspective(out, cv2.getPerspectiveTransform(src, dst), (w, h),
                              borderValue=(255, 255, 255))

    # Soft shadow gradient across the page.
    grad = np.tile(np.linspace(1.0, 0.72, w, dtype=np.float32), (h, 1))
    out = np.clip(out.astype(np.float32) * grad[:, :, None], 0, 255).astype(np.uint8)
    return out


def encode(img):
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    assert ok
    return buf.tobytes()


def main():
    random.seed(7)
    failures = []

    blank = make_blank()
    blank_bytes = encode(blank)

    # ---------------- detection ----------------
    positions = detect_bubbles(blank_bytes, options_per_question=4,
                               expected_questions=45, numbering="column")
    n = positions["detected_questions"]
    print(f"[detect] questions found: {n} (expected 45)")
    print(f"[detect] working image:   {positions['width']}x{positions['height']}")
    if n != 45:
        failures.append(f"detected {n} questions, expected 45")

    per_q = {len(q["options"]) for q in positions["questions"]}
    print(f"[detect] options per question: {per_q}")
    if per_q != {4}:
        failures.append(f"inconsistent option counts: {per_q}")

    # Numbering must run down each column, so Q1 and Q2 share an x and differ in y.
    if n >= 16:
        q1 = positions["questions"][0]["options"][0]
        q2 = positions["questions"][1]["options"][0]
        q16 = positions["questions"][15]["options"][0]
        print(f"[detect] Q1 A=({q1['x']:.0f},{q1['y']:.0f})  "
              f"Q2 A=({q2['x']:.0f},{q2['y']:.0f})  Q16 A=({q16['x']:.0f},{q16['y']:.0f})")
        if abs(q1["x"] - q2["x"]) > 8 or q2["y"] <= q1["y"]:
            failures.append("column-major numbering wrong: Q2 is not below Q1")
        if q16["x"] <= q1["x"] + 50:
            failures.append("column-major numbering wrong: Q16 is not in the next column")

    # ---------------- evaluation ----------------
    answers = {q: random.choice(LETTERS) for q in range(1, 46)}
    blanks = {5, 23}
    multiples = {9, 31}
    faint = {17}
    for q in blanks:
        answers.pop(q, None)

    student = photograph(fill(blank, answers, multiples=multiples, faint=faint))
    cv2.imwrite(os.path.join(os.path.dirname(__file__), "student_sim.jpg"), student)

    result = evaluate_sheet(blank_bytes, encode(student), positions)
    align = result["alignment"]
    print(f"[align]  aligned={align['aligned']} matches={align['matches']} "
          f"inliers={align['inliers']} reason={align['reason']}")
    if not align["aligned"]:
        failures.append(f"alignment failed: {align['reason']}")

    correct = wrong = 0
    detail = []
    for row in result["questions"]:
        q = row["q"]
        expected_letter = answers.get(q)
        if q in multiples:
            ok = row["state"] == "multiple"
            label = "multiple"
        elif q in blanks:
            ok = row["state"] == "blank"
            label = "blank"
        else:
            ok = row["detected"] == expected_letter and row["state"] in ("single", "uncertain")
            label = expected_letter
        if ok:
            correct += 1
        else:
            wrong += 1
            detail.append(f"  Q{q}: expected {label}, got {row['detected']} "
                          f"({row['state']}, fill={row['fill']})")

    print(f"[score]  {correct}/45 questions read as expected")
    for line in detail[:12]:
        print(line)
    if wrong:
        failures.append(f"{wrong} questions misread")

    faint_rows = [r for r in result["questions"] if r["q"] in faint]
    print(f"[flags]  faint mark Q17 -> state={faint_rows[0]['state']} "
          f"detected={faint_rows[0]['detected']}")

    print()
    if failures:
        print("FAILURES:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
