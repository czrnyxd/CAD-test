import { useId } from 'react';
import { ORIENTATION_LABEL, bendOrientations, fmt, type Analysis } from '../core/analyze';
import { DIRECTION_ARROW, DIRECTION_LABEL, type Busbar, type MachineSettings } from '../core/model';

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
  const height = yTotal + 40;

  return (
    <svg className="flat-svg" viewBox={`0 0 ${width} ${height}`} width="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id={arrowId} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#222" />
        </marker>
      </defs>

      {/* bar */}
      <rect x={X(0)} y={yBarTop} width={L * scale} height={barH} fill="#f3d2b3" stroke="#6b3d16" strokeWidth="1.5" />

      {/* bend zones and lines */}
      {bends.map((b) => (
        <g key={`b${b.no}`}>
          <rect
            x={X(b.arcStart)}
            y={yBarTop}
            width={Math.max(1, b.bendAllowance * scale)}
            height={barH}
            fill="#f0a35e"
            opacity="0.55"
          />
          <line
            x1={X(b.position)}
            y1={yBarTop - 6}
            x2={X(b.position)}
            y2={yBarBot + 6}
            stroke="#c0392b"
            strokeWidth="1.6"
            strokeDasharray="6 4"
          />
          <circle cx={X(b.position)} cy={40} r={11} fill="#c0392b" />
          <text x={X(b.position)} y={44.5} textAnchor="middle" className="t-badge">
            {b.no}
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
              <rect
                x={cx - rx}
                y={cy - ry}
                width={2 * rx}
                height={2 * ry}
                rx={ry}
                fill="#fff"
                stroke="#24150a"
                strokeWidth="1.4"
              />
            ) : (
              <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="#24150a" strokeWidth="1.4" />
            )}
            <line x1={cx - rx - 4} y1={cy} x2={cx + rx + 4} y2={cy} stroke="#24150a" strokeWidth="0.6" />
            <line x1={cx} y1={cy - ry - 4} x2={cx} y2={cy + ry + 4} stroke="#24150a" strokeWidth="0.6" />
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

      <text x={width - mR} y={height - 6} textAnchor="end" className="t-small">
        Widok na górną stronę szyny (↑ = gięcie w stronę patrzącego) · linie gięcia: {REF_LABEL[settings.bendLineReference]} ·
        wymiary w mm · rysunek nie w skali
      </text>
    </svg>
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
      <line x1={x1} y1={y + (y > yFrom ? -14 : 14)} x2={x1} y2={y + (y > yFrom ? 5 : -5)} stroke="#777" strokeWidth="0.8" />
      <line
        x1={x2}
        y1={yFrom}
        x2={x2}
        y2={y + (y > yFrom ? 5 : -5)}
        stroke="#777"
        strokeWidth="0.8"
        strokeDasharray={hole ? '3 3' : undefined}
      />
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke="#222"
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

export function BendTable({ analysis, settings }: { analysis: Analysis; settings: MachineSettings }) {
  if (!analysis.bends.length) return <p className="muted">Brak gięć – szyna prosta.</p>;
  const orient = bendOrientations(analysis.bends);
  const note = (
    <>
      Szynę wkładaj <b>końcem A do zderzaka</b>. Pozycja = {REF_LABEL[settings.bendLineReference]}, mierzona od końca A (zielony).
      Przed gięciem w przeciwną stronę niż poprzednie – obróć szynę. Nastawa uwzględnia sprężynowanie.
    </>
  );
  return (
    <>
      <table className="bend-table">
        <thead>
          <tr>
            <th>Nr</th>
            <th>Pozycja od A [mm]</th>
            <th>Kierunek</th>
            <th>Ułożenie szyny</th>
            <th>Kąt</th>
            <th>Nastawa maszyny</th>
            <th>R [mm]</th>
            <th>Strefa gięcia [mm]</th>
          </tr>
        </thead>
        <tbody>
          {analysis.bends.map((b, k) => (
            <tr key={b.no}>
              <td className="num-badge">{b.no}</td>
              <td className="big">{fmt(b.position)}</td>
              <td>
                <span className="arrow">{DIRECTION_ARROW[b.direction]}</span> {DIRECTION_LABEL[b.direction]}
              </td>
              <td className={`orient orient-${orient[k]}`}>{ORIENTATION_LABEL[orient[k]]}</td>
              <td>{fmt(b.angle)}°</td>
              <td className="big">{fmt(b.machineAngle)}°</td>
              <td>{fmt(b.radius)}</td>
              <td>
                {fmt(b.arcStart)} – {fmt(b.arcEnd)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={8} className="muted">
              {note}
            </td>
          </tr>
        </tfoot>
      </table>
      {/* Narrow screens: one card per bend instead of the wide table. */}
      <div className="bend-cards">
        {analysis.bends.map((b, k) => (
          <div className="bend-card" key={b.no}>
            <div className="bend-card-head">
              <span className="num-badge">{b.no}</span>
              <span className="bend-card-pos">{fmt(b.position)} mm</span>
              <span className="arrow">{DIRECTION_ARROW[b.direction]}</span>
            </div>
            <div className="bend-card-row">
              <span>Nastawa</span>
              <b>{fmt(b.machineAngle)}°</b>
            </div>
            <div className="bend-card-row">
              <span>Kąt / kierunek</span>
              <span>
                {fmt(b.angle)}° {DIRECTION_LABEL[b.direction]}
              </span>
            </div>
            <div className={`bend-card-row orient-${orient[k]}`}>
              <span>Ułożenie</span>
              <span>{ORIENTATION_LABEL[orient[k]]}</span>
            </div>
          </div>
        ))}
        <p className="muted">{note}</p>
      </div>
    </>
  );
}

export function HoleTable({ bar, analysis }: { bar: Busbar; analysis: Analysis }) {
  if (!analysis.holes.length) return null;
  const W = bar.section.width;
  return (
    <table className="bend-table hole-table">
      <thead>
        <tr>
          <th>Nr</th>
          <th>Pozycja od A [mm]</th>
          <th>Od górnej krawędzi [mm]</th>
          <th>Otwór</th>
        </tr>
      </thead>
      <tbody>
        {analysis.holes.map((h) => (
          <tr key={h.no}>
            <td className="num-badge hole">O{h.no}</td>
            <td className="big">{fmt(h.flatPos)}</td>
            <td>{fmt(W / 2 + h.offset)}</td>
            <td>{h.length > h.diameter ? `fasolka ${fmt(h.diameter)} × ${fmt(h.length)}` : `Ø ${fmt(h.diameter)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
