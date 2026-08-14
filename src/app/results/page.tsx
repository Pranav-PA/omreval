import Link from 'next/link';
import { redirect } from 'next/navigation';

import ResultSheet from '@/components/ResultSheet';
import UnsavedResult from '@/components/UnsavedResult';
import { createClient } from '@/lib/supabase/server';
import type { EvaluationResult } from '@/lib/types';

export const metadata = { title: 'Result — OMREval' };
export const dynamic = 'force-dynamic';

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  if (!id) return <UnsavedResult />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data, error } = await supabase
    .from('omr_evaluations')
    .select('results, created_at, omr_templates ( college_name )')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return (
      <div className="card text-center">
        <h1 className="font-semibold">Result not found</h1>
        <p className="hint mx-auto mt-2 max-w-md">
          This result does not exist, or it belongs to another account.
        </p>
        <Link href="/evaluate" className="btn-primary mt-5">
          Evaluate a sheet
        </Link>
      </div>
    );
  }

  const template = data.omr_templates as { college_name: string } | { college_name: string }[] | null;
  const collegeName = Array.isArray(template) ? template[0]?.college_name : template?.college_name;

  return (
    <ResultSheet
      result={data.results as EvaluationResult}
      collegeName={collegeName ?? null}
      evaluatedAt={data.created_at}
    />
  );
}
