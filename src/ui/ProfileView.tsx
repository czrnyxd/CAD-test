import { useId } from 'react';
import { fmt } from '../core/analyze';
import type { Assembly } from '../core/assembly';
import { dirVector, legDimensions } from '../core/geometry';
import type { Busbar } from '../core/model';

interface P {
  x: number;
  y: number;
}

/**
 * Front view of the finished (bent) bar, to scale, with the leg dimensions as entered (from / to
 * the reference points of the dimension mode) and the bend angles. All bends are flat, so the bar
 * lies in one plane and this drawing is exact. Used to check the bent bar.
 */
export function ProfileView({
  project,
  assembly,
  width = 1000,
  maxHeight = 520,
}: {
  project: Busbar;
  assembly: Assembly;
  width?: number;
  maxHeight?: number;
}) {
  const arrowId = `pv-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const T = project.section.thickness;
  const part1 = assembly.parts[0];
  const dims = legDimensions(part1.bar, part1.path);

  // Outlines (mm, x/y plane) of every bar.
  const outlines = assembly.parts.map((part) => {
    const top: P[] = [];
    const bottom: P[] = [];
    for (const s of part.path.samples) {
      top.push({ x: s.p.x + (s.n.x * T) / 2, y: s.p.y + (s.n.y * T) / 2 + part.offset });
      bottom.push({ x: s.p.x - (s.n.x * T) / 2, y: s.p.y - (s.n.y * T) / 2 + part.offset });
    }
    return { index: part.index, pts: [...top, ...bottom.reverse()] };
  });

  // Dimension geometry in mm.
  const all = outlines.flatMap((o) => o.pts);
  const minX0 = Math.min(...all.map((p) => p.x));
  const maxX0 = Math.max(...all.map((p) => p.x));
  const minY0 = Math.min(...all.map((p) => p.y));
  const maxY0 = Math.max(...all.map((p) => p.y));
  const spacing = Math.max(12, Math.hypot(maxX0 - minX0, maxY0 - minY0) * 0.09);
  const dimLines = dims.map((d) => {
    const s = project.steps[d.stepIndex];
    const across = Math.max(0, d.to.clone().sub(d.from).dot(d.outward));
    const k = across + spacing;
    const d1 = d.from.clone().addScaledVector(d.outward, k);
    const d2 = d.from.clone().addScaledVector(d.dir, d.length).addScaledVector(d.outward, k);
    return {
      from: { x: d.from.x, y: d.from.y },
      to: { x: d.to.x, y: d.to.y },
      d1: { x: d1.x, y: d1.y },
      d2: { x: d2.x, y: d2.y },
      text: s.kind === 'straight' ? fmt(s.length) : '',
    };
  });
  const bendLabels = part1.analysis.bends.map((b) => {
    const [a, c] = part1.path.stepRanges[b.stepIndex];
    const mid = part1.path.samples[Math.round((a + c) / 2)];
    const p = mid.p.clone().addScaledVector(dirVector(mid, b.direction), -(T / 2 + spacing * 0.7));
    return { x: p.x, y: p.y, text: `${fmt(b.angle)}°` };
  });
  const start = part1.path.samples[0];
  const aLabel = { x: start.p.x - start.t.x * spacing * 0.8, y: start.p.y - start.t.y * spacing * 0.8 };

  // Fit into the drawing.
  const ext = [...all, ...dimLines.flatMap((l) => [l.d1, l.d2]), ...bendLabels, aLabel];
  const minX = Math.min(...ext.map((p) => p.x)) - spacing * 0.3;
  const maxX = Math.max(...ext.map((p) => p.x)) + spacing * 0.3;
  const minY = Math.min(...ext.map((p) => p.y)) - spacing * 0.3;
  const maxY = Math.max(...ext.map((p) => p.y)) + spacing * 0.3;
  const pad = 30;
  const k = Math.min((width - 2 * pad) / Math.max(maxX - minX, 1), (maxHeight - 2 * pad) / Math.max(maxY - minY, 1));
  const height = (maxY - minY) * k + 2 * pad;
  const X = (x: number) => pad + (x - minX) * k;
  const Y = (y: number) => pad + (maxY - y) * k;
  const path = (pts: P[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ') + 'Z';

  return (
    <svg className="profile-svg" viewBox={`0 0 ${width} ${height}`} width="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id={arrowId} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#12171d" />
        </marker>
      </defs>
      {outlines.map((o) => (
        <path key={o.index} d={path(o.pts)} fill={o.index === 2 ? '#dde2e8' : '#f6e6d8'} stroke="#12171d" strokeWidth="1.5" />
      ))}
      {dimLines.map((l, i) => {
        const ang = (Math.atan2(-(Y(l.d2.y) - Y(l.d1.y)), X(l.d2.x) - X(l.d1.x)) * 180) / Math.PI;
        const rot = ang > 90 || ang < -90 ? -ang + 180 : -ang;
        const mx = (X(l.d1.x) + X(l.d2.x)) / 2;
        const my = (Y(l.d1.y) + Y(l.d2.y)) / 2;
        return (
          <g key={i}>
            <line x1={X(l.from.x)} y1={Y(l.from.y)} x2={X(l.d1.x)} y2={Y(l.d1.y)} stroke="#12171d" strokeWidth="0.8" />
            <line x1={X(l.to.x)} y1={Y(l.to.y)} x2={X(l.d2.x)} y2={Y(l.d2.y)} stroke="#12171d" strokeWidth="0.8" />
            <line
              x1={X(l.d1.x)}
              y1={Y(l.d1.y)}
              x2={X(l.d2.x)}
              y2={Y(l.d2.y)}
              stroke="#12171d"
              strokeWidth="1.4"
              markerStart={`url(#${arrowId})`}
              markerEnd={`url(#${arrowId})`}
            />
            <circle cx={X(l.from.x)} cy={Y(l.from.y)} r="3.5" fill="#f08c00" />
            <circle cx={X(l.to.x)} cy={Y(l.to.y)} r="3.5" fill="#f08c00" />
            <text x={mx} y={my - 6} textAnchor="middle" className="pv-dim" transform={`rotate(${rot} ${mx} ${my})`}>
              {l.text}
            </text>
          </g>
        );
      })}
      {bendLabels.map((b, i) => (
        <text key={i} x={X(b.x)} y={Y(b.y) + 5} textAnchor="middle" className="pv-angle">
          {b.text}
        </text>
      ))}
      <text x={X(aLabel.x)} y={Y(aLabel.y) + 6} textAnchor="middle" className="t-start">
        A
      </text>
    </svg>
  );
}
