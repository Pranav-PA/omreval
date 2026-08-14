'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import AnchorEditor from '@/components/AnchorEditor';
import AnswerKeyGrid from '@/components/AnswerKeyGrid';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  isOption,
  MARKS_CORRECT,
  MAX_COLUMNS,
  MAX_ROWS,
  maxMarksFor,
  OPTIONS,
  type Option,
} from '@/lib/constants';
import { errorText } from '@/lib/errors';
import { positionsFromLayout } from '@/lib/grid';
import { prepareImage } from '@/lib/image';
import type { Anchors, AnchorSuggestion, SheetLayout } from '@/lib/types';

type Step = 'upload' | 'anchors' | 'key';

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Sheet layout' },
  { key: 'anchors', label: 'Place the markers' },
  { key: 'key', label: 'Answer key' },
];

export default function TemplateCreator() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [collegeName, setCollegeName] = useState('');
  const [numbering, setNumbering] = useState<'column' | 'row'>('column');
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [rows, setRows] = useState(DEFAULT_ROWS);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AnchorSuggestion | null>(null);
  const [layout, setLayout] = useState<SheetLayout | null>(null);

  const [answerKey, setAnswerKey] = useState<Record<string, Option | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questionCount = columns * rows;

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      const prepared = await prepareImage(file);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return prepared.previewUrl;
      });

      const form = new FormData();
      form.append('image', prepared.blob, 'template.jpg');
      form.append('columns', String(columns));
      form.append('rows', String(rows));
      form.append('options', String(OPTIONS.length));

      const response = await fetch('/api/suggest-anchors', { method: 'POST', body: form });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(errorText(data, `Could not read that image (HTTP ${response.status}).`));
        return;
      }

      const s: AnchorSuggestion = data.suggestion;
      setSuggestion(s);
      setImageUrl(data.image_url);
      setImagePath(data.image_path);
      setLayout({
        columns,
        rows,
        options: OPTIONS.length,
        anchors: s.anchors,
        radius: s.radius,
      });
      setStep('anchors');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong reading that image.');
    } finally {
      setBusy(false);
    }
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  }

  function setAnchors(anchors: Anchors) {
    setLayout((current) => (current ? { ...current, anchors } : current));
  }

  async function save() {
    if (!layout || !suggestion || !imageUrl || !imagePath) return;

    const missing = Array.from({ length: questionCount }, (_, i) => i + 1).filter(
      (q) => !isOption(answerKey[String(q)]),
    );
    if (missing.length) {
      setError(
        `Answer still missing for Q${missing.slice(0, 6).join(', Q')}${
          missing.length > 6 ? ` and ${missing.length - 6} more` : ''
        }.`,
      );
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const positions = positionsFromLayout(
        layout,
        numbering,
        suggestion.width,
        suggestion.height,
      );

      const response = await fetch('/api/save-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          college_name: collegeName,
          template_image_url: imageUrl,
          template_image_path: imagePath,
          bubble_positions: positions,
          answer_key: answerKey,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(errorText(data, `Could not save the template (HTTP ${response.status}).`));
        return;
      }

      router.push(`/evaluate?template=${data.template_id}`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEP_LABELS.findIndex((s) => s.key === step);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">New OMR template</h1>

      <ol className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {STEP_LABELS.map((s, i) => (
          <li
            key={s.key}
            className={
              i === stepIndex
                ? 'font-medium text-brand'
                : i < stepIndex
                  ? 'text-ok'
                  : 'text-muted'
            }
          >
            {i < stepIndex ? '✓' : `${i + 1}.`} {s.label}
          </li>
        ))}
      </ol>

      {error && <p className="alert-error mt-6">{error}</p>}

      {/* ---------------- Step 1: layout + upload ---------------- */}
      {step === 'upload' && (
        <div className="card mt-6 space-y-5">
          <div>
            <label className="label" htmlFor="college">
              College / exam name
            </label>
            <input
              id="college"
              className="input"
              placeholder="e.g. Krupanidhi PU College — Botany"
              value={collegeName}
              onChange={(e) => setCollegeName(e.target.value)}
              maxLength={120}
            />
          </div>

          <div>
            <span className="label">How the answer area is laid out</span>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="hint block" htmlFor="cols">
                  Columns
                </label>
                <input
                  id="cols"
                  type="number"
                  min={1}
                  max={MAX_COLUMNS}
                  className="input mt-1 w-24"
                  value={columns}
                  onChange={(e) => setColumns(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <span className="pb-2 text-muted">×</span>
              <div>
                <label className="hint block" htmlFor="rows">
                  Questions per column
                </label>
                <input
                  id="rows"
                  type="number"
                  min={1}
                  max={MAX_ROWS}
                  className="input mt-1 w-32"
                  value={rows}
                  onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <span className="pb-2 text-muted">×</span>
              <div>
                <label className="hint block">Options</label>
                <input className="input mt-1 w-20" value={OPTIONS.join('')} disabled />
              </div>
            </div>
            <p className="hint mt-2">
              <strong className="text-ink">{questionCount} questions</strong> · {MARKS_CORRECT}{' '}
              marks each · {maxMarksFor(questionCount)} total. Count only the answer rows —
              ignore the roll-number and test-ID bubbles entirely.
            </p>
          </div>

          <div>
            <span className="label">Question numbering</span>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="numbering"
                  checked={numbering === 'column'}
                  onChange={() => setNumbering('column')}
                />
                Down each column (Q1, Q2, Q3 …) — the usual layout
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="numbering"
                  checked={numbering === 'row'}
                  onChange={() => setNumbering('row')}
                />
                Across each row
              </label>
            </div>
          </div>

          <div>
            <span className="label">Blank OMR sheet</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onFileChosen}
              disabled={busy || !collegeName.trim()}
              className="block w-full text-sm text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-dark disabled:opacity-50"
            />
            <p className="hint mt-2">
              {collegeName.trim()
                ? 'A flat scan or straight-on photo. You will place four markers on it next, so it only needs to be readable — not perfect.'
                : 'Enter the college name first.'}
            </p>
          </div>

          {busy && <p className="alert-warn">Reading the sheet…</p>}
        </div>
      )}

      {/* ---------------- Step 2: place the anchors ---------------- */}
      {step === 'anchors' && layout && suggestion && (previewUrl || imageUrl) && (
        <div className="mt-6 space-y-4">
          <p className="alert-warn">
            The markers start where detection guessed. Check each one sits on the bubble it
            names — the whole grid is built from them, so this is the only step that has to
            be right.
          </p>

          <div className="card">
            <AnchorEditor
              imageUrl={previewUrl ?? imageUrl!}
              width={suggestion.width}
              height={suggestion.height}
              layout={layout}
              numbering={numbering}
              onChange={setAnchors}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => setStep('key')}>
              Markers are right — enter answer key
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setStep('upload');
                setLayout(null);
                setSuggestion(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              Upload a different sheet
            </button>
          </div>
        </div>
      )}

      {/* ---------------- Step 3: answer key ---------------- */}
      {step === 'key' && layout && (
        <div className="mt-6 space-y-4">
          <div className="card">
            <h2 className="font-semibold">Answer key for “{collegeName}”</h2>
            <p className="hint mt-1">
              {questionCount} questions · {MARKS_CORRECT} marks for a correct answer, 0 for a
              wrong or blank one, −1 if the student fills more than one bubble ·{' '}
              {maxMarksFor(questionCount)} total.
            </p>
            <div className="mt-6">
              <AnswerKeyGrid
                questionCount={questionCount}
                value={answerKey}
                onChange={setAnswerKey}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save template'}
            </button>
            <button className="btn-secondary" onClick={() => setStep('anchors')} disabled={busy}>
              Back to markers
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
