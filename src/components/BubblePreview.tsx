'use client';

import { useCallback, useRef, useState } from 'react';

import type { BubblePositions } from '@/lib/types';

interface Props {
  imageUrl: string;
  positions: BubblePositions;
  onChange: (next: BubblePositions) => void;
}

interface DragState {
  qIndex: number;
  oIndex: number;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
}

/**
 * Draws the detected bubbles over the uploaded template so the teacher can see
 * what was found. Any single bubble can be dragged if detection put it slightly
 * off; selecting one also enables arrow-key nudging.
 */
export default function BubblePreview({ imageUrl, positions, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [selected, setSelected] = useState<{ q: number; o: number } | null>(null);
  const [showNumbers, setShowNumbers] = useState(true);

  const pct = useCallback(
    (value: number, axis: 'x' | 'y') =>
      (value / (axis === 'x' ? positions.width : positions.height)) * 100,
    [positions.width, positions.height],
  );

  const moveBubble = useCallback(
    (qIndex: number, oIndex: number, x: number, y: number) => {
      const questions = positions.questions.map((q, qi) => {
        if (qi !== qIndex) return q;
        return {
          ...q,
          options: q.options.map((o, oi) =>
            oi === oIndex
              ? {
                  ...o,
                  x: Math.round(Math.min(Math.max(x, 0), positions.width) * 100) / 100,
                  y: Math.round(Math.min(Math.max(y, 0), positions.height) * 100) / 100,
                }
              : o,
          ),
        };
      });
      onChange({ ...positions, questions });
    },
    [positions, onChange],
  );

  function onPointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    qIndex: number,
    oIndex: number,
  ) {
    const option = positions.questions[qIndex].options[oIndex];
    dragRef.current = {
      qIndex,
      oIndex,
      originX: option.x,
      originY: option.y,
      startX: event.clientX,
      startY: event.clientY,
    };
    setSelected({ q: qIndex, o: oIndex });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!drag || !rect || rect.width === 0) return;

    const scaleX = positions.width / rect.width;
    const scaleY = positions.height / rect.height;
    moveBubble(
      drag.qIndex,
      drag.oIndex,
      drag.originX + (event.clientX - drag.startX) * scaleX,
      drag.originY + (event.clientY - drag.startY) * scaleY,
    );
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!selected) return;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    const option = positions.questions[selected.q].options[selected.o];
    moveBubble(selected.q, selected.o, option.x + delta[0] * step, option.y + delta[1] * step);
  }

  /**
   * Drops a whole question group and renumbers what is left. This is how a
   * teacher gets rid of a block detection picked up by mistake - most often the
   * roll-number bubbles, which look exactly like answer bubbles.
   */
  function removeSelectedQuestion() {
    if (!selected) return;
    const questions = positions.questions
      .filter((_, qi) => qi !== selected.q)
      .map((q, i) => ({ ...q, q: i + 1 }));
    onChange({ ...positions, questions, detected_questions: questions.length });
    setSelected(null);
  }

  const selectedQuestion = selected ? positions.questions[selected.q] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="hint">
          {positions.questions.length} questions ·{' '}
          {positions.questions.reduce((n, q) => n + q.options.length, 0)} bubbles detected.
          Drag any bubble to correct it, or select one and nudge with the arrow keys.
        </p>
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showNumbers}
            onChange={(e) => setShowNumbers(e.target.checked)}
          />
          Question numbers
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-slate-50 px-4 py-2.5 text-sm">
        {selectedQuestion ? (
          <>
            <span>
              Selected <strong>Q{selectedQuestion.q}</strong> ·{' '}
              {selectedQuestion.options.map((o) => o.option).join(' ')}
            </span>
            <button
              type="button"
              onClick={removeSelectedQuestion}
              className="ml-auto rounded-lg border border-red-200 bg-white px-3 py-1.5 font-medium text-bad transition hover:bg-red-50"
            >
              Not a question — remove it
            </button>
          </>
        ) : (
          <span className="text-muted">
            Click a bubble to select its question. Use this to remove anything that isn’t an
            answer group, such as the roll-number block.
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        tabIndex={0}
        className="relative w-full overflow-hidden rounded-lg border border-line bg-white outline-none focus:ring-2 focus:ring-brand/30"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Blank OMR template" className="block w-full select-none" />

        {positions.questions.map((question, qIndex) =>
          question.options.map((option, oIndex) => {
            const isSelected = selected?.q === qIndex && selected?.o === oIndex;
            return (
              <button
                key={`${question.q}-${option.option}`}
                type="button"
                onPointerDown={(e) => onPointerDown(e, qIndex, oIndex)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                title={`Q${question.q} · ${option.option}`}
                aria-label={`Question ${question.q} option ${option.option}`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 transition-colors active:cursor-grabbing ${
                  isSelected
                    ? 'border-amber-500 bg-amber-400/30'
                    : 'border-brand/80 bg-brand/10 hover:bg-brand/25'
                }`}
                style={{
                  left: `${pct(option.x, 'x')}%`,
                  top: `${pct(option.y, 'y')}%`,
                  width: `${pct(option.r * 2, 'x')}%`,
                  aspectRatio: '1 / 1',
                }}
              />
            );
          }),
        )}

        {showNumbers &&
          positions.questions.map((question) => {
            const first = question.options[0];
            if (!first) return null;
            return (
              <span
                key={`label-${question.q}`}
                className="pointer-events-none absolute -translate-y-1/2 rounded bg-brand px-1 text-[9px] font-semibold leading-tight text-white"
                style={{
                  left: `calc(${pct(first.x - first.r, 'x')}% - 1.6rem)`,
                  top: `${pct(first.y, 'y')}%`,
                }}
              >
                {question.q}
              </span>
            );
          })}
      </div>
    </div>
  );
}
