"""
OMREval - OpenCV image processing core.

Two public entry points:

  detect_bubbles(image_bytes, ...)  -> bubble grid for a BLANK template
  evaluate_sheet(template_bytes, student_bytes, positions, ...)
                                    -> per-question detected answers

Everything works in a "normalised" coordinate space: images are scaled so the
longest side is WORK_MAX_DIM px. Bubble positions are stored in that space, and
at evaluation time the student sheet is warped onto the template's normalised
frame, so coordinates always line up.

No answer key ever reaches this module - it only reports which bubbles are
filled. Scoring happens in the Next.js layer (src/lib/scoring.ts).
"""

import math

import cv2
import numpy as np

# --------------------------------------------------------------------------
# Tunables
# --------------------------------------------------------------------------

WORK_MAX_DIM = 1600          # longest side of the normalised working image

# Bubble candidate filters (radii are in normalised px)
MIN_BUBBLE_R = 4.0
MAX_BUBBLE_R = 34.0
MIN_CIRCULARITY = 0.55
MIN_EXTENT = 0.35            # contour area / bounding-box area
MAX_EXTENT = 1.10
ASPECT_TOLERANCE = 0.42      # |w/h - 1| must be under this

# Fill decision
FILL_THRESHOLD = 0.60        # >= 60% of the bubble interior dark -> filled
FAINT_FLOOR = 0.32           # below this, nothing was marked at all
MIN_MARGIN = 0.18            # gap between best and runner-up to be confident
INNER_RADIUS_FACTOR = 0.70   # sample inside the printed ring, not on it

# Alignment
# Grid reading
MIN_GRID_COMPLETENESS = 0.8   # fraction of question rows that must be found
MAX_UNREADABLE_FRACTION = 0.2 # above this, decline rather than report marks

# Work limits. A clean scan yields a few hundred bubble candidates, but a real
# photo (paper texture, JPEG noise, printed instructions) can yield tens of
# thousands, and the pairwise geometry below is quadratic in that count. Without
# these caps a noisy sheet exhausts memory or the function timeout instead of
# just detecting badly.
MAX_ANGLE_POINTS = 4000      # points used to estimate sheet skew
ANGLE_CHUNK = 512            # rows per distance-matrix block
MAX_CANDIDATES = 60000       # hard ceiling on contour candidates

OPTION_LABELS = ["A", "B", "C", "D", "E", "F"]


class OmrError(Exception):
    """Raised with a message that is safe to show to a teacher."""


# --------------------------------------------------------------------------
# Image helpers
# --------------------------------------------------------------------------

def decode_image(data: bytes):
    if not data:
        raise OmrError("Empty image file.")
    buf = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise OmrError("Could not read that image. Use a JPG or PNG photo.")
    return img


def normalise(img):
    """Scale so the longest side is WORK_MAX_DIM. Deterministic: the same source
    image always produces the same working size, which is what keeps stored
    bubble coordinates valid across requests."""
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest == WORK_MAX_DIM:
        return img
    scale = WORK_MAX_DIM / float(longest)
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    return cv2.resize(img, (int(round(w * scale)), int(round(h * scale))), interpolation=interp)


def to_gray(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def flatten_illumination(gray):
    """Remove the soft shadow gradient a phone camera adds, by dividing the
    image by a blurred estimate of the paper background."""
    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=25, sigmaY=25)
    background = np.where(background < 1, 1, background).astype(np.uint8)
    flat = cv2.divide(gray, background, scale=255)
    return flat


# --------------------------------------------------------------------------
# Bubble detection
# --------------------------------------------------------------------------

