'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import ResultSheet from '@/components/ResultSheet';
import type { EvaluationResult } from '@/lib/types';

/**
 * Fallback for the rare case where scoring succeeded but the database write
 * did not - EvaluateForm stashes the result in sessionStorage so the teacher
 * still gets their marks.
 */
export default function UnsavedResult() {
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('omreval:last-result');
      if (raw) setResult(JSON.parse(raw) as EvaluationResult);
    } catch {
      // ignore malformed storage
    }
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (!result) {
    return (
      <div className="card text-center">
        <h1 className="font-semibold">No result to show</h1>
        <p className="hint mx-auto mt-2 max-w-md">
          Pick a template and upload a student sheet to get a result.
        </p>
        <Link href="/evaluate" className="btn-primary mt-5">
          Evaluate a sheet
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="alert-warn no-print">
        This result could not be saved to your account, so it will disappear when you close
        this tab. Print or download it now if you need to keep it.
      </p>
      <ResultSheet result={result} />
    </div>
  );
}
