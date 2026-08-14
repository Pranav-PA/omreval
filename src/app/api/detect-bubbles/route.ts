import { NextResponse } from 'next/server';

import { fail, requireUser, toBase64, uploadImage, validateImage } from '@/lib/api';
import {
  DEFAULT_QUESTION_COUNT,
  MAX_QUESTION_COUNT,
  MIN_QUESTION_COUNT,
  OPTIONS,
} from '@/lib/constants';
import { callPython, PyServiceError } from '@/lib/pyclient';
import type { BubblePositions } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/detect-bubbles
 *
 * Multipart form: image (blank OMR template), optional numbering ("column" | "row").
 * Stores the template image and returns the detected bubble grid.
 */
export async function POST(request: Request) {
  const { user, supabase } = await requireUser();
  if (!user) return fail('You need to be logged in.', 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('Invalid upload.');
  }

  const checked = validateImage(form.get('image'));
  if ('error' in checked) return fail(checked.error);

  const numbering = form.get('numbering') === 'row' ? 'row' : 'column';

  const requested = Number(form.get('question_count'));
  const expectedQuestions =
    Number.isFinite(requested) &&
    requested >= MIN_QUESTION_COUNT &&
    requested <= MAX_QUESTION_COUNT
      ? Math.floor(requested)
      : DEFAULT_QUESTION_COUNT;

  const uploaded = await uploadImage(supabase, user.id, 'templates', checked.file);
  if ('error' in uploaded) return fail(uploaded.error, 500);

  try {
    const positions = await callPython<BubblePositions>('detect_bubbles', {
      image: await toBase64(checked.file),
      options_per_question: OPTIONS.length,
      expected_questions: expectedQuestions,
      numbering,
    });

    return NextResponse.json({
      positions,
      image_url: uploaded.url,
      image_path: uploaded.path,
    });
  } catch (error) {
    if (error instanceof PyServiceError) {
      return fail(error.message, error.status);
    }
    return fail('Bubble detection failed. Please try a clearer scan of the sheet.', 500);
  }
}
