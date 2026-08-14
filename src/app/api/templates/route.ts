import { NextResponse } from 'next/server';

import { fail, requireUser } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * GET /api/templates
 * Returns every template belonging to the signed-in teacher. Row level
 * security scopes this to their own rows regardless of what is requested.
 */
export async function GET() {
  const { user, supabase } = await requireUser();
  if (!user) return fail('You need to be logged in.', 401);

  const { data, error } = await supabase
    .from('omr_templates')
    .select('id, college_name, template_image_url, bubble_positions, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return fail('Could not load your templates.', 500);

  return NextResponse.json({
    templates: (data ?? []).map((t) => ({
      id: t.id,
      college_name: t.college_name,
      template_image_url: t.template_image_url,
      question_count: t.bubble_positions?.questions?.length ?? 0,
      created_at: t.created_at,
    })),
  });
}
