import { Box3, Matrix4, Vector3 } from 'three';
import type { Assembly } from './assembly';
import type { CabinetAxis, CabinetConfig } from './model';

/**
 * Reference cabinet: where the bar sits in the cabinet and whether it fits.
 *
 * Bar coordinates (see geometry.ts): end A at the origin, t = +X along the bar, n = +Y towards
 * bend "up", w = +Z across the width. Cabinet coordinates: x to the right, y up, z towards the
 * front, origin in the left-back-bottom corner of the frame.
 */

export const DEFAULT_CABINET: CabinetConfig = {
  enabled: false,
  bays: [800],
  depth: 600,
  height: 2000,
  post: 50,
  a: { x: 100, y: 1700, z: 150 },
  heading: '+x',
  upSide: '+z',
  phases: 3,
  pitch: 150,
  phaseDir: 1,
};

export const PHASE_NAMES = ['L1', 'L2', 'L3', 'N'];

export const AXES: CabinetAxis[] = ['+x', '-x', '+z', '-z', '+y', '-y'];

export const AXIS_LABEL: Record<CabinetAxis, string> = {
  '+x': 'w prawo',
  '-x': 'w lewo',
  '+y': 'pionowo w górę',
  '-y': 'pionowo w dół',
  '+z': 'do przodu',
  '-z': 'do tyłu',
};

export function axisVector(a: CabinetAxis): Vector3 {
  const v = new Vector3();
  v[a[1] as 'x' | 'y' | 'z'] = a[0] === '-' ? -1 : 1;
  return v;
}

export function vectorAxis(v: Vector3): CabinetAxis {
  const ax = (['x', 'y', 'z'] as const).reduce(
    (best, k) => (Math.abs(v[k]) > Math.abs(v[best]) ? k : best),
    'x' as 'x' | 'y' | 'z',
  );
  return `${v[ax] < 0 ? '-' : '+'}${ax}` as CabinetAxis;
}

/** Axes perpendicular to the given one (possible directions of bend "up"). */
export function perpendicularAxes(a: CabinetAxis): CabinetAxis[] {
  return AXES.filter((b) => b[1] !== a[1]);
}

export function cabinetConfig(cfg: Partial<CabinetConfig> | undefined): CabinetConfig {
  const c = { ...DEFAULT_CABINET, ...cfg, a: { ...DEFAULT_CABINET.a, ...cfg?.a } };
  if (c.upSide[1] === c.heading[1]) c.upSide = perpendicularAxes(c.heading)[0];
  return c;
}

export function totalWidth(c: CabinetConfig): number {
  return c.bays.reduce((s, w) => s + w, 0);
}

/** Bar coordinates → cabinet coordinates. */
export function barToCabinet(c: CabinetConfig): Matrix4 {
  const t = axisVector(c.heading);
  const n = axisVector(c.upSide);
  const w = new Vector3().crossVectors(t, n);
  return new Matrix4().makeBasis(t, n, w).setPosition(c.a.x, c.a.y, c.a.z);
}

/** Cabinet direction of the bar's width axis (+w) – the direction in which the phases are stacked. */
export function widthAxis(c: CabinetConfig): CabinetAxis {
  return vectorAxis(new Vector3().crossVectors(axisVector(c.heading), axisVector(c.upSide)));
}

/** Direction (cabinet axis) in which the next phases lie. */
export function phaseAxis(c: CabinetConfig): CabinetAxis {
  const w = widthAxis(c);
  return c.phaseDir === 1 ? w : (`${w[0] === '-' ? '+' : '-'}${w[1]}` as CabinetAxis);
}

/** Shift of phase k (0 = the edited bar, L1) in bar coordinates: along the width. */
export function phaseShift(c: CabinetConfig, k: number): Vector3 {
  return new Vector3(0, 0, k * c.pitch * c.phaseDir);
}

/** A part of the frame, in cabinet coordinates. */
export interface FramePart {
  box: Box3;
  kind: 'post' | 'rail';
  /** Field (bay) number, from 1. */
  bay: number;
}

/** Frame of every field: four uprights and the top and bottom rails. */
export function frameParts(c: CabinetConfig): FramePart[] {
  const P = c.post;
  const { depth: D, height: H } = c;
  const out: FramePart[] = [];
  let x0 = 0;
  c.bays.forEach((bw, i) => {
    const bay = i + 1;
    const x1 = x0 + bw;
    const box = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, kind: FramePart['kind']) =>
      out.push({ box: new Box3(new Vector3(ax, ay, az), new Vector3(bx, by, bz)), kind, bay });
    for (const [xa, xb] of [
      [x0, x0 + P],
      [x1 - P, x1],
    ])
      for (const [za, zb] of [
        [0, P],
        [D - P, D],
      ])
        box(xa, 0, za, xb, H, zb, 'post');
    for (const [ya, yb] of [
      [0, P],
      [H - P, H],
    ]) {
      // Rails along the width (back, front) and along the depth (left, right), between the uprights.
      box(x0 + P, ya, 0, x1 - P, yb, P, 'rail');
      box(x0 + P, ya, D - P, x1 - P, yb, D, 'rail');
      box(x0, ya, P, x0 + P, yb, D - P, 'rail');
      box(x1 - P, ya, P, x1, yb, D - P, 'rail');
    }
    x0 = x1;
  });
  return out;
}

