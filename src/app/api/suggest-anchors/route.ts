import { NextResponse } from 'next/server';

import { fail, requireUser, toBase64, uploadImage, validateImage } from '@/lib/api';
import { MAX_COLUMNS, MAX_ROWS, OPTIONS } from '@/lib/constants';
import { callPython, PyServiceError } from '@/lib/pyclient';
import type { AnchorSuggestion } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

function positive(value: FormDataEntryValue | null, fallback: number, limit: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > limit) return fallback;
  return Math.floor(parsed);
}

/**
 * POST /api/suggest-anchors
 *
 * Stores the blank sheet and returns a *suggested* position for the four
 * template anchors. The teacher then drags them; the suggestion is never
 * treated as the grid itself.
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

  const columns = positive(form.get('columns'), 4, MAX_COLUMNS);
  const rows = positive(form.get('rows'), 15, MAX_ROWS);
  const options = positive(form.get('options'), OPTIONS.length, 6);

  const uploaded = await uploadImage(supabase, user.id, 'templates', checked.file);
  if ('error' in uploaded) return fail(uploaded.error, 500);

  try {
    const suggestion = await callPython<AnchorSuggestion>('suggest_anchors', {
      image: await toBase64(checked.file),
      columns,
      rows,
      options,
    });

    return NextResponse.json({
      suggestion,
      image_url: uploaded.url,
      image_path: uploaded.path,
    });
  } catch (error) {
    if (error instanceof PyServiceError) return fail(error.message, error.status);
    return fail('Could not read that image. Please try another scan.', 500);
  }
}
