# OMREval

Automated OMR (Optical Mark Recognition) evaluation for teachers. Upload your
college's blank OMR sheet once, enter the answer key once, then score student
sheets from a phone photo.

- Any question count per template (45, 60, 200 …), 4 options (A–D), 4 marks per correct answer
- Tilted / rotated / skewed phone photos are deskewed and read without hand-alignment
- Multiple bubbles filled → −1; unclear marking → flagged and scored as wrong
- Roll-number and test-ID bubble blocks are discarded automatically

---

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router, TypeScript, Tailwind) |
| Auth | Supabase Auth (email + password) |
| Database | Supabase Postgres, row level security per teacher |
| Storage | Supabase Storage (`omr` bucket) |
| Image processing | Python + OpenCV, as Vercel serverless functions |

---

## Prerequisites

Neither Node.js nor Python is installed on this machine yet. Install both:

- **Node.js 20 LTS** — https://nodejs.org (the Windows `.msi` installer)
- **Python 3.12** — https://www.python.org/downloads/ (tick *Add python.exe to PATH*)

Close and reopen your terminal after installing so `PATH` picks them up.

---

## Setup

### 1. Create the Supabase project

1. Create a project at https://supabase.com.
2. Open **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql) and run it. That creates the
   `omr_templates` and `omr_evaluations` tables, the row level security
   policies, and the public `omr` storage bucket.
3. Under **Authentication → URL Configuration**, set the **Site URL** to your
   deployed origin and add every `/auth/callback` URL that should be allowed to
   receive a confirmation link — production, `http://localhost:3000/auth/callback`
   for local dev, and a wildcard for Vercel preview builds.
4. Under **Authentication → Sign In / Providers**, decide whether to keep
   *Confirm email* on. Leaving it on is the safer default, but Supabase's
   built-in mailer is heavily rate limited on the free plan; turn it off (or
   wire up a real SMTP provider) if you are inviting a lot of teachers at once.

### 2. Configure environment

```bash
copy .env.local.example .env.local
```

Fill in from **Project Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

No service-role key is required. Every database and storage call is made as the
signed-in teacher, so row level security — not application code — is what stops
one account from reading another's templates or results.

### 3. Install dependencies

```bash
npm install
```

```bash
pip install -r requirements.txt
```

### 4. Run it

The Python image service and the Next.js app run as two processes in local dev.

Terminal 1 — the OpenCV service:

```bash
npm run py:dev
```

Terminal 2 — the app:

```bash
npm run dev
```

Set `PYTHON_API_URL=http://127.0.0.1:8000` in `.env.local` so the app knows
where to find the service, then open http://localhost:3000.

> On Vercel both live in the same deployment, so leave `PYTHON_API_URL` empty in
> production and the app calls its own origin.

---

## Deploying to Vercel

1. Push the repo and import it at https://vercel.com/new.
2. Add the same environment variables in **Settings → Environment Variables**
   (leave `PYTHON_API_URL` unset).
3. Under **Settings → Functions**, confirm the Python runtime version is 3.12.

`vercel.json` gives the Python functions a 60 s ceiling; `requirements.txt` is
installed automatically (Vercel provisions Python 3.12 via uv).

> **Do not add a `memory` setting to `vercel.json`.** The Hobby plan caps
> serverless functions at 2048 MB, and requesting more makes *every* deployment
> fail validation instantly — the deploy hook still returns `201 PENDING`, but
> no deployment is ever created, so the dashboard just shows "No Production
> Deployment" with no error anywhere. On Active CPU billing the setting is
> ignored regardless, so leave it out.

Optionally set `PY_SHARED_SECRET` to the same value on both sides; the Python
endpoints then reject any request that does not carry it.

---

## How it works

### Template creation (`/templates/create`)

1. The blank sheet is downscaled to 1600 px in the browser and posted to
   `POST /api/detect-bubbles`, which stores it and forwards it to the Python
   service.
2. `detect_bubbles` thresholds the sheet (adaptive **and** Otsu, keeping
   whichever gives the better grid), finds contours, and keeps the ones that are
   circular, consistently sized and consistently spaced.
3. Bubbles are clustered into rows by *y*, split into questions by the wide gaps
   between option groups, and grouped into printed columns by *x*. Questions are
   then numbered down each column (the usual NEET/JEE layout) or across each
   row — the teacher picks which.
4. The overlay on screen is editable: any bubble can be dragged, or selected and
   nudged with the arrow keys. A whole group can also be deleted — useful when
   the sheet's roll-number block gets picked up as extra "questions", since
   those bubbles look identical to answer bubbles. The remaining questions
   renumber themselves.
