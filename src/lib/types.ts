import type { Option } from './constants';

// ---------------------------------------------------------------------------
// Bubble geometry (produced by /api/py/detect_bubbles, stored on the template)
// ---------------------------------------------------------------------------

export interface BubblePoint {
  option: string;
  x: number;
  y: number;
  r: number;
}

export interface BubbleQuestion {
  q: number;
  options: BubblePoint[];
}

/** The four points that define a sheet's geometry, in normalised image px. */
export type AnchorPoint = [number, number];

export interface Anchors {
  first_option: AnchorPoint;
  last_option: AnchorPoint;
  last_row: AnchorPoint;
  last_column: AnchorPoint;
}

/** Reply from /api/suggest-anchors — a starting position, not the grid. */
export interface AnchorSuggestion {
  width: number;
  height: number;
  columns: number;
  rows: number;
  options_per_question: number;
  anchors: Anchors;
  radius: number;
  detected_groups: number;
}

/** Layout the teacher confirmed, stored with the template. */
export interface SheetLayout {
  columns: number;
  rows: number;
  options: number;
  anchors: Anchors;
  radius: number;
}

export interface BubblePositions {
  /** Size of the normalised working image the coordinates belong to. */
  width: number;
  height: number;
  options_per_question: number;
  numbering: 'column' | 'row';
  detected_questions: number;
  expected_questions: number;
  questions: BubbleQuestion[];
  /** Present on templates built from anchors, which is now the normal path. */
  layout?: SheetLayout;
}

export type AnswerKey = Record<string, Option>;

// ---------------------------------------------------------------------------
// Detection output (from /api/py/evaluate_omr)
// ---------------------------------------------------------------------------

export type BubbleState = 'single' | 'multiple' | 'uncertain' | 'blank';

export interface DetectedQuestion {
  q: number;
  detected: string | null;
  state: BubbleState;
  margin: number;
  fill: number[];
}

export interface AlignmentInfo {
  aligned: boolean;
  matches: number;
  inliers: number;
  reason: string | null;
}

export interface DetectionResponse {
  alignment: AlignmentInfo;
  questions: DetectedQuestion[];
}

// ---------------------------------------------------------------------------
// Scored result (what the UI renders and what we persist)
// ---------------------------------------------------------------------------

export type QuestionStatus = 'correct' | 'wrong' | 'not_answered' | 'flagged';
export type FlagReason = 'multiple' | 'uncertain';

export interface QuestionResult {
  q: number;
  correct_answer: string;
  /** The option we read, or "multiple/unclear" when we could not read one. */
  student_answer: string | null;
  status: QuestionStatus;
  flag_reason?: FlagReason;
  marks: number;
}

export interface EvaluationResult {
  student_name: string;
  roll_number: string | null;
  total_marks: number;
  max_marks: number;
  percentage: number;
  correct_count: number;
  wrong_count: number;
  not_answered_count: number;
  flagged_count: number;
  alignment: AlignmentInfo;
  questions: QuestionResult[];
}

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

export interface TemplateRow {
  id: string;
  user_id: string;
  college_name: string;
  template_image_url: string;
  template_image_path: string | null;
  bubble_positions: BubblePositions;
  answer_key: AnswerKey;
  created_at: string;
}

export interface EvaluationRow {
  id: string;
  user_id: string;
  template_id: string;
  student_name: string;
  roll_number: string | null;
  student_omr_image_url: string | null;
  student_omr_image_path: string | null;
  results: EvaluationResult;
  marks: number;
  max_marks: number;
  created_at: string;
}
