import { setback } from './bending';
import type { BendStep, Busbar, Sketch, SketchAxis, SketchDim, SketchRef, Step } from './model';

/**
 * 2D sketch of a bar: its centreline as a polyline of virtual sharps in the bending plane, the
 * reference axes, driving dimensions and a small solver that changes the unlocked leg lengths and
 * bend angles so that the dimensions get the wanted values.
 *
 * Plane coordinates: end A at the origin, x along the first leg, y towards bend "up" (a bend up
 * turns the bar counter-clockwise).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** The two axes through end A that every sketch has. */
export const BASE_AXES: SketchAxis[] = [
  { id: 'X', dir: 'h', at: 0 },
  { id: 'Y', dir: 'v', at: 0 },
];

export function sketchOf(bar: Busbar): Sketch {
  return { axes: bar.sketch?.axes ?? [], dims: bar.sketch?.dims ?? [] };
}

export function allAxes(bar: Busbar): SketchAxis[] {
  return [...BASE_AXES, ...sketchOf(bar).axes];
}

/** Name of an axis as shown on the drawing. */
export function axisName(bar: Busbar, id: string): string {
  if (id === 'X' || id === 'Y') return `oś ${id}`;
  const i = sketchOf(bar).axes.findIndex((a) => a.id === id);
  return `oś ${i + 1}`;
}

const validBend = (s: Step | undefined): s is BendStep => !!s && s.kind === 'bend' && s.angle > 0 && s.angle < 180;

export interface SketchGeometry {
  /**
   * Dimension points: [0] end A, then one per leg end. They lie on the reference surface of the
   * dimension mode (outside: the outer virtual sharps and the outer face at the free ends).
   */
  vertices: Vec2[];
  /** Centreline virtual sharps, same indices as vertices. */
  center: Vec2[];
  /** Per straight step: its index, id and the vertices at its ends. */
  legs: { stepIndex: number; id: string; from: number; to: number }[];
  /** Per valid bend: the vertex it is at. */
  bends: { stepIndex: number; vertex: number }[];
  /** Reference lines along the legs (outer faces for outside dimensions), through the dimension points. */
  lines: [Vec2, Vec2][];
  /**
   * Where the centreline of end A is. The drawing is moved so that the dimension point of end A
   * is the origin: for outside dimensions the outer face of the first leg lies on the X axis.
   */
  origin: Vec2;
}

/**
 * Polyline of the bar. A leg entered in the dimension mode of the project is converted to its
 * centreline sharp-to-sharp length with the same setbacks as the flat pattern uses; the dimension
 * points are then moved from the centreline to the reference surface.
 */
