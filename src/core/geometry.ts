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
          push(p, base.t.clone().applyQuaternion(q), base.n.clone().applyQuaternion(q), base.w.clone().applyQuaternion(q), i, rc * dTheta);
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
  const c = (a: number, b: number) => s.p.clone().addScaledVector(s.w, a * hw).addScaledVector(s.n, b * ht);
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

/**
 * Rough self-collision check: centerline points far apart along the bar that come closer
 * than the smaller section dimension certainly overlap.
 */
export function collisionIssues(bar: Busbar, path: BarPath): Issue[] {
  const { width, thickness } = bar.section;
  const minDim = Math.min(width, thickness);
  const total = path.samples[path.samples.length - 1].s;
  if (total <= 0) return [];
  const spacing = Math.max(2, total / 800);
  const pts: { p: Vector3; s: number; step: number }[] = [];
  for (let k = 1; k < path.samples.length; k++) {
    const a = path.samples[k - 1];
    const b = path.samples[k];
    const ds = b.s - a.s;
    const n = Math.max(1, Math.ceil(ds / spacing));
    for (let j = 0; j < n; j++) {
      pts.push({ p: a.p.clone().lerp(b.p, j / n), s: a.s + (ds * j) / n, step: b.stepIndex });
    }
  }
  const last = path.samples[path.samples.length - 1];
  pts.push({ p: last.p.clone(), s: last.s, step: last.stepIndex });

  const minSeparation = 2 * Math.max(width, thickness) + minDim;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j].s - pts[i].s < minSeparation) continue;
      if (pts[i].p.distanceTo(pts[j].p) < minDim) {
        return [
          {
            level: 'error',
            stepIndex: pts[j].step,
            message: 'Szyna koliduje sama ze sobą – zmień długości lub kierunki gięć.',
          },
        ];
      }
    }
  }
  return [];
}
