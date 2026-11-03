import { useState } from 'react';
import { fmt } from '../core/analyze';
import { SECTION_LIMITS, sectionError, type Section } from '../core/model';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import type { NumPadRequest } from './NumPad';
import { Chip, Notice } from './controls';

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
    <Dialog
      title="Inny przekrój"
      width={640}
      onClose={onClose}
      footer={
        <>
          <span className="bb-spacer" />
          <button
            className="bb-btn bb-btn--primary bb-btn--lg bb-wide"
            disabled={!!error}
            onClick={() => onOk({ width, thickness, material: 'Cu' })}
          >
            <Icon name="check" />
            Użyj przekroju
          </button>
        </>
      }
    >
      <div className="bb-other">
        <Chip
          label="Szerokość"
          value={fmt(width)}
          unit="mm"
          className="bb-grow"
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
        />
        <span className="bb-times">×</span>
        <Chip
          label="Grubość"
          value={fmt(thickness)}
          unit="mm"
          state={error ? 'error' : undefined}
          className="bb-grow"
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
        />
      </div>
      <figure className="section-preview">
        <svg viewBox={`0 0 ${box} 110`} aria-hidden="true">
          <rect x={(box - w) / 2} y={(110 - t) / 2} width={w} height={t} className="bb-bar2d" />
        </svg>
        <figcaption>
          Cu {fmt(width)}×{fmt(thickness)}
        </figcaption>
      </figure>
      {error && <Notice tone="danger">{error}</Notice>}
      <p className="bb-p">
        Przekrój zostanie zapamiętany na liście. Promień, K i sprężynowanie z Ustawień dotyczą też tego przekroju, więc przy nowej
        grubości sprawdź je na próbce.
      </p>
    </Dialog>
  );
}
