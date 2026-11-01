import { fmt, type Analysis } from '../core/analyze';
import { DIRECTION_ARROW, DIRECTION_LABEL, PLANE_LABEL, type Busbar, type MachineSettings } from '../core/model';

const REF_LABEL = { start: 'początek łuku', center: 'środek łuku', end: 'koniec łuku' } as const;

interface Props {
  bar: Busbar;
  analysis: Analysis;
  settings: MachineSettings;
  /** Width of the drawing in px (SVG user units). */
  width?: number;
}

export function FlatPatternSvg({ bar, analysis, settings, width = 1100 }: Props) {
  const L = Math.max(analysis.flatLength, 1);
  const W = bar.section.width;
  const mL = 70;
  const mR = 50;
  const scale = (width - mL - mR) / L;
  const X = (mm: number) => mL + mm * scale;
  const barH = Math.min(90, Math.max(30, W * scale));

  const { bends, twists } = analysis;
  const labelRows = 2;
  const yBarTop = 40 + labelRows * 22 + 46;
  const yBarBot = yBarTop + barH;
  const yChain = yBarTop - 22;

  // Positions for chain dimensions: ends, bend lines, twist zones.
  const marks = [0, ...bends.map((b) => b.position), ...twists.flatMap((t) => [t.start, t.end]), L].sort((a, b) => a - b);
  const chain = marks.slice(1).map((m, k) => [marks[k], m] as const).filter(([a, b]) => b - a > 0.05);

  const baseRows = bends.length;
  const yBase0 = yBarBot + 34;
  const rowH = 24;
  const yTotal = yBase0 + baseRows * rowH + 10;
  const height = yTotal + 40;

  return (
    <svg className="flat-svg" viewBox={`0 0 ${width} ${height}`} width="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#7a5cc2" strokeWidth="2" />
        </pattern>
        <marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#222" />
        </marker>
      </defs>

      {/* bar */}
      <rect x={X(0)} y={yBarTop} width={L * scale} height={barH} fill="#f3d2b3" stroke="#6b3d16" strokeWidth="1.5" />

      {/* twist zones */}
      {twists.map((t) => (
        <g key={`t${t.no}`}>
          <rect x={X(t.start)} y={yBarTop} width={(t.end - t.start) * scale} height={barH} fill="url(#hatch)" opacity="0.6" />
          <text x={X((t.start + t.end) / 2)} y={yBarTop + barH / 2 + 5} textAnchor="middle" className="t-small" fill="#4b2f99">
            skręt {fmt(t.angle)}°
          </text>
        </g>
      ))}

      {/* bend zones and lines */}
      {bends.map((b) => (
        <g key={`b${b.no}`}>
          <rect
            x={X(b.arcStart)}
            y={yBarTop}
            width={Math.max(1, b.bendAllowance * scale)}
            height={barH}
            fill={b.plane === 'flat' ? '#f0a35e' : '#7fb3e6'}
            opacity="0.55"
          />
          <line x1={X(b.position)} y1={yBarTop - 6} x2={X(b.position)} y2={yBarBot + 6} stroke="#c0392b" strokeWidth="1.6" strokeDasharray="6 4" />
          <circle cx={X(b.position)} cy={40} r={11} fill="#c0392b" />
          <text x={X(b.position)} y={44.5} textAnchor="middle" className="t-badge">
            {b.no}
          </text>
          <text x={X(b.position)} y={40 + 26} textAnchor="middle" className="t-bend">
            {fmt(b.angle)}° {DIRECTION_ARROW[b.direction]}
          </text>
          <text x={X(b.position)} y={40 + 44} textAnchor="middle" className="t-small">
            {b.plane === 'flat' ? 'płaskie' : 'kant'} R{fmt(b.radius)}
          </text>
        </g>
      ))}

      {/* start marker */}
      <text x={X(0) - 14} y={yBarTop + barH / 2 + 7} textAnchor="end" className="t-start">
        A
      </text>

      {/* chain dimensions */}
      {chain.map(([a, b], k) => (
        <Dim key={`c${k}`} x1={X(a)} x2={X(b)} y={yChain} yFrom={yBarTop} text={fmt(b - a)} />
      ))}

      {/* baseline dimensions from start */}
      {bends.map((b, k) => (
        <Dim key={`d${k}`} x1={X(0)} x2={X(b.position)} y={yBase0 + k * rowH} yFrom={yBarBot} text={`${fmt(b.position)}  (${b.no})`} />
      ))}

      {/* total length */}
      <Dim x1={X(0)} x2={X(L)} y={yTotal} yFrom={yBarBot} text={`L = ${fmt(L)} mm`} bold />

      <text x={width - mR} y={height - 6} textAnchor="end" className="t-small">
        Linie gięcia: {REF_LABEL[settings.bendLineReference]} · wymiary w mm · rysunek poglądowy, nie w skali
      </text>
    </svg>
  );
}

function Dim({ x1, x2, y, yFrom, text, bold }: { x1: number; x2: number; y: number; yFrom: number; text: string; bold?: boolean }) {
  const short = x2 - x1 < 46;
  return (
    <g className="dim">
      <line x1={x1} y1={yFrom} x2={x1} y2={y + (y > yFrom ? 5 : -5)} stroke="#777" strokeWidth="0.8" />
      <line x1={x2} y1={yFrom} x2={x2} y2={y + (y > yFrom ? 5 : -5)} stroke="#777" strokeWidth="0.8" />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="#222" strokeWidth="1" markerStart="url(#arr)" markerEnd="url(#arr)" />
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
  if (!analysis.bends.length && !analysis.twists.length) return <p className="muted">Brak gięć – szyna prosta.</p>;
  const rows = [
    ...analysis.bends.map((b) => ({ pos: b.position, b, t: undefined })),
    ...analysis.twists.map((t) => ({ pos: t.start, b: undefined, t })),
  ].sort((x, y) => x.pos - y.pos);
  return (
    <table className="bend-table">
      <thead>
        <tr>
          <th>Nr</th>
          <th>Pozycja od A [mm]</th>
          <th>Typ</th>
          <th>Kierunek</th>
          <th>Kąt</th>
          <th>Nastawa maszyny</th>
          <th>R [mm]</th>
          <th>Strefa na płasko [mm]</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ b, t }) =>
          b ? (
            <tr key={`b${b.no}`}>
              <td className="num-badge">{b.no}</td>
              <td className="big">{fmt(b.position)}</td>
              <td>{PLANE_LABEL[b.plane]}</td>
              <td>
                <span className="arrow">{DIRECTION_ARROW[b.direction]}</span> {DIRECTION_LABEL[b.direction]}
              </td>
              <td>{fmt(b.angle)}°</td>
              <td className="big">{fmt(b.machineAngle)}°</td>
              <td>{fmt(b.radius)}</td>
              <td>
                {fmt(b.arcStart)} – {fmt(b.arcEnd)}
              </td>
            </tr>
          ) : (
            <tr key={`t${t!.no}`}>
              <td className="num-badge twist">S{t!.no}</td>
              <td className="big">
                {fmt(t!.start)} – {fmt(t!.end)}
              </td>
              <td>skręt</td>
              <td>{t!.angle > 0 ? '↻ w prawo' : '↺ w lewo'}</td>
              <td>{fmt(Math.abs(t!.angle))}°</td>
              <td>–</td>
              <td>–</td>
              <td>{fmt(t!.end - t!.start)}</td>
            </tr>
          ),
        )}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={8} className="muted">
            Pozycja = {REF_LABEL[settings.bendLineReference]}, mierzona od końca A (zielony). Nastawa uwzględnia
            sprężynowanie.
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
