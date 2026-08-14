import { NextResponse } from 'next/server';

import { downloadImage, fail, requireUser, toBase64, uploadImage, validateImage } from '@/lib/api';
import { callPython, PyServiceError } from '@/lib/pyclient';
import { scoreSheet } from '@/lib/scoring';
import type { AnswerKey, BubblePositions, DetectionResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/evaluate-omr
 *
 * Multipart form: template_id, student_name, roll_number (optional),
 *                 image (the filled student sheet).
 *
 * Aligns the student photo to the template, reads the filled bubbles, scores
 * them against the stored answer key and persists the result.
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

  const templateId = String(form.get('template_id') ?? '').trim();
  const studentName = String(form.get('student_name') ?? '').trim();
  const rollNumberRaw = String(form.get('roll_number') ?? '').trim();

  if (!templateId) return fail('Choose an OMR template first.');
  if (!studentName) return fail('Student name is required.');
  if (studentName.length > 120) return fail('That student name is too long.');
  if (rollNumberRaw.length > 40) return fail('That roll number is too long.');

  const checked = validateImage(form.get('image'));
  if ('error' in checked) return fail(checked.error);

  // ---- template (RLS guarantees it belongs to this teacher) ----
  const { data: template, error: templateError } = await supabase
    .from('omr_templates')
    .select('id, template_image_path, template_image_url, bubble_positions, answer_key')
    .eq('id', templateId)
    .eq('user_id', user.id)
    .single();

  if (templateError || !template) {
    return fail('That template could not be found.', 404);
  }
  if (!template.template_image_path) {
    return fail('This template has no stored image. Please create it again.', 422);
  }

  const templateImage = await downloadImage(supabase, template.template_image_path);
  if ('error' in templateImage) return fail(templateImage.error, 500);

  // ---- student sheet ----
  const uploaded = await uploadImage(supabase, user.id, 'students', checked.file);
  if ('error' in uploaded) return fail(uploaded.error, 500);

  let detection: DetectionResponse;
  try {
    detection = await callPython<DetectionResponse>('evaluate_omr', {
      template_image: await toBase64(templateImage.blob),
      student_image: await toBase64(checked.file),
      positions: template.bubble_positions as BubblePositions,
    });
  } catch (error) {
    if (error instanceof PyServiceError) {
      return fail(error.message, error.status);
    }
    return fail('Evaluation failed. Please try re-photographing the sheet.', 500);
  }

  const result = scoreSheet({
    studentName,
    rollNumber: rollNumberRaw || null,
    answerKey: template.answer_key as AnswerKey,
    detections: detection.questions,
    alignment: detection.alignment,
  });

  const { data: saved, error: saveError } = await supabase
    .from('omr_evaluations')
    .insert({
      user_id: user.id,
      template_id: template.id,
      student_name: studentName,
      roll_number: result.roll_number,
      student_omr_image_url: uploaded.url,
      student_omr_image_path: uploaded.path,
      results: result,
      marks: result.total_marks,
      max_marks: result.max_marks,
    })
    .select('id')
    .single();

  if (saveError || !saved) {
    // The scoring itself succeeded — hand the teacher the result anyway.
    return NextResponse.json({ ok: true, evaluation_id: null, result });
  }

  return NextResponse.json({ ok: true, evaluation_id: saved.id, result });
}
