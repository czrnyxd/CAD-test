import { Box3, Quaternion, Vector3 } from 'three';
import type { Analysis, Issue } from './analyze';
import { deg2rad } from './bending';
import type { Busbar, Direction } from './model';

/**
 * Local frame of the bar cross-section.
 *  t – along the bar, n – thickness normal (bend direction "up"), w – width direction.
 * Start frame: t=+X, n=+Y, w=+Z.
 */
export interface PathSample {
  p: Vector3;
  t: Vector3;
  n: Vector3;
  w: Vector3;
  /** Step that produced the strip ending at this sample (for the first sample: 0). */
  stepIndex: number;
  /** Centerline arc length from the start. */
  s: number;
}

export interface BarPath {
  samples: PathSample[];
  /** Indices into samples at which a step starts/ends. stepRanges[i] = [startSample, endSample]. */
  stepRanges: [number, number][];
  bbox: Box3;
}

export function dirVector(f: { n: Vector3 }, d: Direction): Vector3 {
  return d === 'up' ? f.n.clone() : f.n.clone().negate();
}

export function buildPath(bar: Busbar, an: Analysis): BarPath {
  const { section } = bar;
  const samples: PathSample[] = [];
  const stepRanges: [number, number][] = [];
  let cur: PathSample = {
    p: new Vector3(0, 0, 0),
    t: new Vector3(1, 0, 0),
    n: new Vector3(0, 1, 0),
    w: new Vector3(0, 0, 1),
    stepIndex: 0,
    s: 0,
  };
  samples.push(cur);

  const push = (p: Vector3, t: Vector3, n: Vector3, w: Vector3, stepIndex: number, ds: number) => {
    cur = { p, t, n, w, stepIndex, s: cur.s + ds };
    samples.push(cur);
  };

  bar.steps.forEach((step, i) => {
    const startIdx = samples.length - 1;
    if (step.kind === 'straight') {
      const len = Math.max(0, an.netStraight[i] ?? 0);
      push(cur.p.clone().addScaledVector(cur.t, len), cur.t.clone(), cur.n.clone(), cur.w.clone(), i, len);
    } else {
      if (step.angle > 0 && step.angle < 180) {
        const rc = step.radius + section.thickness / 2;
        const dir = dirVector(cur, step.direction);
        const axis = new Vector3().crossVectors(cur.t, dir).normalize();
        const center = cur.p.clone().addScaledVector(dir, rc);
        const base = cur;
        const n = Math.max(6, Math.ceil(step.angle / 4));
        const dTheta = deg2rad(step.angle) / n;
        for (let k = 1; k <= n; k++) {
          const q = new Quaternion().setFromAxisAngle(axis, dTheta * k);
          const p = base.p.clone().sub(center).applyQuaternion(q).add(center);
          push(
            p,
            base.t.clone().applyQuaternion(q),
            base.n.clone().applyQuaternion(q),
            base.w.clone().applyQuaternion(q),
            i,
            rc * dTheta,
          );
        }
      }
    }
    stepRanges.push([startIdx, samples.length - 1]);
  });

  const bbox = new Box3();
  for (const s of samples) for (const c of sectionCorners(s, bar.section.width, bar.section.thickness)) bbox.expandByPoint(c);
  if (bbox.isEmpty()) bbox.expandByPoint(new Vector3());
  return { samples, stepRanges, bbox };
}

/** Corners of the cross-section at a sample, order: (-w,+n), (+w,+n), (+w,-n), (-w,-n). */
export function sectionCorners(s: PathSample, width: number, thickness: number): Vector3[] {
  const hw = width / 2;
  const ht = thickness / 2;
  const c = (a: number, b: number) =>
    s.p
      .clone()
      .addScaledVector(s.w, a * hw)
      .addScaledVector(s.n, b * ht);
  return [c(-1, 1), c(1, 1), c(1, -1), c(-1, -1)];
}

/** Key points (snap targets for measuring): section corners and centers at every step boundary. */
export function keyPoints(path: BarPath, width: number, thickness: number): Vector3[] {
  const idx = new Set<number>();
  for (const [a, b] of path.stepRanges) {
    idx.add(a);
    idx.add(b);
  }
  const pts: Vector3[] = [];
  for (const i of [...idx].sort((x, y) => x - y)) {
    const s = path.samples[i];
    pts.push(...sectionCorners(s, width, thickness));
  }
  // Centers of the two end faces.
  pts.push(path.samples[0].p.clone(), path.samples[path.samples.length - 1].p.clone());
  return pts;
}

/** One straight piece of the centre line (a leg or a chord of a bend arc) in the plane of the bends. */
interface Piece {
  /** Middle of the piece. */
  cx: number;
  cy: number;
  /** Unit direction. */
  ux: number;
  uy: number;
  halfLength: number;
  /** Centre line arc length at the start and at the end of the piece. */
  s0: number;
  s1: number;
  step: number;
}

/** Do two rectangles (pieces of the bar seen from the side, `halfThickness` each way) overlap? */
function piecesOverlap(a: Piece, b: Piece, halfThickness: number): boolean {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  // Separating axis test on the four edge directions.
  for (const [ax, ay] of [
    [a.ux, a.uy],
    [-a.uy, a.ux],
    [b.ux, b.uy],
    [-b.uy, b.ux],
  ]) {
    const reach = (p: Piece) => p.halfLength * Math.abs(p.ux * ax + p.uy * ay) + halfThickness * Math.abs(-p.uy * ax + p.ux * ay);
    if (Math.abs(dx * ax + dy * ay) >= reach(a) + reach(b)) return false;
  }
  return true;
}

