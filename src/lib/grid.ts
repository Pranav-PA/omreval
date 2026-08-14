import { OPTIONS } from './constants';
import type { Anchors, BubblePositions, BubbleQuestion, SheetLayout } from './types';

/**
 * Bubble centres implied by four anchor points.
 *
 * Deliberately mirrors api/py/_geometry.py. The teacher drags markers and needs
 * to see all 240 bubbles move under their cursor, which rules out asking the
 * server on every pointer event. The two implementations are kept in step by
 * tests/test_geometry.py and src/lib/grid.test.mjs asserting identical output.
 */
export function buildGrid(layout: SheetLayout, numbering: 'column' | 'row'): BubbleQuestion[] {
  const { columns, rows, options, anchors, radius } = layout;
  const origin = anchors.first_option;

  const step = (far: readonly [number, number], count: number): [number, number] =>
    count <= 0 ? [0, 0] : [(far[0] - origin[0]) / count, (far[1] - origin[1]) / count];

  const optionStep = step(anchors.last_option, options - 1);
  const rowStep = step(anchors.last_row, rows - 1);
  const columnStep = step(anchors.last_column, columns - 1);

  const cells: { column: number; row: number; options: BubbleQuestion['options'] }[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const baseX = origin[0] + columnStep[0] * column + rowStep[0] * row;
      const baseY = origin[1] + columnStep[1] * column + rowStep[1] * row;
      cells.push({
        column,
        row,
        options: Array.from({ length: options }, (_, j) => ({
          option: OPTIONS[j] ?? String.fromCharCode(65 + j),
          x: round2(baseX + optionStep[0] * j),
          y: round2(baseY + optionStep[1] * j),
          r: round2(radius),
        })),
      });
    }
  }

  cells.sort((a, b) =>
    numbering === 'row'
      ? a.row - b.row || a.column - b.column
      : a.column - b.column || a.row - b.row,
  );

  return cells.map((cell, index) => ({ q: index + 1, options: cell.options }));
}

export function positionsFromLayout(
  layout: SheetLayout,
  numbering: 'column' | 'row',
  width: number,
  height: number,
): BubblePositions {
  const questions = buildGrid(layout, numbering);
  return {
    width,
    height,
    options_per_question: layout.options,
    numbering,
    detected_questions: questions.length,
    expected_questions: layout.columns * layout.rows,
    questions,
    layout,
  };
}

/** Radius that cannot make neighbouring bubbles overlap. */
export function defaultRadius(anchors: Anchors, columns: number, rows: number, options: number) {
  const lengths = [
    distance(anchors.first_option, anchors.last_option) / Math.max(1, options - 1),
    distance(anchors.first_option, anchors.last_row) / Math.max(1, rows - 1),
    distance(anchors.first_option, anchors.last_column) / Math.max(1, columns - 1),
  ].filter((v) => v > 0.001);
  return lengths.length ? Math.max(3, Math.min(...lengths) * 0.32) : 10;
}

function distance(a: readonly [number, number], b: readonly [number, number]) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
