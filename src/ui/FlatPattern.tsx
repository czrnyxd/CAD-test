import { useId } from 'react';
import { ORIENTATION_LABEL, bendOrientations, fmt, type Analysis, type BendOrientation } from '../core/analyze';
import { DIRECTION_ARROW, DIRECTION_LABEL, type Busbar, type Direction, type MachineSettings } from '../core/model';
import { Icon } from './Icon';

const REF_LABEL = { start: 'początek łuku', center: 'środek łuku', end: 'koniec łuku' } as const;

interface Props {
  bar: Busbar;
  analysis: Analysis;
  settings: MachineSettings;
  /** Width of the drawing in px (SVG user units). */
  width?: number;
}

export function FlatPatternSvg({ bar, analysis, settings, width = 1100 }: Props) {
  // Each drawing needs its own marker id: a hidden copy (e.g. the print sheet) must not hide the arrows of another.
  const arrowId = `arr-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const L = Math.max(analysis.flatLength, 1);
  const W = bar.section.width;
  const mL = 70;
  const mR = 50;
  const scale = (width - mL - mR) / L;
  const X = (mm: number) => mL + mm * scale;
  const barH = Math.min(90, Math.max(30, W * scale));

  const { bends, holes } = analysis;
  const labelRows = 2;
  const yBarTop = 40 + labelRows * 22 + 46;
  const yBarBot = yBarTop + barH;
  const yChain = yBarTop - 22;
  const Y = (acrossMm: number) => yBarTop + (acrossMm / W) * barH; // 0 = upper edge of the drawing
  const holeScale = Math.min(scale, barH / W);

  // Positions for chain dimensions: ends and bend lines.
  const marks = [0, ...bends.map((b) => b.position), L].sort((a, b) => a - b);
  const chain = marks
    .slice(1)
    .map((m, k) => [marks[k], m] as const)
    .filter(([a, b]) => b - a > 0.05);

  const baseRows = bends.length + holes.length;
  const yBase0 = yBarBot + 34;
  const rowH = 24;
  const yTotal = yBase0 + baseRows * rowH + 10;
  const height = yTotal + 16;

  return (
    <figure className="drawing">
      <svg className="flat-svg" viewBox={`0 0 ${width} ${height}`} width="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* bar */}
        <rect x={X(0)} y={yBarTop} width={L * scale} height={barH} className="bb-bar2d" />

        {/* bend zones and lines */}
        {bends.map((b) => (
          <g key={`b${b.no}`}>
            <rect x={X(b.arcStart)} y={yBarTop} width={Math.max(1, b.bendAllowance * scale)} height={barH} className="bb-zone" />
            <line x1={X(b.position)} y1={yBarTop - 6} x2={X(b.position)} y2={yBarBot + 6} className="bb-bendline" />
            <rect x={X(b.position) - 16} y={28} width={32} height={24} rx={5} className="flat-badge" />
            <text x={X(b.position)} y={44.5} textAnchor="middle" className="t-badge">
              G{b.no}
            </text>
            <text x={X(b.position)} y={40 + 26} textAnchor="middle" className="t-bend">
              {fmt(b.angle)}° {DIRECTION_ARROW[b.direction]}
            </text>
            <text x={X(b.position)} y={40 + 44} textAnchor="middle" className="t-small">
              R{fmt(b.radius)}
            </text>
          </g>
        ))}

        {/* holes */}
        {holes.map((h) => {
          const cx = X(h.flatPos);
          const cy = Y(W / 2 + h.offset);
          // The drawing is not to scale (length and width use different scales), so the hole symbol
          // uses one common scale: round holes stay circles, slots keep their length/width ratio.
          const r = Math.max(4, (h.diameter / 2) * holeScale);
          const rx = h.length > h.diameter ? r * (h.length / h.diameter) : r;
          const ry = r;
          return (
            <g key={`h${h.no}`}>
              {rx > ry ? (
                <rect x={cx - rx} y={cy - ry} width={2 * rx} height={2 * ry} rx={ry} className="bb-hole2d" />
              ) : (
                <circle cx={cx} cy={cy} r={r} className="bb-hole2d" />
              )}
              <line x1={cx - rx - 4} y1={cy} x2={cx + rx + 4} y2={cy} className="bb-holecross" />
              <line x1={cx} y1={cy - ry - 4} x2={cx} y2={cy + ry + 4} className="bb-holecross" />
              <text x={cx + rx + 3} y={cy - ry - 2} className="t-hole">
                O{h.no}
              </text>
            </g>
          );
        })}

        {/* start marker */}
        <text x={X(0) - 14} y={yBarTop + barH / 2 + 7} textAnchor="end" className="t-start">
          A
        </text>

        {/* chain dimensions */}
        {chain.map(([a, b], k) => (
          <Dim arrowId={arrowId} key={`c${k}`} x1={X(a)} x2={X(b)} y={yChain} yFrom={yBarTop} text={fmt(b - a)} />
        ))}

        {/* baseline dimensions from start */}
        {bends.map((b, k) => (
          <Dim
            arrowId={arrowId}
            key={`d${k}`}
            x1={X(0)}
            x2={X(b.position)}
            y={yBase0 + k * rowH}
            yFrom={yBarBot}
            text={`${fmt(b.position)}  (${b.no})`}
          />
        ))}

        {/* hole positions from start */}
        {holes.map((h, k) => (
          <Dim
            arrowId={arrowId}
            key={`hd${k}`}
            x1={X(0)}
            x2={X(h.flatPos)}
            y={yBase0 + (bends.length + k) * rowH}
            yFrom={Y(W / 2 + h.offset)}
            text={`${fmt(h.flatPos)}  (O${h.no})`}
            hole
          />
        ))}

        {/* total length */}
        <Dim arrowId={arrowId} x1={X(0)} x2={X(L)} y={yTotal} yFrom={yBarBot} text={`L = ${fmt(L)} mm`} bold />
      </svg>
      <figcaption className="drawing-note">
        Widok na górną stronę szyny (↑ = gięcie w stronę patrzącego) · linie gięcia: {REF_LABEL[settings.bendLineReference]} ·
        wymiary w mm · rysunek nie w skali
      </figcaption>
    </figure>
  );
}

function Dim({
  arrowId,
  x1,
  x2,
  y,
  yFrom,
  text,
  bold,
  hole,
}: {
  arrowId: string;
  x1: number;
  x2: number;
  y: number;
  yFrom: number;
  text: string;
  bold?: boolean;
  hole?: boolean;
}) {
  const short = x2 - x1 < 46;
  return (
    <g className={hole ? 'dim dim-hole' : 'dim'}>
      <line x1={x1} y1={y + (y > yFrom ? -14 : 14)} x2={x1} y2={y + (y > yFrom ? 5 : -5)} stroke="#505c68" strokeWidth="0.8" />
      <line
        x1={x2}
        y1={yFrom}
        x2={x2}
        y2={y + (y > yFrom ? 5 : -5)}
        stroke="#505c68"
        strokeWidth="0.8"
        strokeDasharray={hole ? '3 3' : undefined}
      />
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke="#12171d"
        strokeWidth="1"
        markerStart={`url(#${arrowId})`}
        markerEnd={`url(#${arrowId})`}
      />
      <text
        x={short ? x2 + 4 : (x1 + x2) / 2}
        y={y - 4}
        textAnchor={short ? 'start' : 'middle'}
        className={bold ? 't-dim t-bold' : 't-dim'}
      >
        {text}
      </text>
    </g>
  );
}