def _binarise_variants(gray):
    """Two binarisations; we keep whichever yields the better bubble grid."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    adaptive = cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 9
    )
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return [adaptive, otsu]


def _candidate_bubbles(binary):
    """Contours that look like a printed bubble outline."""
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    found = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w == 0 or h == 0:
            continue
        r = (w + h) / 4.0
        if r < MIN_BUBBLE_R or r > MAX_BUBBLE_R:
            continue
        if abs(w / float(h) - 1.0) > ASPECT_TOLERANCE:
            continue
        area = cv2.contourArea(c)
        if area <= 0:
            continue
        extent = area / float(w * h)
        if extent < MIN_EXTENT or extent > MAX_EXTENT:
            continue
        perimeter = cv2.arcLength(c, True)
        if perimeter <= 0:
            continue
        circularity = 4.0 * math.pi * area / (perimeter * perimeter)
        if circularity < MIN_CIRCULARITY:
            continue
        found.append((x + w / 2.0, y + h / 2.0, r))
    return found


def _dedupe(bubbles):
    """A filled bubble often produces both an outer and an inner contour.

    Bucketed by position rather than compared pairwise: on a noisy scan the
    candidate list runs to tens of thousands, and an all-pairs scan there is
    slow enough to hit the function timeout on its own.
    """
    if not bubbles:
        return []
    bubbles = sorted(bubbles, key=lambda b: -b[2])[:MAX_CANDIDATES]

    # Any pair closer than largest_radius * 0.85 must land in the same or an
    # adjacent cell, so a 3x3 neighbourhood check is exhaustive.
    cell = max(2.0, bubbles[0][2] * 0.85)
    buckets = {}
    kept = []

    for cx, cy, r in bubbles:
        gx, gy = int(cx // cell), int(cy // cell)
        duplicate = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for kx, ky, kr in buckets.get((gx + dx, gy + dy), ()):
                    if math.hypot(cx - kx, cy - ky) < max(kr, r) * 0.85:
                        duplicate = True
                        break
                if duplicate:
                    break
            if duplicate:
                break
        if not duplicate:
            kept.append((cx, cy, r))
            buckets.setdefault((gx, gy), []).append((cx, cy, r))
    return kept


def _keep_consistent_sizes(bubbles):
    """Printed bubbles on one sheet are all the same size; drop the outliers
    (letters, boxes, logo circles) that survived the shape filters."""
    if not bubbles:
        return [], 0.0
    radii = np.array([b[2] for b in bubbles])
    median_r = float(np.median(radii))
    return [b for b in bubbles if 0.65 * median_r <= b[2] <= 1.5 * median_r], median_r


def _cluster_rows(bubbles, median_r):
    """Group bubbles into printed rows by y, tolerating a small skew."""
    tolerance = max(median_r * 1.1, 6.0)
    rows = []
    for b in sorted(bubbles, key=lambda b: b[1]):
        placed = False
        for row in rows:
            if abs(b[1] - row["y"]) <= tolerance:
                row["items"].append(b)
                row["y"] = sum(i[1] for i in row["items"]) / len(row["items"])
                placed = True
                break
        if not placed:
            rows.append({"y": b[1], "items": [b]})
    for row in rows:
        row["items"].sort(key=lambda b: b[0])
    rows.sort(key=lambda r: r["y"])
    return rows


def _split_row_into_groups(row_items, options_per_question):
    """A row usually holds several questions side by side. Options inside one
    question sit close together; the gap between questions is much wider."""
    if len(row_items) < options_per_question:
        return []
    gaps = [row_items[i + 1][0] - row_items[i][0] for i in range(len(row_items) - 1)]
    if not gaps:
        return []
    tight = float(np.median(gaps))
    cut = max(tight * 1.7, tight + 2.0)

    groups, current = [], [row_items[0]]
    for i, gap in enumerate(gaps):
        if gap > cut:
            groups.append(current)
            current = [row_items[i + 1]]
        else:
            current.append(row_items[i + 1])
    groups.append(current)

    clean = []
    for g in groups:
        if len(g) == options_per_question:
            clean.append(g)
        elif len(g) > options_per_question and len(g) % options_per_question == 0:
            # Evenly spaced questions the gap heuristic failed to separate.
            for i in range(0, len(g), options_per_question):
                clean.append(g[i:i + options_per_question])
        # Groups of any other size are incomplete detections; drop them.
    return clean


def _cluster_columns(groups):
    """Assign each question-group to a printed column, by its left edge."""
    if not groups:
        return []
    widths = [g["x_end"] - g["x_start"] for g in groups]
    tolerance = max(float(np.median(widths)) * 0.6, 10.0)
    columns = []
    for g in sorted(groups, key=lambda g: g["x_start"]):
        placed = False
        for col in columns:
            if abs(g["x_start"] - col["x"]) <= tolerance:
                col["items"].append(g)
                col["x"] = sum(i["x_start"] for i in col["items"]) / len(col["items"])
                placed = True
                break
        if not placed:
            columns.append({"x": g["x_start"], "items": [g]})
    columns.sort(key=lambda c: c["x"])
    for idx, col in enumerate(columns):
        for g in col["items"]:
            g["column"] = idx
    return columns


def _dominant_row_lattice(groups, tolerance):
    """Find the row spacing that explains the most question groups.

    Answer rows sit on one regular pitch. Other bubble blocks on the sheet (the
    roll-number grid, the "correct method" example) have their own spacing and
    will not fit it, so this both identifies the answer grid and rejects the
    impostors. Returns (origin_y, pitch, fitting_groups).
    """
    if len(groups) < 4:
        return None

    ys = np.array(sorted(g["y"] for g in groups), dtype=np.float64)
    diffs = np.diff(ys)
    candidates = sorted({round(float(d), 1) for d in diffs if d > tolerance})
    if not candidates:
        return None

    best = None
    for pitch in candidates:
        if pitch <= 0:
            continue
        for anchor in ys:
            offsets = np.abs(((ys - anchor) / pitch + 0.5) % 1.0 - 0.5) * pitch
            fits = int((offsets <= tolerance).sum())
            # Prefer more groups explained; break ties toward the larger pitch so
            # a half-pitch never wins by also fitting every other row.
            score = (fits, pitch)
            if best is None or score > best[0]:
                best = (score, float(anchor), float(pitch))

    if best is None or best[0][0] < 4:
        return None

    _, anchor, pitch = best
    fitting = [
        g for g in groups
        if abs((((g["y"] - anchor) / pitch + 0.5) % 1.0 - 0.5) * pitch) <= tolerance
    ]
    if len(fitting) < 4:
        return None

    origin = min(g["y"] for g in fitting)
    return origin, pitch, fitting


def _fit_lattice(groups, question_count, options_per_question, numbering):
    """Rebuild the full question grid from the printed lattice.

    Detecting groups independently fails on real sheets two ways: unrelated
    bubble blocks look exactly like answer groups, and faint print means genuine
    rows are missed, which shifts every question number after them. Both go away
    once the lattice is known -- groups off it are dropped, and rows that were
    never detected are reconstructed from geometry.

    Returns exactly `question_count` questions, or None if no lattice is found.
    """
    if not groups or question_count < 1:
        return None

    heights = [max(b[2] for b in g["bubbles"]) for g in groups]
    tolerance = max(float(np.median(heights)) * 0.9, 4.0)

    lattice = _dominant_row_lattice(groups, tolerance)
    if lattice is None:
        return None
    _, pitch, fitting = lattice

    columns = _cluster_columns(fitting)
    if not columns:
        return None

    # Keep the columns that carry the answer grid; a stray block contributes far
    # fewer groups than a real column of questions.
    biggest = max(len(c["items"]) for c in columns)
    kept = [c for c in columns if len(c["items"]) >= max(2, biggest * 0.4)]
    if not kept:
        return None

    n_cols = len(kept)
    rows_per_col = int(round(question_count / float(n_cols)))
    if rows_per_col < 1 or n_cols * rows_per_col != question_count:
        return None

    # Anchor on the rows the answer grid actually occupies.
    #
    # Taking the topmost fitting group would anchor on the roll-number block,
    # which shares an x-range with the first answer column and so survives column
    # filtering. Answer rows are distinguished by spanning several columns, so
    # score every window of `rows_per_col` consecutive rows by how many
    # column-row cells are occupied and keep the best one.
    ordered = sorted(kept, key=lambda c: c["x"])
    base = min(g["y"] for c in ordered for g in c["items"])

    support = {}
    for column_index, col in enumerate(ordered):
        for g in col["items"]:
            index = int(round((g["y"] - base) / pitch))
            support.setdefault(index, set()).add(column_index)

    if not support:
        return None
    lo, hi = min(support), max(support)
    best_start, best_score = lo, -1
    for start in range(lo, max(lo, hi - rows_per_col + 1) + 1):
        score = sum(
            len(support.get(start + offset, ())) for offset in range(rows_per_col)
        )
        if score > best_score:
            best_start, best_score = start, score

    origin = base + pitch * best_start
    window = range(best_start, best_start + rows_per_col)

    built = []
    for column_index, col in enumerate(ordered):
        # Measure geometry only from groups inside the answer window, so a
        # roll-number group cannot drag a column's x position sideways.
        items = [
            g for g in col["items"]
            if int(round((g["y"] - base) / pitch)) in window
        ] or col["items"]
        starts = np.array([g["bubbles"][0][0] for g in items], dtype=np.float64)
        offsets = np.median(
            np.array(
                [[b[0] - g["bubbles"][0][0] for b in g["bubbles"]] for g in items],
                dtype=np.float64,
            ),
            axis=0,
        )
        radius = float(np.median([b[2] for g in items for b in g["bubbles"]]))
        x0 = float(np.median(starts))

        for row_index in range(rows_per_col):
            y = origin + pitch * row_index
            built.append({
                "column": column_index,
                "row": row_index,
                "options": [
                    {
                        "option": OPTION_LABELS[j],
                        "x": round(x0 + float(offsets[j]), 2),
                        "y": round(y, 2),
                        "r": round(radius, 2),
                    }
                    for j in range(options_per_question)
                ],
            })

    if numbering == "row":
        built.sort(key=lambda q: (q["row"], q["column"]))
    else:
        built.sort(key=lambda q: (q["column"], q["row"]))

    questions = []
    for i, q in enumerate(built):
        questions.append({"q": i + 1, "options": q["options"]})
    return questions


def _detect_groups(bubbles, options_per_question):
    """Raw option groups, before any lattice reasoning."""
    kept, median_r = _keep_consistent_sizes(bubbles)
    if len(kept) < options_per_question * 4:
        return []

    rows = _cluster_rows(kept, median_r)
    groups = []
    for row_index, row in enumerate(rows):
        for g in _split_row_into_groups(row["items"], options_per_question):
            groups.append({
                "row": row_index,
                "y": sum(b[1] for b in g) / len(g),
                "x_start": g[0][0],
                "x_end": g[-1][0],
                "bubbles": g,
                "column": 0,
            })
    return groups


def _build_grid(bubbles, options_per_question, numbering, question_count=None):
    groups = _detect_groups(bubbles, options_per_question)
    if not groups:
        return None

    # Preferred: reconstruct the printed lattice. Only possible when we know how
    # many questions to expect, which the teacher tells us.
    if question_count:
        fitted = _fit_lattice(groups, question_count, options_per_question, numbering)
        if fitted is not None:
            return fitted

    _cluster_columns(groups)

    if numbering == "row":
        groups.sort(key=lambda g: (g["row"], g["column"]))
    else:  # column-major: down column 1, then column 2 - the NEET/JEE layout
        groups.sort(key=lambda g: (g["column"], g["row"]))

    questions = []
    for i, g in enumerate(groups):
        questions.append({
            "q": i + 1,
            "options": [
                {
                    "option": OPTION_LABELS[j],
                    "x": round(b[0], 2),
                    "y": round(b[1], 2),
                    "r": round(b[2], 2),
                }
                for j, b in enumerate(g["bubbles"])
            ],
        })
    return questions


def detect_bubbles(image_bytes, options_per_question=4, expected_questions=45,
                   numbering="column"):
    img = normalise(decode_image(image_bytes))
    height, width = img.shape[:2]
    gray = to_gray(img)

    best = None
    for binary in _binarise_variants(gray):
        candidates = _dedupe(_candidate_bubbles(binary))
        grid = _build_grid(candidates, options_per_question, numbering,
                           question_count=expected_questions)
        if grid is None:
            continue
        # Prefer the variant that lands closest to the expected question count.
        score = -abs(len(grid) - expected_questions)
        if best is None or score > best[0]:
            best = (score, grid)

    if best is None:
        raise OmrError(
            "No bubble grid found in this image. Upload a flat, well-lit scan of "
            "the blank OMR sheet with the whole sheet in frame."
        )

    # Everything found is returned, even if that is more than expected: the
    # teacher removes stray groups (typically the roll-number block) in the
    # preview. Truncating here could just as easily drop the real questions.
    questions = best[1]

    return {
        "width": width,
        "height": height,
        "options_per_question": options_per_question,
        "numbering": numbering,
        "detected_questions": len(questions),
        "expected_questions": expected_questions,
        "questions": questions,
    }


# --------------------------------------------------------------------------
# Alignment
# --------------------------------------------------------------------------

def _detect_bubble_points(gray, expected_count=None):
    """Every bubble-like centre in an image, from whichever binarisation gets
    closest to the expected count."""
    best, best_score = [], None
    for binary in _binarise_variants(gray):
        kept, _ = _keep_consistent_sizes(_dedupe(_candidate_bubbles(binary)))
        score = -abs(len(kept) - expected_count) if expected_count else len(kept)
        if best_score is None or score > best_score:
            best, best_score = kept, score
    return best


def _grid_angle(points):
    """Rotation of the bubble grid, in degrees.

    Each bubble's nearest neighbour is the adjacent option in the same question
    (options sit closer together than rows do), so those vectors all point along
    a printed row. Their median angle is the sheet's skew, and unlike a hull or
    bounding-box estimate it is unaffected by a few stray detections.
    """
    pts = np.asarray(points, dtype=np.float32)
    if len(pts) < 4:
        return 0.0

    # A median only needs a representative sample, and the full pairwise matrix
    # is quadratic: 20k points would be gigabytes.
    if len(pts) > MAX_ANGLE_POINTS:
        pts = pts[np.linspace(0, len(pts) - 1, MAX_ANGLE_POINTS).astype(int)]

    collected = []
    for start in range(0, len(pts), ANGLE_CHUNK):
        block = pts[start:start + ANGLE_CHUNK]
        deltas = block[:, None, :] - pts[None, :, :]
        distances = np.sqrt((deltas ** 2).sum(axis=2))
        # Exclude each point from being its own nearest neighbour.
        rows = np.arange(len(block))
        distances[rows, start + rows] = np.inf
        nearest = np.argmin(distances, axis=1)
        vectors = pts[nearest] - block
        collected.append(np.degrees(np.arctan2(vectors[:, 1], vectors[:, 0])))

    angles = np.concatenate(collected)
    # A row direction has no sign, so fold onto (-90, 90].
    angles = (angles + 90.0) % 180.0 - 90.0
    return float(np.median(angles))


def _rotate(image, angle):
    """Rotate about the centre, growing the canvas so nothing is clipped."""
    if abs(angle) < 0.05:
        return image
    h, w = image.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw = int(h * sin + w * cos)
    nh = int(h * cos + w * sin)
    m[0, 2] += nw / 2.0 - w / 2.0
    m[1, 2] += nh / 2.0 - h / 2.0
    return cv2.warpAffine(image, m, (nw, nh), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)


def deskew_to_grid(gray, expected_count=None):
    """Straighten a photographed sheet using its own bubble grid.

    Returns (deskewed_gray, angle). The angle is whatever rotation was applied.
    """
    points = _detect_bubble_points(gray, expected_count=expected_count)
    if len(points) < 8:
        return gray, 0.0
    angle = _grid_angle([(p[0], p[1]) for p in points])
    return _rotate(gray, angle), angle




# --------------------------------------------------------------------------
# Fill measurement + per-question decision
# --------------------------------------------------------------------------

def _mark_mask(gray):
    """Binary image where pencil/pen marks are white."""
    flat = flatten_illumination(gray)
    blur = cv2.GaussianBlur(flat, (5, 5), 0)
    _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Close pinholes inside a hand-shaded bubble.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)


def _fill_ratio(binary, cx, cy, r):
    """Fraction of the bubble interior that is dark."""
    h, w = binary.shape[:2]
    inner = max(2.0, r * INNER_RADIUS_FACTOR)
    x0, x1 = int(max(0, cx - inner - 1)), int(min(w, cx + inner + 2))
    y0, y1 = int(max(0, cy - inner - 1)), int(min(h, cy + inner + 2))
    if x1 <= x0 or y1 <= y0:
        return 0.0
    patch = binary[y0:y1, x0:x1]
    mask = np.zeros(patch.shape, dtype=np.uint8)
    cv2.circle(mask, (int(round(cx)) - x0, int(round(cy)) - y0), int(round(inner)), 255, -1)
    total = int(cv2.countNonZero(mask))
    if total == 0:
        return 0.0
    dark = int(cv2.countNonZero(cv2.bitwise_and(patch, patch, mask=mask)))
    return dark / float(total)


def _decide(ratios):
    """Turn four fill ratios into a detected option + a state.

    States: single | multiple | uncertain | blank
    """
    order = sorted(range(len(ratios)), key=lambda i: -ratios[i])
    top_i = order[0]
    top = ratios[top_i]
    second = ratios[order[1]] if len(order) > 1 else 0.0
    margin = top - second

    filled = [i for i, v in enumerate(ratios) if v >= FILL_THRESHOLD]

    if len(filled) > 1:
        return None, "multiple", margin
    if len(filled) == 1:
        if margin < MIN_MARGIN:
            # A second bubble is nearly as dark - we cannot tell them apart.
            return OPTION_LABELS[top_i], "uncertain", margin
        return OPTION_LABELS[top_i], "single", margin
    # Nothing crossed the fill threshold.
    if top >= FAINT_FLOOR:
        # A faint or partial mark: readable but not trustworthy.
        if margin >= MIN_MARGIN:
            return OPTION_LABELS[top_i], "uncertain", margin
        return None, "uncertain", margin
    return None, "blank", margin


def _group_centres(questions):
    return np.array(
        [
            [
                float(np.mean([o["x"] for o in q["options"]])),
                float(np.mean([o["y"] for o in q["options"]])),
            ]
            for q in questions
        ],
        dtype=np.float32,
    )


def _robust_scale_shift(src, dst):
    """Map src onto dst on one axis, using percentiles so that a missing group
    at either end cannot skew the fit the way min/max would."""
    slo, shi = np.percentile(src, 5), np.percentile(src, 95)
    dlo, dhi = np.percentile(dst, 5), np.percentile(dst, 95)
    if shi - slo < 1e-6:
        return 1.0, float(dlo - slo)
    scale = float((dhi - dlo) / (shi - slo))
    return scale, float(dlo - slo * scale)


def _match_groups(student_questions, template_questions):
    """Pair each template question with the student group in the same position.

    Matching by list index breaks the moment noise costs a single group: every
    later question silently shifts by one. Matching by geometry instead means a
    lost group costs only that question, which is then reported as unreadable.

    Returns a list, one entry per template question, holding the student group
    or None.
    """
    if not student_questions:
        return [None] * len(template_questions)

    s_pts = _group_centres(student_questions)
    t_pts = _group_centres(template_questions)

    sx, tx = _robust_scale_shift(s_pts[:, 0], t_pts[:, 0])
    sy, ty = _robust_scale_shift(s_pts[:, 1], t_pts[:, 1])
    mapped = np.column_stack([s_pts[:, 0] * sx + tx, s_pts[:, 1] * sy + ty])

    # Tolerance: comfortably under the gap between neighbouring groups, so a
    # question can never claim its neighbour's marks.
    if len(t_pts) > 1:
        spread = np.sqrt(((t_pts[:, None, :] - t_pts[None, :, :]) ** 2).sum(axis=2))
        np.fill_diagonal(spread, np.inf)
        tolerance = float(np.median(spread.min(axis=1))) * 0.45
    else:
        tolerance = 40.0

    distances = np.sqrt(((mapped[:, None, :] - t_pts[None, :, :]) ** 2).sum(axis=2))

    matches = [None] * len(template_questions)
    taken = set()
    # Greedy over the closest pairs first so a contested slot goes to the best fit.
    order = np.dstack(np.unravel_index(np.argsort(distances, axis=None), distances.shape))[0]
    for si, ti in order:
        if distances[si, ti] > tolerance:
            break
        if si in taken or matches[ti] is not None:
            continue
        matches[ti] = student_questions[si]
        taken.add(int(si))
    return matches


def _read_student_grid(s_gray, question_count, options_per_question, numbering):
    """Deskew the student sheet and detect its own bubble grid.

    Returns ((binary_mark_mask, student_questions), info) on success, or
    (None, info) if the grid could not be recovered with the expected shape.
    """
    info = {
        "aligned": False, "method": "student-grid", "matches": 0,
        "inliers": 0, "angle": 0.0, "reason": None,
    }

    expected_bubbles = question_count * options_per_question
    deskewed, angle = deskew_to_grid(s_gray, expected_count=expected_bubbles)
    info["angle"] = round(float(angle), 2)

    best = None
    for binary in _binarise_variants(deskewed):
        candidates = _dedupe(_candidate_bubbles(binary))
        # Deliberately no lattice fit here. The template is a flat scan, so a
        # single row pitch describes it exactly; a student photo has perspective,
        # which makes row spacing vary down the page. Forcing one pitch onto it
        # produces a confident but wrong grid. Clustering tolerates the drift,
        # and _match_groups maps whatever is found onto the template's questions.
        grid = _build_grid(candidates, options_per_question, numbering)
        if grid is None:
            continue
        score = -abs(len(grid) - question_count)
        if best is None or score > best[0]:
            best = (score, grid)

    if best is None:
        info["reason"] = "could not find a bubble grid on the student sheet"
        return None, info

    student_questions = [
        q for q in best[1] if len(q["options"]) == options_per_question
    ]
    info["matches"] = len(student_questions)

    # A noisy scan routinely loses or invents a group. Demanding an exact count
    # would throw away an otherwise perfect read, so accept a near-complete grid
    # and let position matching decide which questions are actually readable.
    if len(student_questions) < question_count * MIN_GRID_COMPLETENESS:
        info["reason"] = (
            "only found %d of %d question rows on the student sheet"
            % (len(student_questions), question_count)
        )
        return None, info

    info["aligned"] = True
    info["inliers"] = len(student_questions) * options_per_question
    return (_mark_mask(deskewed), student_questions), info


def evaluate_sheet(template_bytes, student_bytes, positions):
    """positions is the stored bubble_positions payload from detect_bubbles."""
    questions = positions.get("questions") or []
    if not questions:
        raise OmrError("This template has no saved bubble positions.")

    template = normalise(decode_image(template_bytes))
    student = normalise(decode_image(student_bytes))

    t_gray = to_gray(template)
    s_gray = to_gray(student)

    stored_w = int(positions.get("width") or t_gray.shape[1])
    stored_h = int(positions.get("height") or t_gray.shape[0])
    if (t_gray.shape[1], t_gray.shape[0]) != (stored_w, stored_h):
        # Template re-encoded since detection; fall back to the stored frame.
        t_gray = cv2.resize(t_gray, (stored_w, stored_h), interpolation=cv2.INTER_AREA)

    options_per_question = int(positions.get("options_per_question") or 4)
    numbering = positions.get("numbering") or "column"

    # Read the student sheet's own grid.
    #
    # Warping the photo onto the template and sampling at the template's
    # coordinates sounds natural, but an OMR sheet is a lattice of identical
    # circles: any registration that is off by one row still fits beautifully,
    # and every answer silently shifts by a question. Detecting the grid on the
    # student sheet and matching it to the template by position avoids that -
    # and a group lost to noise costs one question instead of all of them.
    grid, align_info = _read_student_grid(
        s_gray, len(questions), options_per_question, numbering
    )

    if grid is not None:
        binary, student_questions = grid
        matched = _match_groups(student_questions, questions)
        unreadable = sum(1 for m in matched if m is None)
        align_info["unreadable"] = unreadable

        if unreadable > len(questions) * MAX_UNREADABLE_FRACTION:
            grid = None  # too patchy to trust
        else:
            results = []
            for q, student in zip(questions, matched):
                if student is None:
                    # Nothing was found where this question should be. Say so
                    # rather than inventing an answer from the wrong bubbles.
                    results.append({
                        "q": int(q["q"]),
                        "detected": None,
                        "state": "uncertain",
                        "margin": 0.0,
                        "fill": [],
                    })
                    continue
                opts = student["options"]
                ratios = [_fill_ratio(binary, o["x"], o["y"], o["r"]) for o in opts]
                answer, state, margin = _decide(ratios)
                results.append({
                    "q": int(q["q"]),
                    "detected": answer,
                    "state": state,
                    "margin": round(float(margin), 3),
                    "fill": [round(float(v), 3) for v in ratios],
                })

    if grid is None:
        # Refuse rather than guess.
        #
        # The obvious fallback -- warp the photo onto the template and sample at
        # the template's coordinates -- was measured returning 9 of 60 answers
        # correct on a noisy sheet while reporting no error at all. An OMR sheet
        # is a lattice of identical circles, so a registration that is off by one
        # row fits beautifully and shifts every answer. Marks that are quietly
        # wrong are far worse for a student than an evaluation that declines.
        raise OmrError(
            "Could not read the bubble grid on this sheet reliably%s. Please "
            "re-photograph it flat and straight-on, with the whole sheet in "
            "frame, in even light and without shadows across the page."
            % (" (%s)" % align_info["reason"] if align_info.get("reason") else "")
        )

    marked = sum(1 for r in results if r["state"] in ("single", "multiple"))
    if marked == 0:
        raise OmrError(
            "No filled bubbles were found on this sheet. Check that you uploaded "
            "the student's answered sheet and that the photo is in focus."
        )

    return {
        "alignment": align_info,
        "questions": results,
    }
