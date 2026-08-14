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
ORB_FEATURES = 6000
LOWE_RATIO = 0.78
MIN_GOOD_MATCHES = 14
MIN_INLIERS = 10

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
    """A filled bubble often produces both an outer and an inner contour."""
    bubbles = sorted(bubbles, key=lambda b: -b[2])
    kept = []
    for cx, cy, r in bubbles:
        duplicate = False
        for kx, ky, kr in kept:
            if math.hypot(cx - kx, cy - ky) < max(kr, r) * 0.85:
                duplicate = True
                break
        if not duplicate:
            kept.append((cx, cy, r))
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


def _build_grid(bubbles, options_per_question, numbering):
    kept, median_r = _keep_consistent_sizes(bubbles)
    if len(kept) < options_per_question * 4:
        return None

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
    if not groups:
        return None

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
        grid = _build_grid(candidates, options_per_question, numbering)
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
    deltas = pts[:, None, :] - pts[None, :, :]
    distances = np.sqrt((deltas ** 2).sum(axis=2))
    np.fill_diagonal(distances, np.inf)
    nearest = np.argmin(distances, axis=1)

    vectors = pts[nearest] - pts
    angles = np.degrees(np.arctan2(vectors[:, 1], vectors[:, 0]))
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


def _box_corners(points):
    """Corners of the minimum-area rectangle enclosing a point cloud.

    Deliberately not the extreme points (argmin/argmax of x±y): a single stray
    detection moves an extreme corner by a whole bubble and throws the entire
    registration off by one option. The min-area rectangle is driven by the
    convex hull as a whole, so it barely moves.
    """
    rect = cv2.minAreaRect(np.asarray(points, dtype=np.float32))
    return cv2.boxPoints(rect).astype(np.float32)


def _pair_up(mapped, template_pts, tolerance):
    """Nearest template bubble for each mapped student bubble, within tolerance.
    Returns (keep_mask, nearest_index)."""
    deltas = mapped[:, None, :] - template_pts[None, :, :]
    distances = np.sqrt((deltas ** 2).sum(axis=2))
    nearest = np.argmin(distances, axis=1)
    best = distances[np.arange(len(mapped)), nearest]
    return best < tolerance, nearest


def align_by_grid(template_points, student_gray, template_shape):
    """Register the student sheet using the bubble grid geometry.

    Appearance-based matching (ORB/SIFT) is unreliable on an OMR sheet: the page
    is a lattice of near-identical circles, so descriptors match ambiguously and
    RANSAC will happily settle on a consistent-but-wrong fit that is off by a
    whole row. Matching by *geometry* instead removes that ambiguity.

    Two stages:
      1. Coarse - map the four extreme corners of the student's bubble cloud
         onto the template's. This absorbs rotation, skew and perspective.
      2. Refine - push every template bubble through the coarse transform, pair
         it with the nearest detected student bubble, and re-fit a homography
         over all those pairs with RANSAC.

    Returns (H, info) where H maps student -> template, or (None, info).
    """
    info = {"method": "grid", "student_bubbles": 0, "pairs": 0, "inliers": 0, "reason": None}

    template_pts = np.asarray(template_points, dtype=np.float32)
    if len(template_pts) < 8:
        info["reason"] = "template has too few bubbles to register against"
        return None, info

    student = _detect_bubble_points(student_gray, expected_count=len(template_pts))
    info["student_bubbles"] = len(student)
    if len(student) < 8:
        info["reason"] = "could not find the bubble grid on the student sheet"
        return None, info

    student_pts = np.float32([[b[0], b[1]] for b in student])
    median_r = float(np.median([b[2] for b in student])) or 8.0
    tolerance = max(median_r * 1.6, 6.0)

    student_box = _box_corners(student_pts)
    template_box = _box_corners(template_pts)

    # boxPoints does not guarantee which physical corner comes first, so try all
    # four cyclic pairings and keep whichever actually lines the grids up. This
    # is also what lets a sheet photographed sideways register correctly.
    best = None
    for shift in range(4):
        rolled = np.roll(student_box, shift, axis=0).astype(np.float32)
        try:
            candidate = cv2.getPerspectiveTransform(rolled, template_box)
        except cv2.error:
            continue
        mapped = cv2.perspectiveTransform(
            student_pts.reshape(-1, 1, 2), candidate
        ).reshape(-1, 2)
        keep, nearest = _pair_up(mapped, template_pts, tolerance)
        pairs = int(keep.sum())
        # Tie-break towards the least-rotated fit: a bubble grid looks the same
        # upside down, so 0 and 180 degrees score identically on geometry alone
        # and teachers photograph sheets roughly upright.
        skew = float(np.linalg.norm(candidate[:2, :2] - np.eye(2)))
        if best is None or (pairs, -skew) > (best[0], -best[1]):
            best = (pairs, skew, keep, nearest)

    if best is None or best[0] < 8:
        info["reason"] = "the student sheet's bubble grid did not line up with the template"
        return None, info

    _, _, keep, nearest = best
    src = student_pts[keep].reshape(-1, 1, 2)
    dst = template_pts[nearest[keep]].reshape(-1, 1, 2)
    info["pairs"] = int(keep.sum())

    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    info["inliers"] = int(mask.sum()) if mask is not None else 0

    th, tw = template_shape[:2]
    if H is None or info["inliers"] < 8 or not _homography_is_sane(H, tw, th):
        info["reason"] = "could not compute a reliable alignment from the bubble grid"
        return None, info

    return H, info


