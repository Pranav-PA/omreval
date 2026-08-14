"""Replica of the Krupanidhi sheet: 60 questions in 4 columns of 15, plus the
roll-number (11x10) and TEST ID (3x10) bubble blocks that must NOT be mistaken
for answer groups. Also exercises rotation, perspective and shadow.
"""

import os
import random
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "api", "py"))

from _omr import OmrError, detect_bubbles, evaluate_sheet  # noqa: E402

W, H = 1300, 1800
COLS, ROWS, OPTS = 4, 15, 4
QUESTIONS = COLS * ROWS          # 60
R = 12
OPT_DX = 40
COL_X0 = 175
COL_DX = 265
ROW_Y0 = 700
ROW_DY = 70
LETTERS = "ABCD"


def centre(col, row, opt):
    return (COL_X0 + col * COL_DX + opt * OPT_DX, ROW_Y0 + row * ROW_DY)


def qnum(col, row):
    return col * ROWS + row + 1


def make_blank():
    img = np.full((H, W, 3), 255, np.uint8)
    cv2.rectangle(img, (40, 30), (W - 40, H - 30), (0, 0, 0), 2)
    cv2.putText(img, "KRUPANIDHI PRE UNIVERSITY COLLEGE", (150, 90),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
    cv2.putText(img, "OMR ANSWER SHEET", (480, 140),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

    # ---- roll number block: 11 columns x 10 rows of digit bubbles ----
    cv2.rectangle(img, (70, 190), (620, 620), (0, 0, 0), 2)
    cv2.putText(img, "ROLL NO.", (85, 215), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
    for row in range(10):
        y = 270 + row * 34
        cv2.putText(img, str((row + 1) % 10), (80, y + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
        for col in range(11):
            cv2.circle(img, (110 + col * 44, y), 11, (0, 0, 0), 2)

    # ---- test id block: 3 columns x 10 rows ----
    cv2.rectangle(img, (650, 190), (860, 620), (0, 0, 0), 2)
    cv2.putText(img, "TEST ID", (665, 215), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
    for row in range(10):
        y = 270 + row * 34
        for col in range(3):
            cv2.circle(img, (700 + col * 44, y), 11, (0, 0, 0), 2)

    # ---- name / instructions panel (text only) ----
    cv2.rectangle(img, (890, 190), (W - 60, 620), (0, 0, 0), 2)
    for i, line in enumerate(["Name ..............", "Batch .............",
                              "Mobile No .........", "Test Date ........."]):
        cv2.putText(img, line, (910, 240 + i * 45),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

    # ---- answer grid ----
    cv2.rectangle(img, (60, 650), (W - 60, H - 60), (0, 0, 0), 2)
    for col in range(COLS):
        x0 = COL_X0 + col * COL_DX
        for j, letter in enumerate(LETTERS):
            cv2.putText(img, letter, (x0 + j * OPT_DX - 6, ROW_Y0 - 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
        for row in range(ROWS):
            q = qnum(col, row)
            x, y = centre(col, row, 0)
            cv2.putText(img, str(q), (x - 48, y + 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)
            for opt in range(OPTS):
                cv2.circle(img, centre(col, row, opt), R, (0, 0, 0), 2)
    return img


def fill(img, answers, multiples=()):
    out = img.copy()
    for col in range(COLS):
        for row in range(ROWS):
            q = qnum(col, row)
            if q in multiples:
                for opt in (1, 3):
                    cv2.circle(out, centre(col, row, opt), R - 2, (30, 30, 30), -1)
                continue
            letter = answers.get(q)
            if letter is not None:
                cv2.circle(out, centre(col, row, LETTERS.index(letter)),
                           R - 2, (25, 25, 25), -1)
    # A student also fills their roll number.
    for col in range(8):
        cv2.circle(out, (110 + col * 44, 270 + ((col * 3) % 10) * 34), 9, (25, 25, 25), -1)
    return out


def photograph(img, angle, perspective=0.018, shadow=True):
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 0.95)
    out = cv2.warpAffine(img, m, (w, h), borderValue=(255, 255, 255))
    if perspective:
        dx = w * perspective
        src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        dst = np.float32([[dx, dx * 0.6], [w - dx * 0.5, 0], [w, h - dx], [dx * 0.4, h]])
        out = cv2.warpPerspective(out, cv2.getPerspectiveTransform(src, dst), (w, h),
                                  borderValue=(255, 255, 255))
    if shadow:
        grad = np.tile(np.linspace(1.0, 0.68, w, dtype=np.float32), (h, 1))
        out = np.clip(out.astype(np.float32) * grad[:, :, None], 0, 255).astype(np.uint8)
    return out


def encode(img):
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    assert ok
    return buf.tobytes()


def main():
    random.seed(11)
    failures = []

    blank = make_blank()
    cv2.imwrite(os.path.join(HERE, "real_blank.jpg"), blank)
    blank_bytes = encode(blank)

    positions = detect_bubbles(blank_bytes, options_per_question=4,
                               expected_questions=QUESTIONS, numbering="column")
    n = positions["detected_questions"]
    print(f"[detect] questions found: {n} (expected {QUESTIONS})")
    if n != QUESTIONS:
        failures.append(f"detected {n} questions, expected {QUESTIONS} "
                        "(roll-number / test-id blocks may have leaked in)")

    if n >= 16:
        q1 = positions["questions"][0]["options"][0]
        q16 = positions["questions"][15]["options"][0]
        print(f"[detect] Q1 A=({q1['x']:.0f},{q1['y']:.0f})  "
              f"Q16 A=({q16['x']:.0f},{q16['y']:.0f})")
        if q1["y"] < 600:
            failures.append("Q1 is above the answer grid - a header block was picked up")

    answers = {q: random.choice(LETTERS) for q in range(1, QUESTIONS + 1)}
    blanks = {7, 33, 58}
    multiples = {12, 44}
    for q in blanks:
        answers.pop(q, None)

    for angle in (0.0, 3.5, -8.0, 12.0):
        student = photograph(fill(blank, answers, multiples), angle)
        try:
            result = evaluate_sheet(blank_bytes, encode(student), positions)
        except OmrError as exc:
            failures.append(f"angle {angle}: evaluation raised: {exc}")
            print(f"[angle {angle:>6}] ERROR: {exc}")
            continue

        align = result["alignment"]
        ok = 0
        bad = []
        for row in result["questions"]:
            q = row["q"]
            if q in multiples:
                good = row["state"] == "multiple"
            elif q in blanks:
                good = row["state"] == "blank"
            else:
                good = row["detected"] == answers.get(q)
            if good:
                ok += 1
            else:
                bad.append(f"Q{q}(exp {answers.get(q, 'blank')} got {row['detected']}/{row['state']})")
        print(f"[angle {angle:>6}] method={align.get('method')} "
              f"skew={align.get('angle')} -> {ok}/{QUESTIONS} correct")
        if bad[:4]:
            print("             " + ", ".join(bad[:4]))
        if ok != QUESTIONS:
            failures.append(f"angle {angle}: {QUESTIONS - ok} misread")

    print()
    if failures:
        print("FAILURES:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