export function sketchGeometry(bar: Busbar, steps: Step[] = bar.steps): SketchGeometry {
  const T = bar.section.thickness;
  const mode = bar.dimensionMode;
  // Offset of the reference surface from the centreline, away from the centre of the bend.
  const e = mode === 'outside' ? T / 2 : mode === 'inside' ? -T / 2 : 0;
  const corr = (s: Step | undefined) =>
    validBend(s) ? setback(s.angle, s.radius, T, 'centerline') - setback(s.angle, s.radius, T, mode) : 0;
  const center: Vec2[] = [{ x: 0, y: 0 }];
  const dirs: Vec2[] = [];
  const legs: SketchGeometry['legs'] = [];
  const bends: SketchGeometry['bends'] = [];
  const bendSign: number[] = []; // per vertex: +1 bend up, −1 down, 0 none
  let heading = 0;
  steps.forEach((s, i) => {
    if (s.kind === 'straight') {
      const len = s.length + corr(steps[i - 1]) + corr(steps[i + 1]);
      const p = center[center.length - 1];
      const u = { x: Math.cos(heading), y: Math.sin(heading) };
      center.push({ x: p.x + len * u.x, y: p.y + len * u.y });
      dirs.push(u);
      legs.push({ stepIndex: i, id: s.id, from: center.length - 2, to: center.length - 1 });
    } else if (validBend(s)) {
      bends.push({ stepIndex: i, vertex: center.length - 1 });
      bendSign[center.length - 1] = s.direction === 'up' ? 1 : -1;
      heading += ((s.direction === 'up' ? 1 : -1) * s.angle * Math.PI) / 180;
    }
  });
  // Normal of a leg pointing away from the centre of a bend: a bend up turns left, so outward is right.
  const outward = (u: Vec2, sign: number): Vec2 => (sign > 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x });
  const add = (p: Vec2, n: Vec2, k: number) => ({ x: p.x + n.x * k, y: p.y + n.y * k });
  const vertices = center.map((c, v) => {
    const sign = bendSign[v];
    if (sign) {
      // Intersection of the two offset faces: c + e·(n1 + n2) / (1 + n1·n2).
      const n1 = outward(dirs[v - 1], sign);
      const n2 = outward(dirs[v], sign);
      const k = e / (1 + n1.x * n2.x + n1.y * n2.y);
      return { x: c.x + (n1.x + n2.x) * k, y: c.y + (n1.y + n2.y) * k };
    }
    // Free end: on the reference face of the bend at the other end of its leg.
    const legDir = v === 0 ? dirs[0] : dirs[v - 1];
    const endSign = (v === 0 ? bendSign[1] : bendSign[v - 1]) ?? 0;
    return legDir && endSign ? add(c, outward(legDir, endSign), e) : { ...c };
  });
  // Reference lines: each leg on the reference face of each bend at its ends (both faces when they differ).
  const lines: [Vec2, Vec2][] = [];
  legs.forEach((l, k) => {
    const u = dirs[k];
    const signs = new Set([bendSign[l.from], bendSign[l.to]].filter(Boolean));
    if (!signs.size) signs.add(0);
    for (const sg of signs) {
      const n = sg ? outward(u, sg) : { x: 0, y: 0 };
      lines.push([add(center[l.from], n, sg ? e : 0), add(center[l.to], n, sg ? e : 0)]);
    }
  });
  // Origin at the dimension point of end A (on the reference face of the first leg).
  const o = { ...vertices[0] };
  const shift = (p: Vec2) => ({ x: p.x - o.x, y: p.y - o.y });
  return {
    vertices: vertices.map(shift),
    center: center.map(shift),
    legs,
    bends,
    lines: lines.map(([p, q]) => [shift(p), shift(q)] as [Vec2, Vec2]),
    origin: { x: -o.x, y: -o.y },
  };
}

/** Vertex a point reference stands for, or null when its leg no longer exists. */
export function refVertex(g: SketchGeometry, r: SketchRef): number | null {
  if (r.kind !== 'pt') return null;
  const leg = g.legs.find((l) => l.id === r.leg);
  return leg ? (r.end === 0 ? leg.from : leg.to) : null;
}

/** Reference to a vertex (the end of a leg that ends there). */
export function vertexRef(g: SketchGeometry, v: number): SketchRef | null {
  const leg = g.legs.find((l) => l.to === v) ?? g.legs.find((l) => l.from === v);
  if (!leg) return null;
  return { kind: 'pt', leg: leg.id, end: leg.to === v ? 1 : 0 };
}

/** Is the dimension still usable (its points and axes exist, the type fits the references)? */
export function dimValid(bar: Busbar, g: SketchGeometry, d: SketchDim): boolean {
  const axes = allAxes(bar);
  const ok = (r: SketchRef) => (r.kind === 'pt' ? refVertex(g, r) !== null : axes.some((a) => a.id === r.axis));
  if (!ok(d.a) || !ok(d.b)) return false;
  const axisDir = (r: SketchRef) => (r.kind === 'axis' ? axes.find((a) => a.id === r.axis)!.dir : null);
  const da = axisDir(d.a);
  const db = axisDir(d.b);
  if (d.type === 'd') return !da && !db;
  // A horizontal distance needs vertical axes (x = const), a vertical one horizontal axes.
  const need = d.type === 'h' ? 'v' : 'h';
  return (!da || da === need) && (!db || db === need) && !(da && db);
}