/** Points on the surface of every bar (in bar coordinates, before the phase shift), at most `step` mm apart. */
function surfacePoints(assembly: Assembly, width: number, thickness: number, step: number): Vector3[] {
  const pts: Vector3[] = [];
  const nw = Math.max(1, Math.ceil(width / step));
  for (const part of assembly.parts) {
    const s = part.path.samples;
    const shift = new Vector3(0, part.offset, 0);
    const addRing = (p: Vector3, n: Vector3, w: Vector3) => {
      for (let i = 0; i <= nw; i++) {
        const along = -width / 2 + (width * i) / nw;
        for (const side of [-1, 1]) {
          pts.push(
            p
              .clone()
              .add(shift)
              .addScaledVector(w, along)
              .addScaledVector(n, (side * thickness) / 2),
          );
        }
      }
    };
    for (let k = 1; k < s.length; k++) {
      const a = s[k - 1];
      const b = s[k];
      const m = Math.max(1, Math.ceil((b.s - a.s) / step));
      for (let j = 0; j < m; j++) {
        const f = j / m;
        addRing(a.p.clone().lerp(b.p, f), a.n.clone().lerp(b.n, f).normalize(), a.w.clone().lerp(b.w, f).normalize());
      }
    }
    const last = s[s.length - 1];
    addRing(last.p, last.n, last.w);
  }
  return pts;
}

export interface CabinetCheck {
  /** Smallest gap between a bar and the frame, mm (0 when they touch or overlap). */
  clearance: number;
  /** Closest pair: point on the bar and on the frame, in cabinet coordinates. */
  from: Vector3 | null;
  to: Vector3 | null;
  /** Phase (0 = L1) of the closest point. */
  phase: number;
  /** Indices into frameParts() that a bar goes through. */
  hits: number[];
  /** Phases that go through the frame. */
  hitPhases: number[];
  /** Some bar goes outside the cabinet (e.g. into a field that is not drawn). */
  outside: boolean;
  /** Phases overlap each other (pitch smaller than the bar width). */
  phasesOverlap: boolean;
  /** Bounding box of all phases, in cabinet coordinates. */
  bars: Box3;
}

/** How the bar (and its phases) fits in the cabinet. */
export function checkCabinet(assembly: Assembly, cfg: CabinetConfig, width: number, thickness: number): CabinetCheck {
  const toCab = barToCabinet(cfg);
  const parts = frameParts(cfg);
  const local = surfacePoints(assembly, width, thickness, Math.max(4, Math.min(10, width / 6)));
  const W = totalWidth(cfg);
  const inside = new Box3(new Vector3(-0.01, -0.01, -0.01), new Vector3(W + 0.01, cfg.height + 0.01, cfg.depth + 0.01));
  const bars = new Box3();
  let best = Infinity;
  let from: Vector3 | null = null;
  let to: Vector3 | null = null;
  let phase = 0;
  const hits = new Set<number>();
  const hitPhases = new Set<number>();
  let outside = false;
  const phases = Math.max(1, Math.min(4, Math.round(cfg.phases)));
  for (let k = 0; k < phases; k++) {
    const pts = local.map((p) => p.clone().add(phaseShift(cfg, k)).applyMatrix4(toCab));
    const pb = new Box3().setFromPoints(pts);
    bars.union(pb);
    if (!inside.containsBox(pb)) outside = true;
    // Only frame parts near the bar can be the closest ones (all of them when none is near).
    const zone = pb.clone().expandByScalar(300);
    let near = parts
      .map((fp, i) => ({ fp, i, core: fp.box.clone().expandByScalar(-0.01) }))
      .filter(({ fp }) => fp.box.intersectsBox(zone));
    if (!near.length) near = parts.map((fp, i) => ({ fp, i, core: fp.box.clone().expandByScalar(-0.01) }));
    for (const p of pts) {
      for (const { fp, i, core } of near) {
        const d = fp.box.distanceToPoint(p);
        if (d === 0 && core.containsPoint(p)) {
          hits.add(i);
          hitPhases.add(k);
        }
        if (d < best) {
          best = d;
          from = p.clone();
          to = fp.box.clampPoint(p, new Vector3());
          phase = k;
        }
      }
    }
  }
  return {
    clearance: Number.isFinite(best) ? best : Infinity,
    from,
    to,
    phase,
    hits: [...hits],
    hitPhases: [...hitPhases].sort(),
    outside,
    phasesOverlap: phases > 1 && cfg.pitch < width,
    bars,
  };
}

/**
 * Box to fit the camera to when the cabinet is shown (cabinet coordinates): the bars and the
 * whole width and depth of the cabinet in a band around them.
 */
export function cabinetViewBox(cfg: CabinetConfig, bars: Box3): Box3 {
  const m = 150;
  const box = bars.clone().expandByScalar(m);
  box.union(new Box3(new Vector3(0, bars.min.y - m, 0), new Vector3(totalWidth(cfg), bars.max.y + m, cfg.depth)));
  return box;
}