5. The answer key (A–D per question, with a paste-the-whole-key shortcut) is
   saved alongside the geometry via `POST /api/save-template`.

### Evaluation (`/evaluate`)

1. `POST /api/evaluate-omr` loads the template (row level security guarantees it
   belongs to the caller), stores the student photo, and sends both images to
   `evaluate_omr`.
2. **The student sheet's own grid is detected, rather than the photo being
   warped onto the template.** See the note below — this is the single most
   important design decision in the project.
3. The sheet is deskewed first. The skew angle comes from the bubbles
   themselves: each bubble's nearest neighbour is the adjacent option in the
   same question, so those vectors all run along a printed row, and their median
   angle is the rotation. A handful of stray detections cannot move a median.
4. Lighting is flattened by dividing the image by a heavily blurred copy of
   itself, then Otsu-thresholded, so a shadow across the page does not read as a
   filled bubble.
5. For each bubble, the fraction of dark pixels inside the printed ring is
   measured. ≥ 60 % counts as filled.
6. The Python side reports only *what was marked*. Marks are computed in
   [`src/lib/scoring.ts`](src/lib/scoring.ts) — the answer key never leaves the
   Next.js layer.

### Why alignment does not use feature matching

The obvious approach — ORB/SIFT features, RANSAC homography, warp the student
photo onto the template, sample at the template's coordinates — **does not work
on OMR sheets**, and fails in a way that is dangerous rather than obvious.

An answer sheet is a lattice of near-identical circles. Feature descriptors for
one bubble match every other bubble about equally well, so RANSAC can settle on
a correspondence that is off by exactly one row and still report hundreds of
happy inliers. The warp looks excellent by every internal metric, and every
answer is silently shifted by one question. During development this produced a
confident 179-inlier alignment in which Q5 was read from Q4's marks.

Matching the two grids by geometry instead (bounding box, min-area rectangle,
corner extremes) has the same weakness for the same reason: two lattices whose
extents differ slightly register one row out.

So evaluation re-detects the grid on the student sheet and reads the marks at
the student's *own* bubble positions. Student groups are then matched to
template questions **by position**, not by list index — a real scan routinely
loses or invents a group to noise, and index matching would shift every
subsequent answer by one. A question with no matching group is reported as
unreadable rather than being read from its neighbour's bubbles.

**There is deliberately no fallback.** Warping onto the template and sampling at
template coordinates was measured returning **9 of 60** answers correct on a
noisy sheet while reporting no error at all — the lattice makes an off-by-one-row
registration fit beautifully. Marks that are quietly wrong are far worse for a
student than an evaluation that declines, so if the grid cannot be read the
request fails with an explanation instead.

**Known limitation:** a bubble grid looks identical rotated 180°, so geometry
alone cannot tell an upside-down sheet from an upright one. Deskew resolves
rotation only up to that flip and prefers the least-rotated fit. Photograph
sheets roughly upright.

### Marking scheme

| Case | Marks | Status |
|---|---|---|
| Correct | +4 | `correct` |
| Wrong | 0 | `wrong` |
| Blank | 0 | `not_answered` |
| More than one bubble filled | −1 | `flagged` (`multiple`) |
| Too ambiguous to read | 0 | `flagged` (`uncertain`) |

Ambiguity means either two bubbles are nearly equally dark, or the darkest one
is a faint partial mark. Both are surfaced so the teacher can re-check by hand.

---

## API

All routes require a signed-in session; the user is taken from the session
cookie rather than a request parameter, so one teacher can never read another's
templates or results.

| Route | Body | Returns |
|---|---|---|
| `POST /api/auth/signup` | `{ email, password }` | `{ ok, needs_confirmation }` |
| `POST /api/auth/login` | `{ email, password }` | `{ ok, user_id, access_token }` |
| `POST /api/detect-bubbles` | multipart: `image`, `numbering` | `{ positions, image_url, image_path }` |
| `POST /api/save-template` | `{ college_name, template_image_url, template_image_path, bubble_positions, answer_key }` | `{ ok, template_id }` |
| `GET /api/templates` | — | `{ templates: [...] }` |
| `POST /api/evaluate-omr` | multipart: `template_id`, `student_name`, `roll_number`, `image` | `{ ok, evaluation_id, result }` |

### Result shape

