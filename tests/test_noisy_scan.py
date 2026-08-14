"""Stress test: a realistically noisy scan, not a clean synthetic one.

Clean synthetic sheets yield a few hundred bubble candidates. A real photo of
printed paper yields far more -- speckle, halftone texture, instruction text,
ruled boxes -- and the geometry in _omr.py is quadratic in that count. This test
pushes the candidate count up deliberately and asserts the pipeline still
finishes quickly and still reads the sheet correctly.
"""

import os
import random
import sys
import time

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "api", "py"))
sys.path.insert(0, HERE)

import _omr  # noqa: E402
from _omr import detect_bubbles, evaluate_sheet  # noqa: E402
import test_real_layout_60 as sheet  # noqa: E402

# A single serverless invocation must stay well inside the 60s ceiling.
TIME_BUDGET_S = 25.0


def add_noise(img, speckle=0.04, blocks=90):
    """Simulate print texture, dust and stray marks."""
    out = img.copy()
    rng = np.random.default_rng(3)
    h, w = out.shape[:2]

    # Salt-and-pepper speckle: each speck is a contour candidate.
    mask = rng.random((h, w)) < speckle
    out[mask] = rng.integers(0, 90, size=(int(mask.sum()), 3), dtype=np.uint8)

    # Small printed blocks / stray glyphs scattered over the page.
    for _ in range(blocks):
        x, y = int(rng.integers(60, w - 60)), int(rng.integers(60, h - 60))
        s = int(rng.integers(3, 11))
        cv2.rectangle(out, (x, y), (x + s, y + s), (20, 20, 20), -1)

    # Sensor grain.
    grain = rng.normal(0, 9, out.shape).astype(np.int16)
    out = np.clip(out.astype(np.int16) + grain, 0, 255).astype(np.uint8)
    return out


def main():
    random.seed(5)
    failures = []

    blank = sheet.make_blank()
    noisy_blank = add_noise(blank)
    cv2.imwrite(os.path.join(HERE, "noisy_blank.jpg"), noisy_blank)

    # How many raw candidates does the noise actually produce?
    gray = _omr.to_gray(_omr.normalise(noisy_blank))
    raw = max(len(_omr._candidate_bubbles(b)) for b in _omr._binarise_variants(gray))
    print(f"[noise]  raw contour candidates: {raw}")
    if raw < 2000:
        print("         (warning: noise level lower than intended for this test)")

    t0 = time.time()
    deduped = _omr._dedupe(_omr._candidate_bubbles(_omr._binarise_variants(gray)[0]))
    print(f"[dedupe] {len(deduped)} kept in {time.time() - t0:.2f}s")
    if time.time() - t0 > 10:
        failures.append("dedupe is too slow on a noisy sheet")

    t0 = time.time()
    angle = _omr._grid_angle([(b[0], b[1]) for b in deduped])
    dt = time.time() - t0
    print(f"[angle]  {angle:.2f} deg in {dt:.2f}s over {len(deduped)} points")
    if dt > 10:
        failures.append("grid angle estimation is too slow")

    blank_bytes = sheet.encode(noisy_blank)
    t0 = time.time()
    positions = detect_bubbles(blank_bytes, options_per_question=4,
                               expected_questions=60, numbering="column")
    detect_s = time.time() - t0
    n = positions["detected_questions"]
    print(f"[detect] {n} questions in {detect_s:.2f}s")
    if detect_s > TIME_BUDGET_S:
        failures.append(f"detection took {detect_s:.1f}s (budget {TIME_BUDGET_S}s)")
    if n != 60:
        failures.append(f"detected {n} questions on a noisy sheet, expected 60")

    if n == 60:
        answers = {q: "ABCD"[q % 4] for q in range(1, 61)}
        student = add_noise(sheet.photograph(sheet.fill(blank, answers), 6.0), speckle=0.03)
        t0 = time.time()
        result = evaluate_sheet(blank_bytes, sheet.encode(student), positions)
        eval_s = time.time() - t0
        ok = sum(1 for r in result["questions"] if r["detected"] == answers[r["q"]])
        print(f"[eval]   {ok}/60 correct in {eval_s:.2f}s "
              f"(method {result['alignment'].get('method')})")
        if eval_s > TIME_BUDGET_S:
            failures.append(f"evaluation took {eval_s:.1f}s (budget {TIME_BUDGET_S}s)")
        # Noise is allowed to cost a little accuracy, but not much.
        if ok < 57:
            failures.append(f"noisy evaluation read only {ok}/60")

    print()
    if failures:
        print("FAILURES:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("NOISY SCAN CHECKS PASSED")


if __name__ == "__main__":
    main()
