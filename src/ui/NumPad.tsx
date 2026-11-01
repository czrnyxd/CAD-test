import { useEffect, useState } from 'react';

export interface NumPadRequest {
  title: string;
  value: number;
  unit: string;
  min?: number;
  max?: number;
  quick?: number[];
  onOk: (v: number) => void;
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

  const ok = (v = value) => {
    if (!Number.isFinite(v)) return;
    if (req.min !== undefined && v < req.min) return;
    if (req.max !== undefined && v > req.max) return;
    req.onOk(Math.round(v * 100) / 100);
    onClose();
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
    <div className="modal-backdrop">
      <div className="numpad" onPointerDown={(e) => e.stopPropagation()}>
        <div className="numpad-title">{req.title}</div>
        <div className={`numpad-display ${valid ? '' : 'invalid'} ${fresh ? 'fresh' : ''}`}>
          {text || '0'} <span className="unit">{req.unit}</span>
        </div>
        <div className="numpad-range">{range}</div>
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
      </div>
    </div>
  );
}
