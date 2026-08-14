/** Sheets vary by college - 45 for a NEET/JEE mock, 60 on a Krupanidhi sheet,
 *  180/200 for a full paper. Each template stores its own count. */
export const DEFAULT_QUESTION_COUNT = 45;
export const QUESTION_COUNT_PRESETS = [45, 50, 60, 90, 100, 180, 200];
export const MIN_QUESTION_COUNT = 1;
export const MAX_QUESTION_COUNT = 250;

/** Sheet layout: questions are laid out in columns x rows. */
export const DEFAULT_COLUMNS = 4;
export const DEFAULT_ROWS = 15;
export const MAX_COLUMNS = 20;
export const MAX_ROWS = 100;

export const ANCHOR_KEYS = [
  'first_option',
  'last_option',
  'last_row',
  'last_column',
] as const;

export type AnchorKey = (typeof ANCHOR_KEYS)[number];

/** What each marker means, in the teacher's words. */
export const ANCHOR_LABELS: Record<AnchorKey, { title: string; hint: string }> = {
  first_option: {
    title: 'Question 1, option A',
    hint: 'The very first bubble — top-left of the answer area.',
  },
  last_option: {
    title: 'Question 1, last option',
    hint: 'The last bubble of that same question (D on a four-option sheet).',
  },
  last_row: {
    title: 'Bottom of the first column, option A',
    hint: 'Option A of the last question in the left-hand column.',
  },
  last_column: {
    title: 'Top of the last column, option A',
    hint: 'Option A of the first question in the right-hand column.',
  },
};

export const OPTIONS = ['A', 'B', 'C', 'D'] as const;
export const MARKS_CORRECT = 4;
export const MARKS_WRONG = 0;
export const MARKS_MULTIPLE = -1; // more than one bubble filled
export const MARKS_UNCERTAIN = 0; // ambiguous detection - scored as wrong
export const MARKS_NOT_ANSWERED = 0;

export function maxMarksFor(questionCount: number) {
  return questionCount * MARKS_CORRECT;
}

/** Longest side we send to the image service. Matches WORK_MAX_DIM in _omr.py. */
export const UPLOAD_MAX_DIM = 1600;

export const STORAGE_BUCKET = 'omr';

export type Option = (typeof OPTIONS)[number];

export function isOption(value: unknown): value is Option {
  return typeof value === 'string' && (OPTIONS as readonly string[]).includes(value);
}
