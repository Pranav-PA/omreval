import { NextResponse } from 'next/server';

import { fail, requireUser } from '@/lib/api';
import { isOption, MAX_QUESTION_COUNT } from '@/lib/constants';
import type { AnswerKey, BubblePositions } from '@/lib/types';

export const runtime = 'nodejs';

interface SaveBody {
  college_name?: string;
  template_image_url?: string;
  template_image_path?: string;
  bubble_positions?: BubblePositions;
  answer_key?: Record<string, string>;
}

function validatePositions(p: unknown): p is BubblePositions {
  if (!p || typeof p !== 'object') return false;
  const pos = p as BubblePositions;
  return (
    typeof pos.width === 'number' &&
    typeof pos.height === 'number' &&
    Array.isArray(pos.questions) &&
    pos.questions.length > 0 &&
    pos.questions.every(
      (q) => typeof q.q === 'number' && Array.isArray(q.options) && q.options.length > 0,
    )
  );
}

function validateAnswerKey(raw: unknown, questionCount: number): AnswerKey | string {
  if (!raw || typeof raw !== 'object') return 'The answer key is missing.';
  const key: AnswerKey = {};
  const missing: number[] = [];

  for (let q = 1; q <= questionCount; q += 1) {
    const value = (raw as Record<string, unknown>)[String(q)];
    if (!isOption(value)) {
      missing.push(q);
      continue;
    }
    key[String(q)] = value;
  }

  if (missing.length) {
    const shown = missing.slice(0, 8).join(', ');
    const more = missing.length > 8 ? ` and ${missing.length - 8} more` : '';
    return `Please choose an answer for every question. Missing: Q${shown}${more}.`;
  }
  return key;
}

/**
 * POST /api/save-template
 * Body: { college_name, template_image_url, template_image_path,
 *         bubble_positions, answer_key }
 */
export async function POST(request: Request) {
  const { user, supabase } = await requireUser();
  if (!user) return fail('You need to be logged in.', 401);

  let body: SaveBody;
  try {
    body = await request.json();
  } catch {
    return fail('Invalid request.');
  }

  const collegeName = body.college_name?.trim();
  if (!collegeName) return fail('Enter the college or exam name for this template.');
  if (collegeName.length > 120) return fail('That name is too long (max 120 characters).');

  if (!body.template_image_url || !body.template_image_path) {
    return fail('The template image is missing. Please upload it again.');
  }

  if (!validatePositions(body.bubble_positions)) {
    return fail('The detected bubble positions are missing or invalid. Re-run detection.');
  }

  const questionCount = body.bubble_positions.questions.length;
  if (questionCount > MAX_QUESTION_COUNT) {
    return fail(
      `${questionCount} question groups were marked on this sheet, which is more than ` +
        `OMREval supports (${MAX_QUESTION_COUNT}). Remove the groups that are not answer ` +
        `rows — the roll-number block is the usual culprit.`,
    );
  }

  const answerKey = validateAnswerKey(body.answer_key, questionCount);
  if (typeof answerKey === 'string') return fail(answerKey);

  const { data, error } = await supabase
    .from('omr_templates')
    .insert({
      user_id: user.id,
      college_name: collegeName,
      template_image_url: body.template_image_url,
      template_image_path: body.template_image_path,
      bubble_positions: body.bubble_positions,
      answer_key: answerKey,
    })
    .select('id')
    .single();

  if (error || !data) {
    return fail('Could not save the template. Please try again.', 500);
  }

  return NextResponse.json({ ok: true, template_id: data.id });
}
