import { useState } from 'react';
import { fmt } from '../core/analyze';
import { SECTION_LIMITS, sectionError, type Section } from '../core/model';
import type { NumPadRequest } from './NumPad';

/** "Inny przekrój": enter width and thickness of a section that is not on the list. */
export function SectionDialog({
  initial,
  numpad,
  onClose,
  onOk,
}: {
  initial: Section;
  numpad: (req: NumPadRequest) => void;
  onClose: () => void;
  onOk: (s: Section) => void;
}) {
  const [width, setWidth] = useState(initial.width);
  const [thickness, setThickness] = useState(initial.thickness);
  const error = sectionError(width, thickness);

  // Section drawn to scale inside a fixed box.
  const box = 220;
  const k = Math.min((box - 20) / width, 90 / thickness);
  const w = width * k;
  const t = Math.max(2, thickness * k);

  return (
    <div className="modal-backdrop">
      <div className="modal section-dialog">
        <h2>Inny przekrój</h2>
        <div className="section-dialog-body">
          <div className="fields">
            <button
              className="field"
              onClick={() =>
                numpad({
                  title: 'Szerokość szyny',
                  value: width,
                  unit: 'mm',
                  min: SECTION_LIMITS.width[0],
                  max: SECTION_LIMITS.width[1],
                  quick: [63, 75, 90, 125, 150, 160, 200],
                  onOk: setWidth,
                })
              }
            >
              <span className="field-label">Szerokość</span>
              <span className="field-value">{fmt(width)} mm</span>
            </button>
            <button
              className="field"
              onClick={() =>
                numpad({
                  title: 'Grubość szyny',
                  value: thickness,
                  unit: 'mm',
                  min: SECTION_LIMITS.thickness[0],
                  max: SECTION_LIMITS.thickness[1],
                  quick: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20],
                  onOk: setThickness,
                })
              }
            >
              <span className="field-label">Grubość</span>
              <span className="field-value">{fmt(thickness)} mm</span>
            </button>
          </div>
          <figure className="section-preview">
            <svg viewBox={`0 0 ${box} 110`} aria-hidden="true">
              <rect x={(box - w) / 2} y={(110 - t) / 2} width={w} height={t} fill="#e7b48a" stroke="#6b3d16" strokeWidth="1.5" />
            </svg>
            <figcaption>
              Cu {fmt(width)}×{fmt(thickness)}
            </figcaption>
          </figure>
        </div>
        {error && <div className="section-error">⛔ {error}</div>}
        <p className="muted">
          Przekrój zostanie zapamiętany na liście. Promień, K i sprężynowanie z Ustawień dotyczą też tego przekroju – przy nowej
          grubości warto je sprawdzić na próbce.
        </p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Anuluj
          </button>
          <button className="btn-primary" disabled={!!error} onClick={() => onOk({ width, thickness, material: 'Cu' })}>
            Użyj przekroju
          </button>
        </div>
      </div>
    </div>
  );
}
