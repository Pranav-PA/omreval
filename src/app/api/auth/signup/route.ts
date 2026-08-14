import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Use a password of at least 8 characters.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // With "Confirm email" enabled in Supabase, signUp returns a user but no
  // session - the teacher has to click the emailed link first.
  if (!data.session) {
    return NextResponse.json({ ok: true, needs_confirmation: true });
  }

  return NextResponse.json({ ok: true, needs_confirmation: false, user_id: data.user?.id });
}
