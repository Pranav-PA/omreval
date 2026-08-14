import {
  MARKS_CORRECT,
  MARKS_MULTIPLE,
  MARKS_NOT_ANSWERED,
  MARKS_UNCERTAIN,
  MARKS_WRONG,
} from './constants';
import type {
  AlignmentInfo,
  AnswerKey,
  DetectedQuestion,
  EvaluationResult,
  QuestionResult,
} from './types';

/**
 * Marking scheme
 * --------------
 *   correct               +4
 *   wrong                  0
 *   not answered           0
 *   multiple bubbles      -1   (status "flagged", reason "multiple")
 *   ambiguous detection    0   (status "flagged", reason "uncertain" - scored
 *                               as wrong, but surfaced so the teacher can
 *                               re-check the sheet by hand)
 */
export function scoreQuestion(
  detection: DetectedQuestion,
  correctAnswer: string,
): QuestionResult {
  if (detection.state === 'multiple') {
    return {
      q: detection.q,
      correct_answer: correctAnswer,
      student_answer: 'multiple/unclear',
      status: 'flagged',
      flag_reason: 'multiple',
      marks: MARKS_MULTIPLE,
    };
  }

  if (detection.state === 'uncertain') {
    return {
      q: detection.q,
      correct_answer: correctAnswer,
      student_answer: detection.detected ?? 'multiple/unclear',
      status: 'flagged',
      flag_reason: 'uncertain',
      marks: MARKS_UNCERTAIN,
    };
  }

  if (detection.state === 'blank' || !detection.detected) {
    return {
      q: detection.q,
      correct_answer: correctAnswer,
      student_answer: null,
      status: 'not_answered',
      marks: MARKS_NOT_ANSWERED,
    };
  }

  const isCorrect = detection.detected === correctAnswer;
  return {
    q: detection.q,
    correct_answer: correctAnswer,
    student_answer: detection.detected,
    status: isCorrect ? 'correct' : 'wrong',
    marks: isCorrect ? MARKS_CORRECT : MARKS_WRONG,
  };
}

export function scoreSheet(params: {
  studentName: string;
  rollNumber?: string | null;
  answerKey: AnswerKey;
  detections: DetectedQuestion[];
  alignment: AlignmentInfo;
}): EvaluationResult {
  const { studentName, rollNumber, answerKey, detections, alignment } = params;

  const questions = detections
    .slice()
    .sort((a, b) => a.q - b.q)
    .map((d) => scoreQuestion(d, answerKey[String(d.q)] ?? ''));

  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
  const maxMarks = questions.length * MARKS_CORRECT;

  return {
    student_name: studentName,
    roll_number: rollNumber?.trim() ? rollNumber.trim() : null,
    total_marks: totalMarks,
    max_marks: maxMarks,
    percentage: maxMarks > 0 ? Math.round((totalMarks / maxMarks) * 10000) / 100 : 0,
    correct_count: questions.filter((q) => q.status === 'correct').length,
    wrong_count: questions.filter((q) => q.status === 'wrong').length,
    not_answered_count: questions.filter((q) => q.status === 'not_answered').length,
    flagged_count: questions.filter((q) => q.status === 'flagged').length,
    alignment,
    questions,
  };
}

/** One-line summary used on the results page, e.g. "Q2: ✗ (answered B, correct is C)" */
export function describeQuestion(q: QuestionResult): { icon: string; text: string } {
  switch (q.status) {
    case 'correct':
      return { icon: '✓', text: `answered ${q.student_answer}, correct` };
    case 'wrong':
      return {
        icon: '✗',
        text: `answered ${q.student_answer}, correct is ${q.correct_answer}`,
      };
    case 'not_answered':
      return { icon: '—', text: 'not answered' };
    case 'flagged':
      return q.flag_reason === 'multiple'
        ? { icon: '⚠', text: 'multiple bubbles filled, marked wrong (-1)' }
        : {
            icon: '⚠',
            text: `unclear marking, marked wrong (correct is ${q.correct_answer})`,
          };
  }
}
