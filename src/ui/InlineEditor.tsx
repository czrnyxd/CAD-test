import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NumPadRequest } from './NumPad';

/** Polish number text: decimal comma, real minus sign. */
const show = (v: number) =>
  String(Math.round(v * 100) / 100)
    .replace('.', ',')
    .replace('-', '−');

/** Element the editor opens over: the value that was clicked, else the main value of the selected step. */
function findAnchor(req: NumPadRequest & { anchor?: HTMLElement | null }): DOMRect | null {
  if (req.anchor?.isConnected) return req.anchor.getBoundingClientRect();
  const el = document.querySelector('.bb-step.is-selected .bb-step-body .bb-chip');
  return el ? el.getBoundingClientRect() : null;
}

/**
 * Mouse and keyboard version of the keypad: a small field opened right over the clicked value.
 * Type the number, Enter saves (and moves to the next field when there is one), Esc cancels,
 * clicking elsewhere saves.
 */
export function InlineEditor({ req, onClose }: { req: NumPadRequest & { anchor?: HTMLElement | null }; onClose: () => void }) {
  const [text, setText] = useState(show(req.value));
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const value = parseFloat(text.trim().replace(',', '.').replace('−', '-'));
  const tooLow = req.min !== undefined && value < req.min;
  const tooHigh = req.max !== undefined && value > req.max;
  const valid = Number.isFinite(value) && !tooLow && !tooHigh;
  const unit = req.unit === '°' ? '°' : req.unit;

  // Place over the anchor (input over the value), kept inside the window.
  useLayoutEffect(() => {
    const place = () => {
      const r = findAnchor(req);
      const card = cardRef.current;
      const w = Math.max(300, r?.width ?? 0);
      const h = card?.offsetHeight ?? 200;
      let left = r ? r.left - 10 : (window.innerWidth - w) / 2;
      let top = r ? r.top - 10 : window.innerHeight / 3;
      left = Math.max(8, Math.min(window.innerWidth - w - 28, left));
      top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
      setPos({ left, top, width: w });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [req]);

  // Focus once the card is placed (a hidden field cannot take the focus).
  const placed = pos !== null;
  useLayoutEffect(() => {
    if (!placed) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [placed]);

  const ok = (v: number, next: boolean) => {
    if (!Number.isFinite(v)) return false;
    if (req.min !== undefined && v < req.min) return false;
    if (req.max !== undefined && v > req.max) return false;
    req.onOk(Math.round(v * 100) / 100);
    onClose();
    if (next) req.onNext?.();
    return true;
  };

  // A click outside saves a valid value (like leaving a cell in a spreadsheet), otherwise cancels.
  const latest = useRef({ value, valid, changed: false });
  latest.current = { value, valid, changed: text !== show(req.value) };
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      const l = latest.current;
      if (l.changed && l.valid) ok(l.value, false);
      else onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  const range =
    req.min !== undefined && req.max !== undefined
      ? `${show(req.min)}–${show(req.max)}${unit === '°' ? '°' : ` ${unit}`}`
      : req.min !== undefined
        ? `min. ${show(req.min)}${unit === '°' ? '°' : ` ${unit}`}`
        : '';

  return (
    <div
      ref={cardRef}
      className="ie-card"
      role="dialog"
      aria-label={req.title}
      style={pos ? { left: pos.left, top: pos.top, width: pos.width + 20 } : { visibility: 'hidden' }}
    >
      <div className={`ie-field ${!valid ? 'is-bad' : ''}`}>
        <input
          ref={inputRef}
          className="ie-input"
          inputMode="decimal"
          aria-label={req.title}
          aria-invalid={!valid}
          value={text}
          onChange={(e) => setText(e.target.value.replace('.', ','))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
              e.preventDefault();
              ok(value, e.key === 'Tab' || !e.shiftKey);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              // Arrows step the value (Shift: by 10).
              e.preventDefault();
              const stepBy = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
              const base = Number.isFinite(value) ? value : req.value;
              let v = Math.round((base + stepBy) * 100) / 100;
              if (req.min !== undefined) v = Math.max(req.min, v);
              if (req.max !== undefined) v = Math.min(req.max, v);
              setText(show(v));
            }
          }}
        />
        <span className="ie-unit">{unit}</span>
      </div>
      <div className="ie-title">{req.title}</div>
      {req.quick && (
        <div className="ie-quick">
          {req.quick.map((q) => (
            <button
              key={q}
              type="button"
              className={`ie-q ${value === q ? 'is-selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ok(q, false)}
            >
              {show(q)}
              {unit === '°' ? '°' : ''}
            </button>
          ))}
        </div>
      )}
      <div className={`ie-hint ${!valid ? 'is-bad' : ''}`}>
        {!Number.isFinite(value) ? (
          'Wpisz liczbę'
        ) : tooLow || tooHigh ? (
          `Poza zakresem ${range}`
        ) : (
          <>
            <kbd>Enter</kbd> {req.onNext ? `zapisz i dalej: ${req.nextLabel}` : 'zapisz'} · <kbd>Esc</kbd> anuluj
            {range && <span className="ie-range"> · {range}</span>}
          </>
        )}
      </div>
    </div>
  );
}
