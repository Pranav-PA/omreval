/** Sheets vary by college - 45 for a NEET/JEE mock, 60 on a Krupanidhi sheet,
 *  180/200 for a full paper. Each template stores its own count. */
export const DEFAULT_QUESTION_COUNT = 45;
export const QUESTION_COUNT_PRESETS = [45, 50, 60, 90, 100, 180, 200];
export const MIN_QUESTION_COUNT = 1;
export const MAX_QUESTION_COUNT = 250;

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
