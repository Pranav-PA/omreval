import Link from 'next/link';
import { redirect } from 'next/navigation';

import { MARKS_CORRECT } from '@/lib/constants';
import { getUser } from '@/lib/supabase/server';

const STEPS = [
  {
    title: 'Upload your blank OMR',
    body: 'One photo or scan of your college’s blank answer sheet. OMREval finds every bubble on it automatically — 45, 60 or 200 questions, whatever your sheet uses.',
  },
  {
    title: 'Enter the answer key',
    body: 'Pick A, B, C or D for each question — or paste the whole key at once — and save it as a reusable template.',
  },
  {
    title: 'Photograph student sheets',
    body: 'A phone photo is enough — tilted or rotated sheets are straightened against your template before scoring.',
  },
];

export default async function LandingPage() {
  const user = await getUser();
  if (user) redirect('/dashboard');

  return (
    <div className="space-y-16">
      <section className="pt-6">
        <p className="text-sm font-medium uppercase tracking-wide text-brand">
          For NEET / JEE pattern sheets
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Score a stack of OMR sheets
          <br />
          from your phone camera.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Upload your college’s blank OMR once, type the answer key once, and then evaluate
          every student sheet against it. {MARKS_CORRECT} marks per correct answer — with
          multiple-marked and unclear bubbles flagged for review instead of quietly guessed.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/auth/signup" className="btn-primary px-6 py-2.5">
            Create a free account
          </Link>
          <Link href="/auth/login" className="btn-secondary px-6 py-2.5">
            I already have one
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step.title} className="card">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-light text-sm font-semibold text-brand">
              {i + 1}
            </div>
            <h2 className="mt-4 font-semibold">{step.title}</h2>
            <p className="mt-2 text-sm text-muted">{step.body}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="font-semibold">How marks are awarded</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between border-b border-line pb-2">
            <dt>Correct answer</dt>
            <dd className="font-medium text-ok">+{MARKS_CORRECT}</dd>
          </div>
          <div className="flex justify-between border-b border-line pb-2">
            <dt>Wrong answer</dt>
            <dd className="font-medium">0</dd>
          </div>
          <div className="flex justify-between border-b border-line pb-2">
            <dt>Not answered</dt>
            <dd className="font-medium">0</dd>
          </div>
          <div className="flex justify-between border-b border-line pb-2">
            <dt>More than one bubble filled</dt>
            <dd className="font-medium text-bad">−1</dd>
          </div>
          <div className="flex justify-between sm:col-span-2">
            <dt>Unclear marking (flagged for review)</dt>
            <dd className="font-medium">0, scored as wrong</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