export function BendTable({ analysis, settings, print }: { analysis: Analysis; settings: MachineSettings; print?: boolean }) {
  if (!analysis.bends.length) return <p className="bb-td-empty">Brak gięć – szyna prosta.</p>;
  const orient = bendOrientations(analysis.bends);
  const note = (
    <>
      Szynę wkładaj <b>końcem A do zderzaka</b>. Pozycja = {REF_LABEL[settings.bendLineReference]}, od końca A. Przed gięciem w
      przeciwną stronę niż poprzednie obróć szynę. Nastawa uwzględnia sprężynowanie.
    </>
  );
  return (
    <>
      <div className="table-scroll bend-table-wrap">
        <table className={`bb-table bend-table ${print ? 'bb-table--print' : ''}`}>
          <thead>
            <tr>
              <th>Nr</th>
              <th className="is-key">Pozycja od A</th>
              <th>Kierunek</th>
              <th>Ułożenie szyny</th>
              <th>Kąt</th>
              <th className="is-key">Nastawa</th>
              <th>R</th>
              <th>Strefa gięcia</th>
            </tr>
          </thead>
          <tbody>
            {analysis.bends.map((b, k) => (
              <tr key={b.no}>
                <td className="bb-td-nr">G{b.no}</td>
                <td className="is-key">
                  {fmt(b.position)}
                  <span className="bb-unit"> mm</span>
                </td>
                <td>
                  <DirCell dir={b.direction} />
                </td>
                <td>
                  <LayCell lay={orient[k]} />
                </td>
                <td>{fmt(b.angle)}°</td>
                <td className="is-key">{fmt(b.machineAngle)}°</td>
                <td>{fmt(b.radius)}</td>
                <td>
                  {fmt(b.arcStart, 0)}–{fmt(b.arcEnd, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Narrow screens: one card per bend instead of the wide table. */}
      <div className="bend-cards">
        {analysis.bends.map((b, k) => (
          <section className="bb-mcard" key={b.no}>
            <div className="bb-mcard-head">
              <span className="bb-step-badge">G{b.no}</span>
              <DirCell dir={b.direction} />
              <LayCell lay={orient[k]} />
            </div>
            <div className="bb-mcard-main">
              <div className="bb-tile bb-tile--big">
                <span className="bb-tile-label">Pozycja od A</span>
                <span className="bb-tile-value">
                  {fmt(b.position, 0)}
                  <span className="bb-unit"> mm</span>
                </span>
              </div>
              <div className="bb-tile bb-tile--big">
                <span className="bb-tile-label">Nastawa</span>
                <span className="bb-tile-value">{fmt(b.machineAngle)}°</span>
              </div>
            </div>
            <div className="bb-mcard-meta">
              <span>
                Kąt <b>{fmt(b.angle)}°</b>
              </span>
              <span>
                R <b>{fmt(b.radius)}</b>
              </span>
              <span>
                Strefa{' '}
                <b>
                  {fmt(b.arcStart, 0)}–{fmt(b.arcEnd, 0)}
                </b>
              </span>
            </div>
          </section>
        ))}
      </div>
      <p className="table-note">{note}</p>
    </>
  );
}

function DirCell({ dir }: { dir: Direction }) {
  return (
    <span className="bb-dir">
      <Icon name={dir} size={22} />
      {DIRECTION_LABEL[dir]}
    </span>
  );
}

function LayCell({ lay }: { lay: BendOrientation }) {
  return (
    <span className={`bb-lay ${lay === 'flip' ? 'bb-lay--flip' : ''}`}>
      {lay === 'flip' && <Icon name="rotate" size={22} />}
      {ORIENTATION_LABEL[lay]}
    </span>
  );
}

export function HoleTable({ bar, analysis, print }: { bar: Busbar; analysis: Analysis; print?: boolean }) {
  if (!analysis.holes.length) return <p className="bb-td-empty">Brak otworów.</p>;
  const W = bar.section.width;
  return (
    <div className="table-scroll">
      <table className={`bb-table hole-table ${print ? 'bb-table--print' : ''}`}>
        <thead>
          <tr>
            <th>Nr</th>
            <th className="is-key">Od A</th>
            <th>Od górnej krawędzi</th>
            <th>Otwór</th>
          </tr>
        </thead>
        <tbody>
          {analysis.holes.map((h) => (
            <tr key={h.no}>
              <td className="bb-td-nr">O{h.no}</td>
              <td className="is-key">
                {fmt(h.flatPos)}
                <span className="bb-unit"> mm</span>
              </td>
              <td>{fmt(W / 2 + h.offset)} mm</td>
              <td>{h.length > h.diameter ? `fasolka ${fmt(h.diameter)}×${fmt(h.length)}` : `Ø${fmt(h.diameter)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
