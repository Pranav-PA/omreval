import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Your templates — OMREval' };
export const dynamic = 'force-dynamic';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: templates, error } = await supabase
    .from('omr_templates')
    .select('id, college_name, template_image_url, bubble_positions, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your OMR templates</h1>
          <p className="hint mt-1">
            A template is one blank sheet layout plus its answer key.
          </p>
        </div>
        <Link href="/templates/create" className="btn-primary">
          New template
        </Link>
      </div>

      {error && <p className="alert-error mt-6">Could not load your templates.</p>}

      {!error && (!templates || templates.length === 0) ? (
        <div className="card mt-8 text-center">
          <h2 className="font-semibold">No templates yet</h2>
          <p className="hint mx-auto mt-2 max-w-md">
            Upload your college’s blank OMR sheet and enter the answer key. You only do this
            once per exam — after that you can evaluate as many student sheets as you like.
          </p>
          <Link href="/templates/create" className="btn-primary mt-5">
            Create your first template
          </Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {(templates ?? []).map((t) => (
            <li key={t.id} className="card flex gap-4">
              {t.template_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.template_image_url}
                  alt=""
                  className="h-24 w-20 shrink-0 rounded border border-line object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold">{t.college_name}</h2>
                <p className="hint mt-1">
                  {t.bubble_positions?.questions?.length ?? 0} questions ·{' '}
                  {formatDate(t.created_at)}
                </p>
                <Link
                  href={`/evaluate?template=${t.id}`}
                  className="mt-3 inline-block text-sm font-medium text-brand hover:underline"
                >
                  Evaluate a sheet →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
