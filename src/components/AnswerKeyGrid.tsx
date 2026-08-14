'use client';

import { useMemo, useState } from 'react';

import { isOption, OPTIONS, type Option } from '@/lib/constants';

interface Props {
  questionCount: number;
  value: Record<string, Option | undefined>;
  onChange: (next: Record<string, Option | undefined>) => void;
}

/** Accepts "ABCDA…", "A B C D", "1=A, 2=B" or one answer per line. */
function parsePastedKey(raw: string, questionCount: number): Record<string, Option> | string {
  const text = raw.trim();
  if (!text) return 'Nothing to paste.';

  const result: Record<string, Option> = {};

  const pairs = text.match(/\b(\d{1,3})\s*[=:.)-]\s*([A-Da-d])\b/g);
  if (pairs && pairs.length > 1) {
    for (const pair of pairs) {
      const [, q, letter] = /(\d{1,3})\s*[=:.)-]\s*([A-Da-d])/.exec(pair)!;
      const number = Number(q);
      if (number >= 1 && number <= questionCount) {
        result[String(number)] = letter.toUpperCase() as Option;
      }
    }
    if (Object.keys(result).length === 0) return 'Could not read any answers from that text.';
    return result;
  }

  const letters = text.toUpperCase().replace(/[^A-D]/g, '');
  if (letters.length === 0) return 'Could not find any A/B/C/D answers in that text.';
  if (letters.length > questionCount) {
    return `That looks like ${letters.length} answers, but this template has ${questionCount} questions.`;
  }
  letters.split('').forEach((letter, i) => {
    result[String(i + 1)] = letter as Option;
  });
  return result;
}

export default function AnswerKeyGrid({ questionCount, value, onChange }: Props) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const questions = useMemo(
    () => Array.from({ length: questionCount }, (_, i) => i + 1),
    [questionCount],
  );
  const answered = questions.filter((q) => isOption(value[String(q)])).length;

  function setAnswer(q: number, option: Option) {
    onChange({ ...value, [String(q)]: option });
  }

  function applyPaste() {
    const parsed = parsePastedKey(pasteText, questionCount);
    if (typeof parsed === 'string') {
      setPasteError(parsed);
      return;
    }
    onChange({ ...value, ...parsed });
    setPasteError(null);
    setPasteText('');
    setPasteOpen(false);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="hint">
          {answered} of {questionCount} answered
          {answered < questionCount && ' — every question needs an answer before saving.'}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPasteOpen((v) => !v)}>
            Paste key
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onChange({})}
            disabled={answered === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {pasteOpen && (
        <div className="mb-4 rounded-lg border border-line bg-slate-50 p-4">
          <label className="label" htmlFor="paste-key">
            Paste the whole key at once
          </label>
          <textarea
            id="paste-key"
            className="input h-24 font-mono"
            placeholder={`ACBD…  or  1=A, 2=C, 3=B …`}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          {pasteError && <p className="alert-error mt-2">{pasteError}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary" onClick={applyPaste}>
              Apply
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPasteOpen(false);
                setPasteError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {questions.map((q) => {
          const current = value[String(q)];
          return (
            <div
              key={q}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${
                current ? '' : 'bg-amber-50'
              }`}
            >
              <span className="w-9 shrink-0 text-right text-sm tabular-nums text-muted">
                Q{q}
              </span>
              <div className="flex gap-1" role="radiogroup" aria-label={`Answer for question ${q}`}>
                {OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={current === option}
                    onClick={() => setAnswer(q, option)}
                    className={`h-8 w-8 rounded-full border text-sm font-medium transition ${
                      current === option
                        ? 'border-brand bg-brand text-white'
                        : 'border-line bg-white text-muted hover:border-brand hover:text-brand'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
