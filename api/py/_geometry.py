"""Template geometry from four anchor points.

The previous design tried to *discover* the answer grid from a photo of the
blank sheet. Every failure it produced was a discovery failure: the roll-number
block looks exactly like answer groups, faintly printed rows vanish, and an
inferred row pitch can land on a fraction of the true spacing and crush the grid
into a band. Each fix traded one failure for another.

So the grid is no longer discovered. A teacher places four markers once per
college sheet and the geometry follows exactly:

    A = centre of question 1, option A          (origin)
    B = centre of question 1, last option       (spacing between options)
    C = centre of the last row of column 1, option A   (spacing between rows)
    D = centre of the first row of the last column, option A  (between columns)

Every bubble centre is then

    A + (B-A) * j/(options-1) + (C-A) * i/(rows-1) + (D-A) * k/(columns-1)

Because the steps are 2-D vectors rather than scalars, a sheet scanned slightly
rotated or sheared still produces a correct grid. Detection is now only used to
*suggest* where those four markers go.
"""

import numpy as np

OPTION_LABELS = ["A", "B", "C", "D", "E", "F"]


class GeometryError(Exception):
    """Raised with a message safe to show a teacher."""


def _step(origin, far, count):
    """Per-unit vector from origin to far across `count` intervals."""
    if count <= 0:
        return np.zeros(2, dtype=np.float64)
    return (np.asarray(far, dtype=np.float64) - np.asarray(origin, dtype=np.float64)) / count


def build_grid_from_anchors(anchors, columns, rows, options, numbering="column",
                            radius=None):
    """Return the full question list implied by four anchor points.

    `anchors` is a dict with keys first_option, last_option, last_row, last_column,
    each an (x, y) pair in normalised image coordinates.
    """
    for key in ("first_option", "last_option", "last_row", "last_column"):
        if key not in anchors:
            raise GeometryError("Anchor point '%s' is missing." % key)

    if columns < 1 or rows < 1 or options < 2:
        raise GeometryError("A sheet needs at least one column, one row and two options.")
    if options > len(OPTION_LABELS):
        raise GeometryError("At most %d options per question are supported." % len(OPTION_LABELS))

    origin = np.asarray(anchors["first_option"], dtype=np.float64)
    option_step = _step(origin, anchors["last_option"], options - 1)
    row_step = _step(origin, anchors["last_row"], rows - 1)
    column_step = _step(origin, anchors["last_column"], columns - 1)

    if radius is None:
        # A sensible default: bubbles never overlap, so keep well inside the
        # smallest spacing actually present.
        spacings = [
            float(np.linalg.norm(v))
            for v in (option_step, row_step, column_step)
            if float(np.linalg.norm(v)) > 1e-6
        ]
        radius = (min(spacings) * 0.32) if spacings else 10.0
    radius = float(max(3.0, radius))

    cells = []
    for column in range(columns):
        for row in range(rows):
            base = origin + column_step * column + row_step * row
            cells.append({
                "column": column,
                "row": row,
                "options": [
                    {
                        "option": OPTION_LABELS[j],
                        "x": round(float(base[0] + option_step[0] * j), 2),
                        "y": round(float(base[1] + option_step[1] * j), 2),
                        "r": round(radius, 2),
                    }
                    for j in range(options)
                ],
            })

    if numbering == "row":
        cells.sort(key=lambda c: (c["row"], c["column"]))
    else:  # column-major: down column 1, then column 2 - the NEET/JEE layout
        cells.sort(key=lambda c: (c["column"], c["row"]))

    return [
        {"q": index + 1, "options": cell["options"]}
        for index, cell in enumerate(cells)
    ]


def anchors_from_questions(questions, columns, rows, options, numbering="column"):
    """Recover the four anchors from an existing question list.

    Used to seed the editor from whatever detection managed to find, and to
    re-derive anchors for templates saved before anchors were stored.
    """
    if not questions:
        raise GeometryError("No questions to derive anchors from.")

    def cell_index(column, row):
        return column * rows + row if numbering != "row" else row * columns + column

    def option_centre(column, row, option):
        index = cell_index(column, row)
        if index < 0 or index >= len(questions):
            return None
        opts = questions[index].get("options") or []
        if option >= len(opts):
            return None
        return (float(opts[option]["x"]), float(opts[option]["y"]))

    first = option_centre(0, 0, 0)
    last_option = option_centre(0, 0, options - 1)
    last_row = option_centre(0, rows - 1, 0)
    last_column = option_centre(columns - 1, 0, 0)

    if None in (first, last_option, last_row, last_column):
        raise GeometryError("The saved grid does not match the given layout.")

    return {
        "first_option": first,
        "last_option": last_option,
        "last_row": last_row,
        "last_column": last_column,
    }
