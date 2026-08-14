'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { errorText } from '@/lib/errors';

type Mode = 'login' | 'signup';

const COPY: Record<Mode, { title: string; cta: string; alt: string; altHref: string; altLabel: string }> = {
  login: {
    title: 'Log in to OMREval',
    cta: 'Log in',
    alt: 'New here?',
    altHref: '/auth/signup',
    altLabel: 'Create an account',
  },
  signup: {
    title: 'Create your OMREval account',
    cta: 'Sign up',
    alt: 'Already registered?',
    altHref: '/auth/login',
    altLabel: 'Log in instead',
  },
};

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/dashboard';
  const copy = COPY[mode];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // /auth/callback sends the teacher back here when a confirmation link is
  // stale or already used, so say what happened rather than showing a bare form.
  const callbackError =
    searchParams.get('error') === 'confirmation_failed'
      ? 'That confirmation link did not work — it may have expired or already been used. Log in below, or sign up again to get a fresh link.'
      : null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === 'signup' && password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(errorText(data, 'Something went wrong. Please try again.'));
        return;
      }

      if (data?.needs_confirmation) {
        setNotice(
          `We sent a confirmation link to ${email.trim()}. Click it, then come back and log in.`,
        );
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>

      {callbackError && !error && !notice && (
        <p className="alert-warn mt-6">{callbackError}</p>
      )}

      <form onSubmit={onSubmit} className="card mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@college.edu"
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'signup' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
          />
        </div>

        {error && <p className="alert-error">{error}</p>}
        {notice && <p className="alert-ok">{notice}</p>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Please wait…' : copy.cta}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        {copy.alt}{' '}
        <Link href={copy.altHref} className="font-medium text-brand hover:underline">
          {copy.altLabel}
        </Link>
      </p>
    </div>
  );
}
