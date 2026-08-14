import type { Metadata } from 'next';

import Nav from '@/components/Nav';
import { getUser } from '@/lib/supabase/server';

import './globals.css';

export const metadata: Metadata = {
  title: 'OMREval — automated OMR evaluation',
  description:
    'Upload your college OMR sheet, enter the answer key, and score student sheets from a photo.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();

  return (
    <html lang="en">
      <body>
        <Nav email={user?.email ?? null} />
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
