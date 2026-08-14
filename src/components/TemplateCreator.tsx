'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import AnswerKeyGrid from '@/components/AnswerKeyGrid';
import BubblePreview from '@/components/BubblePreview';
import {
  DEFAULT_QUESTION_COUNT,
  isOption,
  MARKS_CORRECT,
  maxMarksFor,
  QUESTION_COUNT_PRESETS,
  type Option,
} from '@/lib/constants';
import { prepareImage } from '@/lib/image';
import type { BubblePositions } from '@/lib/types';

type Step = 'upload' | 'confirm' | 'key';

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload blank sheet' },
  { key: 'confirm', label: 'Check detected bubbles' },
  { key: 'key', label: 'Enter answer key' },
];

export default function TemplateCreator() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [collegeName, setCollegeName] = useState('');
  const [numbering, setNumbering] = useState<'column' | 'row'>('column');
  const [expectedCount, setExpectedCount] = useState(DEFAULT_QUESTION_COUNT);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [positions, setPositions] = useState<BubblePositions | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);

  const [answerKey, setAnswerKey] = useState<Record<string, Option | undefined>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questionCount = positions ? positions.questions.length : expectedCount;
  const countMatches = questionCount === expectedCount;

  async function detectBubbles(file: File) {
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
      form.append('numbering', numbering);
      form.append('question_count', String(expectedCount));

      const response = await fetch('/api/detect-bubbles', { method: 'POST', body: form });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Bubble detection failed.');
        return;
      }

      setPositions(data.positions);
      setImageUrl(data.image_url);
      setImagePath(data.image_path);
      setStep('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong reading that image.');
    } finally {
      setBusy(false);
    }
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void detectBubbles(file);
  }

  async function save() {
    if (!positions || !imageUrl || !imagePath) return;

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
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Could not save the template.');
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

  const mismatchMessage =
    questionCount > expectedCount
      ? `${questionCount} question groups were found, but you said this sheet has ` +
        `${expectedCount}. Click a bubble in the extra groups and remove them — the ` +
        'roll-number block is the usual culprit.'
      : `Only ${questionCount} of the ${expectedCount} questions were detected. Check the ` +
        'overlay below — if whole rows are missing, re-upload a sharper, flatter scan of ' +
        'the sheet.';

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">New OMR template</h1>

      <ol className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {STEP_LABELS.map((s, i) => {
          const index = STEP_LABELS.findIndex((x) => x.key === step);
          const state = i < index ? 'done' : i === index ? 'current' : 'todo';
          return (
            <li
              key={s.key}
              className={
                state === 'current'
                  ? 'font-medium text-brand'
                  : state === 'done'
                    ? 'text-ok'
                    : 'text-muted'
              }
            >
              {state === 'done' ? '✓' : `${i + 1}.`} {s.label}
            </li>
          );
        })}
      </ol>

      {error && <p className="alert-error mt-6">{error}</p>}

      {/* ---------------- Step 1: upload ---------------- */}
      {step === 'upload' && (
        <div className="card mt-6 space-y-5">
          <div>
            <label className="label" htmlFor="college">
              College / exam name
            </label>
            <input
              id="college"
              className="input"
              placeholder="e.g. Sunrise Junior College — NEET mock 3"
              value={collegeName}
              onChange={(e) => setCollegeName(e.target.value)}
              maxLength={120}
            />
          </div>

          <div>
            <label className="label" htmlFor="qcount">
              Number of questions on the sheet
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {QUESTION_COUNT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setExpectedCount(preset)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    expectedCount === preset
                      ? 'border-brand bg-brand text-white'
                      : 'border-line bg-white text-muted hover:border-brand hover:text-brand'
                  }`}
                >
                  {preset}
                </button>
              ))}
              <input
                id="qcount"
                type="number"
                min={1}
                max={250}
                value={expectedCount}
                onChange={(e) => setExpectedCount(Number(e.target.value))}
                className="input w-24"
                aria-label="Custom question count"
              />
            </div>
            <p className="hint mt-2">
              Count only the answer rows, not the roll-number bubbles. Scored at{' '}
              {MARKS_CORRECT} marks each — {maxMarksFor(expectedCount)} total.
            </p>
          </div>

          <div>
            <span className="label">Question numbering on the sheet</span>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="numbering"
                  checked={numbering === 'column'}
                  onChange={() => setNumbering('column')}
                />
                Down each column (Q1 top-left, Q2 below it) — usual NEET/JEE layout
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
                ? 'A flat scan or a straight-on photo works best. Keep the whole sheet in frame.'
                : 'Enter the college name first.'}
            </p>
          </div>

          {busy && <p className="alert-warn">Detecting bubbles… this takes a few seconds.</p>}
        </div>
      )}

      {/* ---------------- Step 2: confirm ---------------- */}
      {step === 'confirm' && positions && (previewUrl || imageUrl) && (
        <div className="mt-6 space-y-4">
          {!countMatches && (
            <p className={questionCount > expectedCount ? 'alert-error' : 'alert-warn'}>
              {mismatchMessage}
            </p>
          )}
          {countMatches && (
            <p className="alert-ok">
              All {questionCount} questions detected. Worth a quick look over the overlay
              before you continue.
            </p>
          )}

          <div className="card">
            <BubblePreview
              imageUrl={previewUrl ?? imageUrl!}
              positions={positions}
              onChange={setPositions}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="btn-primary"
              onClick={() => setStep('key')}
              disabled={positions.questions.length === 0 || !countMatches}
            >
              Looks right — enter answer key
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setStep('upload');
                setPositions(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              Upload a different sheet
            </button>
          </div>
        </div>
      )}

      {/* ---------------- Step 3: answer key ---------------- */}
      {step === 'key' && positions && (
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
            <button className="btn-secondary" onClick={() => setStep('confirm')} disabled={busy}>
              Back to bubbles
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