```json
{
  "student_name": "Raj Kumar",
  "roll_number": "A123",
  "total_marks": 156,
  "max_marks": 180,
  "percentage": 86.67,
  "correct_count": 39,
  "wrong_count": 5,
  "not_answered_count": 1,
  "flagged_count": 0,
  "alignment": { "aligned": true, "matches": 240, "inliers": 180, "reason": null },
  "questions": [
    { "q": 1, "correct_answer": "A", "student_answer": "A", "status": "correct", "marks": 4 },
    { "q": 2, "correct_answer": "C", "student_answer": "B", "status": "wrong", "marks": 0 },
    { "q": 3, "correct_answer": "D", "student_answer": null, "status": "not_answered", "marks": 0 },
    { "q": 4, "correct_answer": "A", "student_answer": "multiple/unclear", "status": "flagged", "flag_reason": "multiple", "marks": -1 }
  ]
}
```

---

## Tuning detection

Everything adjustable lives at the top of
[`api/py/_omr.py`](api/py/_omr.py):

| Constant | Meaning |
|---|---|
| `FILL_THRESHOLD` | Darkness fraction that counts as a filled bubble (0.60) |
| `FAINT_FLOOR` | Below this, nothing was marked at all (0.32) |
| `MIN_MARGIN` | Gap between best and runner-up needed for confidence (0.18) |
| `MIN_BUBBLE_R` / `MAX_BUBBLE_R` | Bubble radius range in normalised px |
| `MIN_CIRCULARITY` | How round a contour must be to be a bubble |
| `INNER_RADIUS_FACTOR` | How far inside the printed ring to sample (0.70) |
| `MIN_GRID_COMPLETENESS` | Fraction of question rows that must be found (0.8) |
| `MAX_UNREADABLE_FRACTION` | Above this, decline instead of reporting marks (0.2) |
| `MAX_ANGLE_POINTS` / `MAX_CANDIDATES` | Work caps that keep a noisy scan inside the function timeout |

If a particular college sheet detects badly, raise `MIN_CIRCULARITY` (fewer
false positives from letters and boxes) or widen the radius range (bubbles
smaller or larger than expected).

**Note on empty sheets.** If not a single filled bubble is found, evaluation
fails with an error instead of returning 0 / 180. That is deliberate: a photo
that is blurred, cropped or badly aligned produces exactly the same reading as
an untouched sheet, and silently reporting zero would be the more dangerous
answer. A genuinely blank sheet therefore has to be recorded by hand.

---

## Tests

Two end-to-end tests build a synthetic OMR sheet, photograph it in software
(rotation, perspective, a shadow gradient across the page), and check that every
answer comes back correctly — including deliberately blank questions and
questions with two bubbles filled.

```bash
npm run py:test
```

- `tests/test_synthetic_45.py` — 45 questions, 3 columns. Verifies detection
  count, column-major numbering, and a full read-back.
- `tests/test_real_layout_60.py` — a replica of the Krupanidhi sheet: 60
  questions in 4 columns, plus the 11×10 roll-number block and 3×10 test-ID
  block. Confirms those blocks are *not* mistaken for answer groups, and reads
  the sheet at 0°, 3.5°, −8° and 12° rotation.

- `tests/test_noisy_scan.py` — the important one. Adds speckle, stray printed
  blocks and sensor grain, because clean synthetic sheets hide two whole classes
  of bug: the pairwise geometry is quadratic in the candidate count (fine at
  ~250 candidates, gigabytes at 20,000), and losing a single group to noise used
  to invalidate the entire read. Asserts both accuracy and a time budget.
- `tests/test_http_endpoints.py` — drives the two serverless endpoints over HTTP
  the way the Next.js layer does, and checks that a corrupt image and a missing
  field come back as clean 422s rather than stack traces. Needs
  `npm run py:dev` running first.

All three currently pass at 100 % of questions. If you change any constant in
`_omr.py`, run these first.

## Project layout

```
api/py/                     OpenCV service (Vercel Python functions)
  _omr.py                     detection, alignment, fill measurement
  _handler.py                 request/response + error boilerplate
  detect_bubbles.py           POST /api/py/detect_bubbles
  evaluate_omr.py             POST /api/py/evaluate_omr
devserver.py                Local stand-in for the two functions above
supabase/schema.sql         Tables, RLS policies, storage bucket
tests/                      End-to-end detection + scoring tests
src/app/                    Pages and Next.js route handlers
src/components/             BubblePreview, AnswerKeyGrid, ResultSheet, forms
src/lib/scoring.ts          Marking scheme
src/lib/types.ts            Shared shapes
```

## Status

- Next.js production build: passing, 15 routes
- TypeScript: clean under `strict`
- Python detection + scoring: both test suites at 100 %
- Not yet exercised against a real photographed sheet — the tests use
  synthetic sheets, so the detection constants may need one round of tuning
  against your actual scans.
