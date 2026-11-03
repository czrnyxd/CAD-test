import { useEffect, useState } from 'react';
import { Icon } from './Icon';

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
  /** Explanatory drawing next to the value. */
  figure?: 'bend-angle';
  /** 'side': on landscape tablets the keypad takes the place of the step panel, so the 3D model stays visible. */
  placement?: 'center' | 'side';
}

/** Polish number text: decimal comma, real minus sign. */
const show = (v: number) => String(v).replace('.', ',').replace('-', '−');
const fmtLimit = (v: number) => show(Math.round(v * 100) / 100);

export function NumPad({ req, onClose }: { req: NumPadRequest; onClose: () => void }) {
  const [text, setText] = useState(show(req.value));
  const [fresh, setFresh] = useState(true); // first key press replaces the value

  const value = parseFloat(text.replace(',', '.').replace('−', '-'));
  const valid =
    Number.isFinite(value) && (req.min === undefined || value >= req.min) && (req.max === undefined || value <= req.max);
  const signed = req.min !== undefined && req.min < 0;

  const press = (k: string) => {
    setText((t) => {
      const base = fresh ? '' : t;
      if (k === '⌫') return fresh ? '' : t.slice(0, -1);
      if (k === '±') {
        if (fresh) return '−';
        return t.startsWith('−') ? t.slice(1) : `−${t}`;
      }
      if (k === ',' && base.includes(',')) return base;
      if (k === ',' && (base === '' || base === '−')) return `${base}0,`;
      if (base.replace(/[,−]/g, '').length >= 7) return base;
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
      else if (e.key === '-' && signed) press('±');
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') {
        e.preventDefault();
        ok();
      } else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const unit = req.unit === '°' ? '°' : req.unit ? ` ${req.unit}` : '';
  const range =
    req.min !== undefined && req.max !== undefined
      ? `Zakres ${fmtLimit(req.min)}–${fmtLimit(req.max)}${unit}`
      : req.min !== undefined
        ? `Minimum ${fmtLimit(req.min)}${unit}`
        : '';
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ...(signed ? ['±', '0', ','] : [',', '0', '⌫'])];

  return (
    // Tapping beside the keypad does not close it (easy to do with gloves); only Anuluj / OK / Esc do.
    <div className={`numpad-backdrop ${req.placement === 'side' ? 'side' : ''}`}>
      <aside className="bb-keypad numpad" aria-label={req.title} onPointerDown={(e) => e.stopPropagation()}>
        <div className="bb-kp-title">{req.title}</div>
        <div className={`bb-kp-display ${!valid && !fresh ? 'is-bad' : ''} ${fresh ? 'is-fresh' : ''}`}>
          <div className="bb-kp-readout">
            <span className="bb-kp-value">
              {text || ' '}
              <span className="bb-kp-unit">{unit}</span>
            </span>
            <span className="bb-kp-range">{range}</span>
          </div>
          {req.figure === 'bend-angle' && <AngleSketch angle={Number.isFinite(value) ? value : 0} />}
        </div>
        {req.quick && (
          <div className="bb-kp-quick">
            {req.quick.map((q) => (
              <button key={q} type="button" className={`bb-kp-q ${value === q ? 'is-selected' : ''}`} onClick={() => ok(q)}>
                {show(q)}
                {req.unit === '°' ? '°' : ''}
              </button>
            ))}
          </div>
        )}
        <div className="bb-kp-keys">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className={`bb-key ${k === '⌫' || k === '±' ? 'bb-key--fn' : ''}`}
              aria-label={k === '⌫' ? 'Usuń cyfrę' : k === '±' ? 'Zmień znak' : undefined}
            >
              {k === '⌫' ? <Icon name="back" size={28} /> : k}
            </button>
          ))}
        </div>
        {signed && (
          <button type="button" className="bb-key bb-key--fn bb-key--wide" onClick={() => press('⌫')}>
            <Icon name="back" size={28} />
            Usuń cyfrę
          </button>
        )}
        <div className="bb-kp-actions">
          <button type="button" className="bb-btn bb-btn--secondary bb-btn--lg bb-kp-cancel" onClick={onClose}>
            Anuluj
          </button>
          <button
            type="button"
            className={`bb-btn bb-btn--${req.onNext ? 'secondary' : 'primary'} bb-btn--lg bb-grow`}
            disabled={!valid}
            onClick={() => ok()}
          >
            OK
          </button>
        </div>
        {req.onNext && (
          <button
            type="button"
            className="bb-btn bb-btn--primary bb-btn--lg bb-btn--block numpad-next"
            disabled={!valid}
            onClick={() => ok(value, true)}
          >
            OK i dalej
            <Icon name="next" />
            <span className="bb-kp-next">{req.nextLabel}</span>
          </button>
        )}
      </aside>
    </div>
  );
}

/** Shows what the bend angle means: how far the bar turns away from straight (0° = straight). */
function AngleSketch({ angle }: { angle: number }) {
  const a = (Math.max(0, Math.min(170, angle)) * Math.PI) / 180;
  const S = 88;
  const r = S * 0.62;
  const ox = S * 0.14;
  const oy = S * 0.72;
  const ax = ox + S * 0.4;
  const x2 = ax + Math.cos(a) * r * 0.75;
  const y2 = oy - Math.sin(a) * r * 0.75;
  const rr = S * 0.2;
  return (
    <svg
      className="bb-svg angle-sketch"
      width={S}
      height={S}
      viewBox={`0 0 ${S} ${S}`}
      aria-label="O ile odchylić szynę od prostej"
    >
      <line className="bb-sk-ghost" x1={ax} y1={oy} x2={S - 2} y2={oy} />
      {angle > 0 && (
        <path className="bb-sk-arc" d={`M${ax + rr} ${oy}A${rr} ${rr} 0 0 0 ${ax + Math.cos(a) * rr} ${oy - Math.sin(a) * rr}`} />
      )}
      <path className="bb-sk-bar" d={`M${ox} ${oy}L${ax} ${oy}L${x2} ${y2}`} />
    </svg>
  );
}
