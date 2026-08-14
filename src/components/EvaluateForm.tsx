'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { prepareImage } from '@/lib/image';

interface TemplateOption {
  id: string;
  college_name: string;
  question_count: number;
}

export default function EvaluateForm({
  templates,
  initialTemplateId,
}: {
  templates: TemplateOption[];
  initialTemplateId: string;
}) {
  const router = useRouter();

  const known = templates.some((t) => t.id === initialTemplateId);
  const [templateId, setTemplateId] = useState(known ? initialTemplateId : templates[0].id);
  const [studentName, setStudentName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return chosen ? URL.createObjectURL(chosen) : null;
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!studentName.trim()) {
      setError('Student name is required.');
      return;
    }
    if (!file) {
      setError('Upload a photo of the filled sheet.');
      return;
    }

    setBusy(true);
    try {
      const prepared = await prepareImage(file);

      const form = new FormData();
      form.append('template_id', templateId);
      form.append('student_name', studentName.trim());
      form.append('roll_number', rollNumber.trim());
      form.append('image', prepared.blob, 'student.jpg');

      const response = await fetch('/api/evaluate-omr', { method: 'POST', body: form });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Evaluation failed.');
        return;
      }

      if (data.evaluation_id) {
        router.push(`/results?id=${data.evaluation_id}`);
        router.refresh();
      } else {
        // Scored, but the row could not be stored - keep the teacher's result.
        sessionStorage.setItem('omreval:last-result', JSON.stringify(data.result));
        router.push('/results');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const selected = templates.find((t) => t.id === templateId);

  return (
    <form onSubmit={onSubmit} className="card mt-6 space-y-5">
      <div>
        <label className="label" htmlFor="template">
          OMR template
        </label>
        <select
          id="template"
          className="input"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.college_name}
            </option>
          ))}
        </select>
        {selected && (
          <p className="hint mt-1.5">{selected.question_count} questions in this template.</p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="student-name">
            Student name <span className="text-bad">*</span>
          </label>
          <input
            id="student-name"
            className="input"
            required
            maxLength={120}
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="Raj Kumar"
          />
        </div>
        <div>
          <label className="label" htmlFor="roll">
            Roll number <span className="text-muted">(optional)</span>
          </label>
          <input
            id="roll"
            className="input"
            maxLength={40}
            value={rollNumber}
            onChange={(e) => setRollNumber(e.target.value)}
            placeholder="A123"
          />
        </div>
      </div>

      <div>
        <span className="label">Filled student sheet</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onFileChosen}
          className="block w-full text-sm text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-dark"
        />
        <p className="hint mt-2">
          A phone photo is fine — a tilted or rotated sheet is straightened against the
          template automatically. Make sure all four corners are visible and in focus.
        </p>
      </div>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Uploaded student sheet"
          className="max-h-72 rounded-lg border border-line object-contain"
        />
      )}

      {error && <p className="alert-error">{error}</p>}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Evaluating…' : 'Evaluate'}
      </button>
    </form>
  );
}
