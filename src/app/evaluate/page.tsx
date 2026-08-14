import Link from 'next/link';
import { redirect } from 'next/navigation';

import EvaluateForm from '@/components/EvaluateForm';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Evaluate a sheet — OMREval' };
export const dynamic = 'force-dynamic';

export default async function EvaluatePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: templates } = await supabase
    .from('omr_templates')
    .select('id, college_name, bubble_positions, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const options = (templates ?? []).map((t) => ({
    id: t.id,
    college_name: t.college_name,
    question_count: t.bubble_positions?.questions?.length ?? 0,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Evaluate a student sheet</h1>

      {options.length === 0 ? (
        <div className="card mt-6 text-center">
          <h2 className="font-semibold">You need a template first</h2>
          <p className="hint mx-auto mt-2 max-w-md">
            A template holds the bubble layout of your blank OMR plus the answer key. Create
            one and you can evaluate sheets against it.
          </p>
          <Link href="/templates/create" className="btn-primary mt-5">
            Create a template
          </Link>
        </div>
      ) : (
        <EvaluateForm templates={options} initialTemplateId={template ?? options[0].id} />
      )}
    </div>
  );
}