/** Signed value of a dimension on a given polyline (Δx, Δy or the distance). */
export function measureDim(bar: Busbar, g: SketchGeometry, d: SketchDim): number {
  const axes = allAxes(bar);
  const coord = (r: SketchRef, k: 'x' | 'y') => {
    if (r.kind === 'axis') return axes.find((a) => a.id === r.axis)!.at;
    return g.vertices[refVertex(g, r)!][k];
  };
  if (d.type === 'h') return coord(d.b, 'x') - coord(d.a, 'x');
  if (d.type === 'v') return coord(d.b, 'y') - coord(d.a, 'y');
  const a = g.vertices[refVertex(g, d.a)!];
  const b = g.vertices[refVertex(g, d.b)!];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Dimensions that can still be drawn and measured. */
export function liveDims(bar: Busbar, g = sketchGeometry(bar)): SketchDim[] {
  return sketchOf(bar).dims.filter((d) => dimValid(bar, g, d));
}

// ---------------------------------------------------------------- solver

interface Param {
  step: number;
  kind: 'len' | 'ang';
}

interface Target {
  f: (g: SketchGeometry) => number;
  value: number;
  /** Rows with a larger weight win when not every target can be met. */
  weight: number;
}

/** 1° of bend angle costs as much as this many mm of leg length: angles change only when lengths cannot do it. */
const ANGLE_COST = 1000;

/** Smallest allowed value of a parameter (a leg must keep a straight part, an angle stays in 0.5…179.5°). */
function lowerBound(bar: Busbar, steps: Step[], p: Param): number {
  if (p.kind === 'ang') return 0.5;
  const T = bar.section.thickness;
  const sb = (s: Step | undefined) => (validBend(s) ? setback(s.angle, s.radius, T, bar.dimensionMode) : 0);
  return sb(steps[p.step - 1]) + sb(steps[p.step + 1]) + 1;
}

function getP(steps: Step[], p: Param): number {
  const s = steps[p.step];
  return p.kind === 'len' ? (s as { length: number }).length : (s as BendStep).angle;
}

function withValues(steps: Step[], params: Param[], x: number[]): Step[] {
  const out = steps.slice();
  params.forEach((p, k) => {
    out[p.step] = (p.kind === 'len' ? { ...out[p.step], length: x[k] } : { ...out[p.step], angle: x[k] }) as Step;
  });
  return out;
}

/** Solve A·y = b for a small square system (Gaussian elimination with pivoting). */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export interface SolveResult {
  steps: Step[];
  ok: boolean;
  /** Largest remaining difference of a target with weight ≥ 1, mm. */
  error: number;
}

/**
 * Change the free (unlocked, not fixed) leg lengths and bend angles as little as possible so that
 * every target gets its value. Least change: lengths in mm, angles weighted by ANGLE_COST.
 */
function solve(
  bar: Busbar,
  targets: Target[],
  fixed: Set<string> = new Set(),
  damping = 1e-9,
  /** Extra cost of changing particular steps (by id), × the normal cost. */
  cost: Map<string, number> = new Map(),
): SolveResult {
  const steps = bar.steps;
  const params: Param[] = [];
  steps.forEach((s, i) => {
    if (s.locked || fixed.has(s.id)) return;
    if (s.kind === 'straight') params.push({ step: i, kind: 'len' });
    else if (validBend(s)) params.push({ step: i, kind: 'ang' });
  });
  const evalAll = (x: number[]) => {
    const g = sketchGeometry(bar, withValues(steps, params, x));
    return targets.map((t) => t.f(g));
  };
  const residual = (x: number[]) => evalAll(x).map((v, k) => targets[k].value - v);
  const worst = (r: number[]) => Math.max(0, ...r.map((v, k) => (targets[k].weight >= 1 ? Math.abs(v) : 0)));
  let x = params.map((p) => getP(steps, p));
  if (!targets.length) return { steps, ok: true, error: 0 };
  let r = residual(x);
  if (!params.length) return { steps, ok: worst(r) < 0.01, error: worst(r) };
  const scale = params.map((p) => (p.kind === 'ang' ? 1 / ANGLE_COST : 1) / (cost.get(steps[p.step].id) ?? 1));
  const sw = targets.map((t) => Math.sqrt(t.weight));
  for (let it = 0; it < 60 && worst(r) > 1e-4; it++) {
    // Jacobian (central differences), weighted rows, scaled columns.
    const J = targets.map(() => params.map(() => 0));
    params.forEach((p, j) => {
      const h = p.kind === 'ang' ? 1e-4 : 1e-3;
      const xp = x.slice();
      const xm = x.slice();
      xp[j] += h;
      xm[j] -= h;
      const fp = evalAll(xp);
      const fm = evalAll(xm);
      targets.forEach((_, i) => (J[i][j] = ((fp[i] - fm[i]) / (2 * h)) * sw[i] * scale[j]));
    });
    const rw = r.map((v, i) => v * sw[i]);
    // Minimum-norm step: Δy = Jᵀ (J Jᵀ + λI)⁻¹ r. λ relative to the largest diagonal entry, raised
    // only when the step does not help (Levenberg–Marquardt), so an angle-only move is not slowed down.
    const m = targets.length;
    const base = Array.from({ length: m }, (_, a) =>
      Array.from({ length: m }, (_, b) => J[a].reduce((s, v, k) => s + v * J[b][k], 0)),
    );
    const diag = Math.max(1e-30, ...base.map((row, i) => row[i]));
    const norm = (q: number[]) => q.reduce((s, v, i) => s + v * v * targets[i].weight, 0);
    let next = x;
    let rn = r;
    for (const lam of [damping, 1e-6, 1e-3, 1e-1, 10]) {
      const z = solveLinear(
        base.map((row, a) => row.map((v, b) => v + (a === b ? lam * diag : 0))),
        rw,
      );
      if (!z) continue;
      const dx = params.map((_, j) => scale[j] * J.reduce((s, row, i) => s + row[j] * z[i], 0));
      // Keep inside the bounds; shorten the step while it does not help (strongly bent shapes).
      for (let k = 0, t = 1; k < 6; k++, t /= 2) {
        const cand = x.map((v, j) => {
          let nv = v + t * dx[j];
          nv = Math.max(lowerBound(bar, withValues(steps, params, x), params[j]), nv);
          if (params[j].kind === 'ang') nv = Math.min(179.5, nv);
          return nv;
        });
        const rc = residual(cand);
        if (norm(rc) < norm(r)) {
          next = cand;
          rn = rc;
          break;
        }
      }
      if (next !== x) break;
    }
    if (next === x) break;
    x = next;
    r = rn;
  }
  return { steps: withValues(steps, params, x), ok: worst(r) < 0.01, error: worst(r) };
}

/** Target that keeps a locked dimension at its value (on the side it is now). */
function dimTarget(bar: Busbar, g0: SketchGeometry, d: SketchDim, value = d.value, weight = 1): Target {
  const now = measureDim(bar, g0, d);
  const sign = d.type === 'd' || now >= 0 ? 1 : -1;
  return { f: (g) => measureDim(bar, g, d), value: sign * value, weight };
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** Rounded values (whole mm, 0.1°) when they still keep the locked dimensions. */
function tidy(bar: Busbar, before: Step[], res: SolveResult, keep: Target[]): Step[] {
  const val = (s: Step) => (s.kind === 'straight' ? s.length : s.angle);
  const changed = res.steps.map((s, i) => Math.abs(val(s) - val(before[i])) > 1e-6);
  const roundStep = (s: Step, i: number): Step => {
    if (!changed[i]) return before[i];
    const v = s.kind === 'straight' ? round(s.length, 1) : round(s.angle, 0.1);
    if (v === val(before[i])) return before[i];
    return (s.kind === 'straight' ? { ...s, length: v } : { ...s, angle: v }) as Step;
  };
  const rounded = res.steps.map(roundStep);
  const fits = (steps: Step[]) => {
    const g = sketchGeometry(bar, steps);
    return keep.every((t) => Math.abs(t.f(g) - t.value) < 0.05);
  };
  if (fits(rounded)) return rounded;
  // Whole numbers everywhere but one step, which takes the remainder (the most changed one first).
  const order = res.steps
    .map((s, i) => ({ i, d: Math.abs(val(s) - val(before[i])) }))
    .filter((o) => changed[o.i])
    .sort((a, b) => b.d - a.d);
  for (const { i } of order) {
    const trial = rounded.slice();
    trial[i] = res.steps[i];
    const fixed = new Set(bar.steps.filter((_, k) => k !== i).map((st) => st.id));
    const r = solve({ ...bar, steps: trial }, keep, fixed);
    if (r.ok)
      return r.steps.map((st, k) =>
        k === i ? { ...st, ...(st.kind === 'straight' ? { length: round(st.length, 0.01) } : {}) } : st,
      ) as Step[];
  }
  return res.steps.map((s, i) => (changed[i] ? s : before[i]));
}

export interface SketchChange {
  bar: Busbar;
  ok: boolean;
  /** Why the change could not be made (in Polish), when not ok. */
  message?: string;
}

const BLOCKED = 'Nie da się – za mało odblokowanych odcinków i kątów. Odblokuj długość lub kąt, który może się zmienić.';

/** Set a dimension to a value (it becomes locked); the other locked dimensions are kept. */
export function setDimValue(bar: Busbar, dimId: string, value: number): SketchChange {
  const g = sketchGeometry(bar);
  const dims = liveDims(bar, g);
  const d = dims.find((x) => x.id === dimId);
  if (!d) return { bar, ok: false, message: 'Tego wymiaru już nie ma.' };
  const targets = [
    dimTarget(bar, g, d, value),
    ...dims.filter((x) => x.locked && x.id !== dimId).map((x) => dimTarget(bar, g, x)),
  ];
  const res = solve(bar, targets);
  if (!res.ok) return { bar, ok: false, message: BLOCKED };
  const steps = tidy(bar, bar.steps, res, targets);
  const sk = sketchOf(bar);
  return {
    ok: true,
    bar: { ...bar, steps, sketch: { ...sk, dims: sk.dims.map((x) => (x.id === dimId ? { ...x, value, locked: true } : x)) } },
  };
}

/**
 * After the user changed some steps directly: keep the locked dimensions by changing the other
 * free steps (the changed ones stay as entered). Not ok when that is impossible – the change is
 * kept and the dimensions show the conflict.
 */
export function keepLockedDims(bar: Busbar, changedIds: Set<string>): SketchChange {
  const g = sketchGeometry(bar);
  const locked = liveDims(bar, g).filter((d) => d.locked);
  if (!locked.length) return { bar, ok: true };
  const targets = locked.map((d) => dimTarget(bar, g, d));
  if (targets.every((t) => Math.abs(t.f(g) - t.value) < 0.01)) return { bar, ok: true };
  const res = solve(bar, targets, changedIds);
  if (!res.ok) return { bar, ok: false, message: 'Zablokowane wymiary nie mogą zostać zachowane – są zaznaczone na czerwono.' };
  return { bar: { ...bar, steps: tidy(bar, bar.steps, res, targets) }, ok: true };
}

/**
 * Drag a leg: the grabbed point of the leg (at `along` mm from its start on the centreline)
 * follows the cursor (`to`, plane coordinates), keeping the locked dimensions, lengths and angles.
 * The grabbed point stays at the same fraction of the leg. Steps change as little as possible:
 * other lengths first, the dragged leg's own length next, angles where lengths cannot do it (or
 * are locked). Best effort when the cursor is out of reach.
 */
export function dragLeg(bar: Busbar, stepIndex: number, along: number, to: Vec2): SketchChange {
  const g0 = sketchGeometry(bar);
  const leg = g0.legs.find((l) => l.stepIndex === stepIndex);
  if (!leg) return { bar, ok: false };
  const a = g0.center[leg.from];
  const b = g0.center[leg.to];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const tau = Math.max(0, Math.min(1, along / len));
  const pointOn = (g: SketchGeometry) => {
    const p = g.center[leg.from];
    const q = g.center[leg.to];
    return { x: p.x + (q.x - p.x) * tau, y: p.y + (q.y - p.y) * tau };
  };
  const locked = liveDims(bar, g0)
    .filter((d) => d.locked)
    .map((d) => dimTarget(bar, g0, d, d.value, 1000));
  const follow: Target[] = [
    { f: (g) => pointOn(g).x, value: to.x, weight: 1 },
    { f: (g) => pointOn(g).y, value: to.y, weight: 1 },
  ];
  // The dragged leg itself changes its length only when nothing else can move the point (e.g. along itself).
  const res = solve(bar, [...locked, ...follow], new Set(), 1e-9, new Map([[leg.id, 4]]));
  const g1 = sketchGeometry(bar, res.steps);
  if (locked.some((t) => Math.abs(t.f(g1) - t.value) > 0.05)) return { bar, ok: false };
  const steps = tidy(bar, bar.steps, res, locked);
  const moved = steps.some((s, i) => s !== bar.steps[i]);
  return { bar: { ...bar, steps }, ok: moved };
}

/** Is every locked dimension at its value? Returns the ids of those that are not. */
export function dimConflicts(bar: Busbar, g = sketchGeometry(bar)): Set<string> {
  const out = new Set<string>();
  for (const d of liveDims(bar, g)) {
    if (d.locked && Math.abs(Math.abs(measureDim(bar, g, d)) - d.value) > 0.05) out.add(d.id);
  }
  return out;
}
