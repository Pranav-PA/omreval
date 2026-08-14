'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

const LINKS = [
  { href: '/dashboard', label: 'Templates' },
  { href: '/evaluate', label: 'Evaluate' },
];

export default function Nav({ email }: { email: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.push('/auth/login');
    router.refresh();
  }

  return (
    <header className="no-print border-b border-line bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
        <Link href={email ? '/dashboard' : '/'} className="font-semibold tracking-tight">
          OMR<span className="text-brand">Eval</span>
        </Link>

        {email && (
          <nav className="flex items-center gap-1">
            {LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${
                    active ? 'bg-brand-light font-medium text-brand' : 'text-muted hover:text-ink'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-3 text-sm">
          {email ? (
            <>
              <span className="hidden text-muted sm:inline">{email}</span>
              <button onClick={signOut} disabled={signingOut} className="btn-secondary">
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="text-muted hover:text-ink">
                Log in
              </Link>
              <Link href="/auth/signup" className="btn-primary">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
