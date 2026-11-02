import type { DimensionMode } from '../core/model';

/**
 * Schematic L-bend (bar drawn extra thick) showing from where to where a leg dimension is
 * measured in the selected dimension mode.
 */
export function DimensionModeHelp({ mode }: { mode: DimensionMode }) {
  // Geometry of the schematic (px): horizontal leg from x0, vertical leg up to y0.
  const x0 = 40;
  const y0 = 40;
  const T = 26; // drawn thickness
  const ri = 18; // inner radius
  const ro = ri + T;
  const outX = 280; // outer face of the vertical leg
  const outY = 220; // outer face of the horizontal leg
  const inX = outX - T;
  const inY = outY - T;
  const off = mode === 'outside' ? 0 : mode === 'inside' ? T : T / 2; // reference surface from the outer face
  const refX = outX - off;
  const refY = outY - off;
  const dimY = outY + 46;
  const dimX = outX + 46;
  const barPath = [
    `M${x0},${inY}`,
    `H${inX - ri}`,
    `A${ri},${ri} 0 0 0 ${inX},${inY - ri}`,
    `V${y0}`,
    `H${outX}`,
    `V${outY - ro}`,
    `A${ro},${ro} 0 0 1 ${outX - ro},${outY}`,
    `H${x0}`,
    'Z',
  ].join(' ');
  // Tangent points on the reference surface (where the straight face ends) – the dashed lines go
  // from there to the virtual sharp (refX, refY).
  const r = ri + (T - off); // radius of the reference surface
  const tanH = { x: refX - r, y: refY };
  const tanV = { x: refX, y: refY - r };
  const caption =
    mode === 'outside'
      ? 'Wymiar ramienia do zewnętrznej ściany drugiego ramienia (zewnętrzny ostry narożnik).'
      : mode === 'inside'
        ? 'Wymiar ramienia do wewnętrznej ściany drugiego ramienia (wewnętrzny ostry narożnik).'
        : 'Wymiar ramienia do osi drugiego ramienia (środek grubości szyny).';

  return (
    <figure className="dim-help">
      <svg viewBox="0 0 360 300" role="img" aria-label={caption}>
        <defs>
          <marker id="dh-arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#1f5fbf" />
          </marker>
        </defs>
        <path d={barPath} fill="#e7b48a" stroke="#6b3d16" strokeWidth="2" />
        {/* centre line of the bar */}
        <path
          d={`M${x0},${outY - T / 2} H${outX - T / 2 - (ri + T / 2)} A${ri + T / 2},${ri + T / 2} 0 0 0 ${outX - T / 2},${outY - T / 2 - (ri + T / 2)} V${y0}`}
          fill="none"
          stroke="#6b3d16"
          strokeWidth="1"
          strokeDasharray="8 3 2 3"
          opacity="0.7"
        />
        {/* reference surface extended to the virtual sharp */}
        <path
          d={`M${tanH.x},${tanH.y} H${refX} V${tanV.y}`}
          fill="none"
          stroke="#7b8794"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        {/* horizontal leg dimension */}
        <line x1={x0} y1={outY + 4} x2={x0} y2={dimY + 8} stroke="#1f5fbf" strokeWidth="1" />
        <line x1={refX} y1={refY + 4} x2={refX} y2={dimY + 8} stroke="#1f5fbf" strokeWidth="1" />
        <line
          x1={x0}
          y1={dimY}
          x2={refX}
          y2={dimY}
          stroke="#1f5fbf"
          strokeWidth="1.5"
          markerStart="url(#dh-arr)"
          markerEnd="url(#dh-arr)"
        />
        <text x={(x0 + refX) / 2} y={dimY - 6} textAnchor="middle" className="dh-text">
          ramię 1
        </text>
        {/* vertical leg dimension */}
        <line x1={outX + 4} y1={y0} x2={dimX + 8} y2={y0} stroke="#1f5fbf" strokeWidth="1" />
        <line x1={refX + 4} y1={refY} x2={dimX + 8} y2={refY} stroke="#1f5fbf" strokeWidth="1" />
        <line
          x1={dimX}
          y1={y0}
          x2={dimX}
          y2={refY}
          stroke="#1f5fbf"
          strokeWidth="1.5"
          markerStart="url(#dh-arr)"
          markerEnd="url(#dh-arr)"
        />
        <text x={dimX + 6} y={(y0 + refY) / 2} className="dh-text" transform={`rotate(90 ${dimX + 6} ${(y0 + refY) / 2})`}>
          ramię 2
        </text>
        {/* reference points */}
        <circle cx={x0} cy={refY} r="5" fill="#e8590c" />
        <circle cx={refX} cy={refY} r="6" fill="#e8590c" />
        <circle cx={refX} cy={y0} r="5" fill="#e8590c" />
        <text x={x0 + 4} y={outY + 18} className="dh-small">
          koniec A
        </text>
      </svg>
      <figcaption>{caption} Pomarańczowe punkty pokazują, skąd dokąd liczony jest wymiar – tak samo w modelu 3D.</figcaption>
    </figure>
  );
}
