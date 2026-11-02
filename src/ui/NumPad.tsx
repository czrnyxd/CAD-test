import { useEffect, useState } from 'react';

export interface NumPadRequest {
  title: string;
  value: number;
  unit: string;
  min?: number;
  max?: number;
  quick?: number[];
  onOk: (v: number) => void;
  /** When set, an "OK i dalej" button saves and opens the next field. */
  onNext?: () => void;
  /** Label of the next field, shown on that button. */
  nextLabel?: string;
  /** Explanatory drawing above the keys. */
  figure?: 'bend-angle';
  /** 'side': on landscape tablets dock the keypad to the right, so the 3D model stays visible. */
  placement?: 'center' | 'side';
}

export function NumPad({ req, onClose }: { req: NumPadRequest; onClose: () => void }) {
  const [text, setText] = useState(String(req.value).replace('.', ','));
  const [fresh, setFresh] = useState(true); // first key press replaces the value

  const value = parseFloat(text.replace(',', '.'));
  const valid =
    Number.isFinite(value) && (req.min === undefined || value >= req.min) && (req.max === undefined || value <= req.max);

  const press = (k: string) => {
    setText((t) => {
      const base = fresh ? '' : t;
      if (k === '⌫') return fresh ? '' : t.slice(0, -1);
      if (k === '±') {
        if (fresh) return '-';
        return t.startsWith('-') ? t.slice(1) : `-${t}`;
      }
      if (k === ',' && base.includes(',')) return base;
      if (k === ',' && (base === '' || base === '-')) return `${base}0,`;
      if (base.replace(',', '').length >= 7) return base;
      return base + k;
    });
    setFresh(false);
  };

  const ok = (v = value, next = false) => {
    if (!Number.isFinite(v)) return;
    if (req.min !== undefined && v < req.min) return;
    if (req.max !== undefined && v > req.max) return;
    req.onOk(Math.round(v * 100) / 100);
    onClose();
    if (next) req.onNext?.();
  };

  // Take focus away from the field that opened the keypad, so Enter does not reopen it.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === ',' || e.key === '.') press(',');
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') {
        e.preventDefault();
        ok();
      } else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const range =
    req.min !== undefined && req.max !== undefined
      ? `zakres ${req.min}–${req.max} ${req.unit}`
      : req.min !== undefined
        ? `min. ${req.min} ${req.unit}`
        : '';

  return (
    // Tapping beside the keypad does not close it (easy to do with gloves); only Cancel / OK / Esc do.
    <div className={`modal-backdrop numpad-backdrop ${req.placement === 'side' ? 'side' : ''}`}>
      <div className="numpad" onPointerDown={(e) => e.stopPropagation()}>
        <div className="numpad-title">{req.title}</div>
        <div className={`numpad-display ${valid ? '' : 'invalid'} ${fresh ? 'fresh' : ''}`}>
          {text || '0'} <span className="unit">{req.unit}</span>
        </div>
        <div className="numpad-range">{range}</div>
        {req.figure === 'bend-angle' && <BendAngleFigure angle={Number.isFinite(value) ? value : 0} />}
        {req.quick && (
          <div className="numpad-quick">
            {req.quick.map((q) => (
              <button key={q} onClick={() => ok(q)}>
                {q}
                {req.unit === '°' ? '°' : ''}
              </button>
            ))}
          </div>
        )}
        <div className="numpad-keys">
          {['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫'].map((k) => (
            <button key={k} onClick={() => press(k)} className={k === '⌫' ? 'key-back' : ''}>
              {k}
            </button>
          ))}
        </div>
        {req.min !== undefined && req.min < 0 && (
          <button className="numpad-sign" onClick={() => press('±')}>
            ± zmień znak
          </button>
        )}
        <div className="numpad-actions">
          <button className="btn-secondary" onClick={onClose}>
            Anuluj
          </button>
          <button className="btn-primary" disabled={!valid} onClick={() => ok()}>
            OK
          </button>
        </div>
        {req.onNext && (
          <button className="btn-primary numpad-next" disabled={!valid} onClick={() => ok(value, true)}>
            OK i dalej › <small>{req.nextLabel}</small>
          </button>
        )}
      </div>
    </div>
  );
}

/** Shows what the bend angle means: how far the bar turns away from straight (0° = straight). */
function BendAngleFigure({ angle }: { angle: number }) {
  const a = Math.max(0, Math.min(179, angle));
  const rad = (a * Math.PI) / 180;
  const cx = 150;
  const cy = 80;
  const L = 110;
  const end = { x: cx + L * Math.cos(rad), y: cy - L * Math.sin(rad) };
  const r = 34;
  const arcEnd = { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  return (
    <figure className="angle-figure">
      <svg viewBox="0 0 300 100" aria-hidden="true">
        <line x1={30} y1={cy} x2={cx} y2={cy} stroke="#c87533" strokeWidth="10" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={cx + L} y2={cy} stroke="#9aa5b1" strokeWidth="2" strokeDasharray="6 5" />
        <line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#c87533" strokeWidth="10" strokeLinecap="round" />
        {a > 0 && (
          <path d={`M${cx + r},${cy} A${r},${r} 0 0 0 ${arcEnd.x},${arcEnd.y}`} fill="none" stroke="#1677ff" strokeWidth="3" />
        )}
        <text x={cx + r + 8} y={cy - 8} className="angle-figure-text">
          {Math.round(a)}°
        </text>
      </svg>
      <figcaption>O ile odchylić szynę od prostej (0° = prosto, 90° = narożnik prosty).</figcaption>
    </figure>
  );
}
