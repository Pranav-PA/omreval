/**
 * The browser draws the grid from src/lib/grid.ts so markers move under the
 * cursor without a server round-trip; scoring uses api/py/_geometry.py. If the
 * two ever disagree, bubbles are sampled somewhere other than where the teacher
 * saw them, and every mark is quietly wrong. So diff them.
 *
 *   node tests/test_grid_parity.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

// Compile the real grid.ts with tsc rather than hand-stripping types, so this
// test exercises exactly the code the browser runs.
const outDir = join(root, '.tmp-parity');
execFileSync(
  process.execPath,
  [join(root, 'node_modules/typescript/bin/tsc'),
   'src/lib/grid.ts', '--outDir', '.tmp-parity',
   '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck'],
  { cwd: root, stdio: 'pipe' },
);
const { buildGrid } = createRequire(import.meta.url)(join(outDir, 'grid.js'));

const python = ['.venv/Scripts/python.exe', '.venv/bin/python', 'python'].find((p) =>
  p === 'python' ? true : existsSync(join(root, p)),
);
const raw = execFileSync(
  python === 'python' ? 'python' : join(root, python),
  [join(here, 'grid_parity.py')],
  { encoding: 'utf8', cwd: root },
);
const cases = JSON.parse(raw);

let failures = 0;
for (const { label, input, questions } of cases) {
  const layout = {
    columns: input.columns,
    rows: input.rows,
    options: input.options,
    anchors: input.anchors,
    // Mirror the Python default when the case leaves radius unset.
    radius: input.radius ?? defaultRadiusFor(input),
  };
  const mine = buildGrid(layout, input.numbering);

  let worst = 0;
  let mismatch = null;
  if (mine.length !== questions.length) {
    mismatch = `length ${mine.length} vs ${questions.length}`;
  } else {
    for (let i = 0; i < questions.length && !mismatch; i += 1) {
      if (mine[i].q !== questions[i].q) {
        mismatch = `question number at index ${i}`;
        break;
      }
      for (let j = 0; j < questions[i].options.length; j += 1) {
        const a = mine[i].options[j];
        const b = questions[i].options[j];
        if (!a || a.option !== b.option) {
          mismatch = `option label at Q${questions[i].q}`;
          break;
        }
        worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y), Math.abs(a.r - b.r));
      }
    }
  }

  const ok = !mismatch && worst < 0.011;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}` +
      (mismatch ? `  ${mismatch}` : `  worst delta ${worst.toFixed(4)}px`),
  );
}

function defaultRadiusFor({ anchors, columns, rows, options }) {
  const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lengths = [
    d(anchors.first_option, anchors.last_option) / Math.max(1, options - 1),
    d(anchors.first_option, anchors.last_row) / Math.max(1, rows - 1),
    d(anchors.first_option, anchors.last_column) / Math.max(1, columns - 1),
  ].filter((v) => v > 1e-6);
  return lengths.length ? Math.max(3, Math.min(...lengths) * 0.32) : 10;
}

rmSync(outDir, { recursive: true, force: true });

console.log();
if (failures) {
  console.log(`${failures} CASE(S) DIVERGED`);
  process.exit(1);
}
console.log('TYPESCRIPT AND PYTHON GEOMETRY AGREE');