def _homography_is_sane(H, w, h):
    """Reject warps that fold, mirror or explode the sheet."""
    if H is None:
        return False
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    try:
        mapped = cv2.perspectiveTransform(corners, np.linalg.inv(H))
    except np.linalg.LinAlgError:
        return False
    pts = mapped.reshape(-1, 2)
    area = abs(cv2.contourArea(pts.astype(np.float32)))
    if area < 0.15 * w * h or area > 6.0 * w * h:
        return False
    if not cv2.isContourConvex(pts.astype(np.float32)):
        return False
    return True


def align_to_template(template_gray, student_gray, template_points=None):
    """Warp the student photo onto the template's frame.

    Grid registration is tried first and is what should normally succeed; ORB
    feature matching is only a fallback for sheets whose bubbles could not be
    detected. Returns (warped_gray, info); if nothing works the student image is
    merely resized and info['aligned'] is False.
    """
    th, tw = template_gray.shape[:2]
    info = {"aligned": False, "method": None, "matches": 0, "inliers": 0, "reason": None}

    if template_points is not None and len(template_points) >= 8:
        H, grid_info = align_by_grid(template_points, student_gray, template_gray.shape)
        if H is not None:
            info.update({
                "aligned": True,
                "method": "grid",
                "matches": grid_info["pairs"],
                "inliers": grid_info["inliers"],
                "reason": None,
            })
            return cv2.warpPerspective(
                student_gray, H, (tw, th),
                flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE,
            ), info
        info["reason"] = grid_info["reason"]

    # ---- fallback: appearance-based matching ----
    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
    kp_t, des_t = orb.detectAndCompute(template_gray, None)
    kp_s, des_s = orb.detectAndCompute(student_gray, None)

    if des_t is None or des_s is None or len(kp_t) < 10 or len(kp_s) < 10:
        info["reason"] = "not enough detail in one of the images"
        return cv2.resize(student_gray, (tw, th), interpolation=cv2.INTER_AREA), info

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    raw = matcher.knnMatch(des_s, des_t, k=2)
    good = [m for m, n in (p for p in raw if len(p) == 2) if m.distance < LOWE_RATIO * n.distance]
    info["matches"] = len(good)

    if len(good) < MIN_GOOD_MATCHES:
        info["reason"] = "too few matching features"
        return cv2.resize(student_gray, (tw, th), interpolation=cv2.INTER_AREA), info

    src = np.float32([kp_s[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp_t[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    inliers = int(mask.sum()) if mask is not None else 0
    info["inliers"] = inliers

    if H is None or inliers < MIN_INLIERS or not _homography_is_sane(H, tw, th):
        info["reason"] = "could not compute a reliable alignment"
        return cv2.resize(student_gray, (tw, th), interpolation=cv2.INTER_AREA), info

    warped = cv2.warpPerspective(
        student_gray, H, (tw, th),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE,
    )
    info["aligned"] = True
    info["method"] = "features"
    info["reason"] = None
    return warped, info


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
        grid = _build_grid(candidates, options_per_question, numbering)
        if grid is None:
            continue
        score = -abs(len(grid) - question_count)
        if best is None or score > best[0]:
            best = (score, grid)

    if best is None:
        info["reason"] = "could not find a bubble grid on the student sheet"
        return None, info

    student_questions = best[1]
    info["matches"] = len(student_questions)

    if len(student_questions) != question_count:
        info["reason"] = (
            "found %d question rows on the student sheet but the template has %d"
            % (len(student_questions), question_count)
        )
        return None, info

    if any(len(q["options"]) != options_per_question for q in student_questions):
        info["reason"] = "the student sheet's option groups are incomplete"
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

    template_points = [
        (o["x"], o["y"]) for q in questions for o in (q.get("options") or [])
    ]
    options_per_question = int(positions.get("options_per_question") or 4)
    numbering = positions.get("numbering") or "column"

    # ---- preferred path: read the student sheet's own grid ----
    #
    # Warping the student photo onto the template and sampling at the template's
    # coordinates sounds natural, but an OMR sheet is a lattice of identical
    # circles: any registration that is off by one row still "fits" beautifully,
    # and every answer silently shifts by a question. Re-detecting the grid on
    # the student sheet avoids the problem entirely - question N is question N
    # in both sheets because both are ordered by the same deterministic rule.
    grid, align_info = _read_student_grid(
        s_gray, len(questions), options_per_question, numbering
    )

    if grid is not None:
        binary, student_questions = grid
        results = []
        for i, q in enumerate(questions):
            opts = student_questions[i]["options"]
            ratios = [_fill_ratio(binary, o["x"], o["y"], o["r"]) for o in opts]
            answer, state, margin = _decide(ratios)
            results.append({
                "q": int(q["q"]),
                "detected": answer,
                "state": state,
                "margin": round(float(margin), 3),
                "fill": [round(float(v), 3) for v in ratios],
            })
    else:
        # ---- fallback: register the sheets and sample at template coordinates ----
        warped, align_info = align_to_template(t_gray, s_gray, template_points)
        binary = _mark_mask(warped)
        results = []
        for q in questions:
            opts = q.get("options") or []
            ratios = [_fill_ratio(binary, o["x"], o["y"], o["r"]) for o in opts]
            answer, state, margin = _decide(ratios)
            results.append({
                "q": int(q["q"]),
                "detected": answer,
                "state": state,
                "margin": round(float(margin), 3),
                "fill": [round(float(v), 3) for v in ratios],
            })

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
