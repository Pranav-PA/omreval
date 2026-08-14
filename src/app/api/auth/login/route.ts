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

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately vague: do not reveal whether the address is registered.
    return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
  }

  // The session cookie is set by the SSR client; the JWT is returned for any
  // non-browser client that wants to call the API directly.
  return NextResponse.json({
    ok: true,
    user_id: data.user.id,
    access_token: data.session?.access_token ?? null,
    expires_at: data.session?.expires_at ?? null,
  });
}
