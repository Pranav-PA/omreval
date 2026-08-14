'use client';

import { useCallback, useRef, useState } from 'react';

import { ANCHOR_KEYS, ANCHOR_LABELS, type AnchorKey } from '@/lib/constants';
import { buildGrid } from '@/lib/grid';
import type { Anchors, SheetLayout } from '@/lib/types';

interface Props {
  imageUrl: string;
  width: number;
  height: number;
  layout: SheetLayout;
  numbering: 'column' | 'row';
  onChange: (anchors: Anchors) => void;
}

const MARKER_COLOUR: Record<AnchorKey, string> = {
  first_option: 'bg-brand',
  last_option: 'bg-emerald-600',
  last_row: 'bg-amber-500',
  last_column: 'bg-fuchsia-600',
};

const ZOOM = 4;
const LENS = 132;

export default function AnchorEditor({
  imageUrl,
  width,
  height,
  layout,
  numbering,
  onChange,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<AnchorKey | null>(null);
  const [active, setActive] = useState<AnchorKey>('first_option');
  const [showBubbles, setShowBubbles] = useState(true);

  const questions = buildGrid(layout, numbering);

  const pct = useCallback(
    (value: number, axis: 'x' | 'y') => (value / (axis === 'x' ? width : height)) * 100,
    [width, height],
  );

  /** Pointer position -> image coordinates, clamped to the page. */
  const toImage = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return [0, 0];
      const x = ((clientX - rect.left) / rect.width) * width;
      const y = ((clientY - rect.top) / rect.height) * height;
      return [
        Math.round(Math.min(Math.max(x, 0), width) * 100) / 100,
        Math.round(Math.min(Math.max(y, 0), height) * 100) / 100,
      ];
    },
    [width, height],
  );

  function move(key: AnchorKey, point: [number, number]) {
    onChange({ ...layout.anchors, [key]: point });
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>, key: AnchorKey) {
    dragRef.current = key;
    setActive(key);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!dragRef.current) return;
    move(dragRef.current, toImage(event.clientX, event.clientY));
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const current = layout.anchors[active];
    move(active, [current[0] + delta[0] * step, current[1] + delta[1] * step]);
  }

  const activePoint = layout.anchors[active];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="hint">
          Drag each marker onto the bubble it names. Everything else is worked out from
          those four points — {questions.length} questions,{' '}
          {questions.length * layout.options} bubbles.
        </p>
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showBubbles}
            onChange={(e) => setShowBubbles(e.target.checked)}
          />
          Show all bubbles
        </label>
      </div>

      {/* Which marker is being placed, and a magnified view of it */}
      <div className="mb-3 flex flex-wrap gap-2">
        {ANCHOR_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActive(key)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
              active === key
                ? 'border-ink bg-white font-medium text-ink shadow-sm'
                : 'border-line bg-white text-muted hover:text-ink'
            }`}
          >
            <span className={`h-3 w-3 rounded-full ${MARKER_COLOUR[key]}`} />
            {ANCHOR_LABELS[key].title}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-start gap-4 rounded-lg border border-line bg-slate-50 p-3">
        <div
          className="shrink-0 rounded-lg border border-line bg-white"
          style={{
            width: LENS,
            height: LENS,
            backgroundImage: `url(${imageUrl})`,
            backgroundRepeat: 'no-repeat',
            // Magnify around the active marker so it can be placed on the exact
            // bubble centre rather than approximately.
            backgroundSize: `${width * ZOOM}px ${height * ZOOM}px`,
            backgroundPosition: `${LENS / 2 - activePoint[0] * ZOOM}px ${
              LENS / 2 - activePoint[1] * ZOOM
            }px`,
          }}
          aria-hidden
        />
        <div className="min-w-0 text-sm">
          <p className="font-medium">{ANCHOR_LABELS[active].title}</p>
          <p className="hint mt-1">{ANCHOR_LABELS[active].hint}</p>
          <p className="hint mt-2 tabular-nums">
            at {activePoint[0].toFixed(0)}, {activePoint[1].toFixed(0)} · arrow keys nudge,
            Shift+arrow moves 10
          </p>
        </div>
      </div>

      <div
        ref={frameRef}
        onKeyDown={onKeyDown}
        tabIndex={0}
        className="relative w-full touch-none overflow-hidden rounded-lg border border-line bg-white outline-none focus:ring-2 focus:ring-brand/30"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Blank OMR sheet" className="block w-full select-none" />

        {showBubbles &&
          questions.map((question) =>
            question.options.map((option) => (
              <span
                key={`${question.q}-${option.option}`}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand/70 bg-brand/10"
                style={{
                  left: `${pct(option.x, 'x')}%`,
                  top: `${pct(option.y, 'y')}%`,
                  width: `${pct(option.r * 2, 'x')}%`,
                  aspectRatio: '1 / 1',
                }}
              />
            )),
          )}

        {ANCHOR_KEYS.map((key) => {
          const point = layout.anchors[key];
          return (
            <button
              key={key}
              type="button"
              onPointerDown={(e) => onPointerDown(e, key)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onFocus={() => setActive(key)}
              aria-label={ANCHOR_LABELS[key].title}
              title={ANCHOR_LABELS[key].title}
              className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-white shadow-md ring-1 ring-black/20 transition active:cursor-grabbing ${
                MARKER_COLOUR[key]
              } ${active === key ? 'scale-125' : ''}`}
              style={{ left: `${pct(point[0], 'x')}%`, top: `${pct(point[1], 'y')}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