/**
 * Self-collision check. The bar is bent only through its thickness, so it stays in one plane and
 * its width does not matter: seen from the side it is a strip as thick as the bar, and it collides
 * with itself where two pieces of that strip overlap.
 *
 * Pieces close to each other along the bar share material in a tight bend, so a pair counts only
 * when the bar between them is at least half a turn of the tightest possible bend long (π·T/2,
 * inner radius 0). A shorter piece of bar cannot come back onto itself.
 */
export function collisionIssues(bar: Busbar, path: BarPath): Issue[] {
  const T = bar.section.thickness;
  const origin = path.samples[0];
  const pieces: Piece[] = [];
  for (let k = 1; k < path.samples.length; k++) {
    const a = path.samples[k - 1];
    const b = path.samples[k];
    const d = b.p.clone().sub(a.p);
    const length = d.length();
    if (length < 1e-6) continue;
    const mid = a.p.clone().add(b.p).multiplyScalar(0.5).sub(origin.p);
    pieces.push({
      cx: mid.dot(origin.t),
      cy: mid.dot(origin.n),
      ux: d.dot(origin.t) / length,
      uy: d.dot(origin.n) / length,
      halfLength: length / 2,
      s0: a.s,
      s1: b.s,
      step: b.stepIndex,
    });
  }

  // Slightly thinner than the bar: faces that only touch are not a collision.
  const halfThickness = (T * 0.98) / 2;
  const minAlong = (Math.PI * T) / 2;
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i];
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j];
      if (b.s0 - a.s1 < minAlong) continue;
      const reach = a.halfLength + b.halfLength + T;
      if (Math.abs(b.cx - a.cx) > reach || Math.abs(b.cy - a.cy) > reach) continue;
      if (piecesOverlap(a, b, halfThickness)) {
        return [
          {
            level: 'error',
            code: 'collision',
            stepIndex: b.step,
            message: 'Szyna koliduje sama ze sobą – zmień długości lub kierunki gięć.',
          },
        ];
      }
    }
  }
  return [];
}

/**
 * Where a leg dimension is measured from and to, in 3D, for the project's dimension mode.
 * At a bend the reference point is the virtual sharp of the chosen surface (outside / inside face
 * or centre line), i.e. the corner the faces would make without the bend radius. At a free end it
 * is the end face. `from`/`to` lie in the bend plane through the bar axis (w = 0).
 */
export interface LegDimension {
  stepIndex: number;
  from: Vector3;
  to: Vector3;
  /** Leg direction (unit). */
  dir: Vector3;
  /** Unit vector in the bend plane, perpendicular to the leg, pointing away from the bends' centres. */
  outward: Vector3;
  /** Distance from `from` to `to` measured along the leg = the dimension. */
  length: number;
  /**
   * Construction lines from the end of the real face (tangent point) to a virtual sharp, for each
   * bend end of the leg — shows that the dimension goes to the corner the faces would make.
   */
  construction: [Vector3, Vector3][];
}

export function legDimensions(bar: Busbar, path: BarPath): LegDimension[] {
  const T = bar.section.thickness;
  const e = bar.dimensionMode === 'outside' ? -T / 2 : bar.dimensionMode === 'inside' ? T / 2 : 0;
  const steps = bar.steps;

  // Virtual sharp of every valid bend, and the offset of its reference surface (towards the centre = +).
  const sharp = new Map<number, { v: Vector3; faceIn: Vector3; faceOut: Vector3 }>();
  steps.forEach((s, j) => {
    if (s.kind !== 'bend' || !(s.angle > 0 && s.angle < 180)) return;
    const [a, b] = path.stepRanges[j];
    const f0 = path.samples[a];
    const f1 = path.samples[b];
    const toCentre0 = dirVector(f0, s.direction);
    const toCentre1 = dirVector(f1, s.direction);
    const rc = s.radius + T / 2;
    const off = toCentre0.clone().multiplyScalar(e);
    const faceIn = f0.p.clone().add(off); // reference surface at the tangent point before the bend
    const v = faceIn.clone().addScaledVector(f0.t, (rc - e) * Math.tan(deg2rad(s.angle) / 2));
    const faceOut = f1.p.clone().addScaledVector(toCentre1, e); // ... and after the bend
    sharp.set(j, { v, faceIn, faceOut });
  });

  const out: LegDimension[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== 'straight') return;
    const [a] = path.stepRanges[i];
    const f = path.samples[a];
    const prev = sharp.get(i - 1);
    const next = sharp.get(i + 1);
    const dir = f.t.clone();
    // Free ends use the reference surface of the bend at the other end of the leg (in this leg's frame).
    const adjBend = steps[i - 1]?.kind === 'bend' ? steps[i - 1] : steps[i + 1];
    const endOffset = adjBend && adjBend.kind === 'bend' ? dirVector(f, adjBend.direction).multiplyScalar(e) : new Vector3();
    const from = prev ? prev.v.clone() : f.p.clone().add(endOffset);
    const to = next ? next.v.clone() : path.samples[path.stepRanges[i][1]].p.clone().add(endOffset);
    const outward = adjBend && adjBend.kind === 'bend' ? dirVector(f, adjBend.direction).negate() : f.n.clone().negate();
    const construction: [Vector3, Vector3][] = [];
    if (prev) construction.push([prev.faceOut.clone(), prev.v.clone()]);
    if (next) construction.push([next.faceIn.clone(), next.v.clone()]);
    out.push({ stepIndex: i, from, to, dir, outward, length: to.clone().sub(from).dot(dir), construction });
  });
  return out;
}
