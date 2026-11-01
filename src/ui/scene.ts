import * as THREE from 'three';
import { holeGap, type HoleInfo } from '../core/analyze';
import type { BarPart } from '../core/assembly';
import { sectionCorners, type BarPath } from '../core/geometry';
import type { Busbar } from '../core/model';

export const COPPER = new THREE.Color('#c87533');
export const COPPER_2 = new THREE.Color('#a9612f');
const HOLE_COLOR = '#24150a';
export const COPPER_SELECTED = new THREE.Color('#ffcf6e');
export const COPPER_ERROR = new THREE.Color('#d9534f');
export const START_COLOR = new THREE.Color('#2ecc71');

export interface BarObject {
  group: THREE.Group;
  mesh: THREE.Mesh;
  /** stepIndex for every triangle of mesh (index = faceIndex). */
  triangleStep: number[];
  dispose: () => void;
}

/** Build the solid busbar mesh + edges from a path. */
export function buildBarObject(
  bar: Busbar,
  path: BarPath,
  opts: { selected?: number | null; errorSteps?: Set<number>; color?: THREE.Color; holes?: HoleInfo[] } = {},
): BarObject {
  const { width: W, thickness: T } = bar.section;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const triangleStep: number[] = [];
  const rings = path.samples.map((s) => sectionCorners(s, W, T));

  const colorFor = (step: number) =>
    opts.selected === step ? COPPER_SELECTED : opts.errorSteps?.has(step) ? COPPER_ERROR : (opts.color ?? COPPER);

  // Faces: [cornerA, cornerB, normal getter]
  const faces: [number, number, (k: number) => THREE.Vector3][] = [
    [0, 1, (k) => path.samples[k].n], // top (+n)
    [1, 2, (k) => path.samples[k].w], // right (+w)
    [2, 3, (k) => path.samples[k].n.clone().negate()], // bottom
    [3, 0, (k) => path.samples[k].w.clone().negate()], // left
  ];

  const pushV = (v: THREE.Vector3, nrm: THREE.Vector3, c: THREE.Color) => {
    positions.push(v.x, v.y, v.z);
    normals.push(nrm.x, nrm.y, nrm.z);
    colors.push(c.r, c.g, c.b);
  };

  /** Push a triangle, fixing its winding so that it faces along `facing`. */
  const pushTri = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    na: THREE.Vector3,
    nb: THREE.Vector3,
    nc: THREE.Vector3,
    facing: THREE.Vector3,
    col: THREE.Color,
    step: number,
  ) => {
    const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (cross.dot(facing) < 0) [b, c, nb, nc] = [c, b, nc, nb];
    pushV(a, na, col);
    pushV(b, nb, col);
    pushV(c, nc, col);
    triangleStep.push(step);
  };

  // Holes that lie fully inside a straight segment are cut through the solid; others (invalid
  // positions, reported as errors) are only marked with a decal.
  const cutHoles = new Map<number, HoleInfo[]>();
  const decalHoles: HoleInfo[] = [];
  for (const h of opts.holes ?? []) {
    const range = path.stepRanges[h.stepIndex];
    const len = range ? path.samples[range[1]].s - path.samples[range[0]].s : 0;
    const fits =
      range &&
      range[1] - range[0] === 1 &&
      h.diameter > 0 &&
      h.posOnStraight - h.length / 2 > 0.01 &&
      h.posOnStraight + h.length / 2 < len - 0.01 &&
      Math.abs(h.offset) + h.diameter / 2 < W / 2 - 0.01;
    const overlaps = (opts.holes ?? []).some((o) => o !== h && o.stepIndex === h.stepIndex && holeGap(o, h) <= 0.01);
    if (fits && !overlaps) cutHoles.set(h.stepIndex, [...(cutHoles.get(h.stepIndex) ?? []), h]);
    else decalHoles.push(h);
  }
  const holeEdgePts: number[] = [];

  /** Top (+1) or bottom (−1) face of a straight strip with holes cut out, plus the hole walls. */
  const cutFace = (k: number, side: 1 | -1, holes: HoleInfo[], col: THREE.Color, step: number) => {
    const f = path.samples[k - 1];
    const len = path.samples[k].s - f.s;
    const to3 = (x: number, y: number, z: number) =>
      f.p.clone().addScaledVector(f.t, x).addScaledVector(f.w, y).addScaledVector(f.n, z);
    const nrm = side === 1 ? f.n.clone() : f.n.clone().negate();
    const contour = [
      new THREE.Vector2(0, -W / 2),
      new THREE.Vector2(len, -W / 2),
      new THREE.Vector2(len, W / 2),
      new THREE.Vector2(0, W / 2),
    ];
    const outlines = holes.map((h) => holeOutline(h.posOnStraight, h.offset, h.length, h.diameter));
    // Contour counter-clockwise, holes clockwise; the same arrays index the result.
    const holePaths = outlines.map((o) => [...o].reverse());
    const tris = THREE.ShapeUtils.triangulateShape(contour, holePaths);
    const all = [...contour, ...holePaths.flat()];
    const z = (side * T) / 2;
    for (const [i0, i1, i2] of tris) {
      const a = to3(all[i0].x, all[i0].y, z);
      const b = to3(all[i1].x, all[i1].y, z);
      const c = to3(all[i2].x, all[i2].y, z);
      pushTri(a, b, c, nrm, nrm, nrm, nrm, col, step);
    }
    if (side !== 1) return;
    // Walls (once per hole, through the whole thickness) and outline edges on both faces.
    holes.forEach((h, hi) => {
      const o = outlines[hi];
      const half = Math.max(0, h.length / 2 - h.diameter / 2);
      const wallNormal = (p: THREE.Vector2) => {
        const ax = Math.min(Math.max(p.x, h.posOnStraight - half), h.posOnStraight + half);
        const dx = ax - p.x;
        const dy = h.offset - p.y;
        const l = Math.hypot(dx, dy) || 1;
        return f.t
          .clone()
          .multiplyScalar(dx / l)
          .addScaledVector(f.w, dy / l);
      };
      for (let i = 0; i < o.length; i++) {
        const p = o[i];
        const q = o[(i + 1) % o.length];
        const pt = to3(p.x, p.y, T / 2);
        const qt = to3(q.x, q.y, T / 2);
        const pb = to3(p.x, p.y, -T / 2);
        const qb = to3(q.x, q.y, -T / 2);
        const np = wallNormal(p);
        const nq = wallNormal(q);
        const facing = np.clone().add(nq);
        pushTri(pt, qt, qb, np, nq, nq, facing, col, step);
        pushTri(pt, qb, pb, np, nq, np, facing, col, step);
        holeEdgePts.push(pt.x, pt.y, pt.z, qt.x, qt.y, qt.z, pb.x, pb.y, pb.z, qb.x, qb.y, qb.z);
      }
    });
  };

  for (let k = 1; k < path.samples.length; k++) {
    const step = path.samples[k].stepIndex;
    const col = colorFor(step);
    const holesHere = cutHoles.get(step);
    for (const [a, b, nf] of faces) {
      if (holesHere && (a === 0 || a === 2)) {
        cutFace(k, a === 0 ? 1 : -1, holesHere, col, step);
        continue;
      }
      const p0 = rings[k - 1][a];
      const p1 = rings[k - 1][b];
      const p2 = rings[k][b];
      const p3 = rings[k][a];
      const n0 = nf(k - 1);
      const n1 = nf(k);
      // two triangles: p0 p1 p2, p0 p2 p3 (counter-clockwise seen from outside)
      pushV(p0, n0, col);
      pushV(p1, n0, col);
      pushV(p2, n1, col);
      pushV(p0, n0, col);
      pushV(p2, n1, col);
      pushV(p3, n1, col);
      triangleStep.push(step, step);
    }
  }

  // End caps
  const cap = (k: number, normal: THREE.Vector3, col: THREE.Color, step: number, flip: boolean) => {
    const r = rings[k];
    const tri = flip ? [r[0], r[2], r[1], r[0], r[3], r[2]] : [r[0], r[1], r[2], r[0], r[2], r[3]];
    for (const v of tri) pushV(v, normal, col);
    triangleStep.push(step, step);
  };
  const first = path.samples[0];
  const last = path.samples[path.samples.length - 1];
  cap(0, first.t.clone().negate(), START_COLOR, 0, true);
  cap(path.samples.length - 1, last.t, colorFor(last.stepIndex), last.stepIndex, false);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.35,
    roughness: 0.45,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mesh = new THREE.Mesh(geom, mat);

  // Edges: 4 longitudinal corner lines + rings at step boundaries.
  const edgePts: number[] = [];
  for (let c = 0; c < 4; c++) {
    for (let k = 1; k < rings.length; k++) {
      const a = rings[k - 1][c];
      const b = rings[k][c];
      edgePts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const boundaryIdx = new Set<number>();
  for (const [a, b] of path.stepRanges) {
    boundaryIdx.add(a);
    boundaryIdx.add(b);
  }
  for (const k of boundaryIdx) {
    const r = rings[k];
    for (let c = 0; c < 4; c++) {
      const a = r[c];
      const b = r[(c + 1) % 4];
      edgePts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  edgePts.push(...holeEdgePts);
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
  const edgeMat = new THREE.LineBasicMaterial({ color: '#3b2210' });
  const edges = new THREE.LineSegments(edgeGeom, edgeMat);

  const group = new THREE.Group();
  group.add(mesh, edges);

  // Holes that could not be cut (invalid position): dark decals on both faces of the bar.
  const holeMat = new THREE.MeshBasicMaterial({
    color: HOLE_COLOR,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const holeGeoms: THREE.BufferGeometry[] = [];
  for (const h of decalHoles) {
    const range = path.stepRanges[h.stepIndex];
    if (!range) continue;
    const f = path.samples[range[0]];
    const g = new THREE.ShapeGeometry(slotShape(h.length, h.diameter), 24);
    holeGeoms.push(g);
    for (const sign of [1, -1]) {
      const m = new THREE.Mesh(g, holeMat);
      const pos = f.p
        .clone()
        .addScaledVector(f.t, h.posOnStraight)
        .addScaledVector(f.w, h.offset)
        .addScaledVector(f.n, sign * (T / 2 + 0.05));
      m.matrixAutoUpdate = false;
      m.matrix.makeBasis(f.t, f.w, f.n).setPosition(pos);
      m.userData.stepIndex = h.stepIndex;
      group.add(m);
    }
  }

  return {
    group,
    mesh,
    triangleStep,
    dispose: () => {
      geom.dispose();
      mat.dispose();
      edgeGeom.dispose();
      edgeMat.dispose();
      holeMat.dispose();
      holeGeoms.forEach((g) => g.dispose());
    },
  };
}

/**
 * Outline of a round hole or slot in strip coordinates (x along the bar, y across),
 * counter-clockwise, without the closing point.
 */
export function holeOutline(cx: number, cy: number, length: number, diameter: number, segments = 40): THREE.Vector2[] {
  const r = diameter / 2;
  const half = Math.max(0, length / 2 - r);
  const pts: THREE.Vector2[] = [];
  if (half <= 0) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    return pts;
  }
  const n = Math.max(8, Math.round(segments / 2));
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI; // right cap
    pts.push(new THREE.Vector2(cx + half + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (i / n) * Math.PI; // left cap
    pts.push(new THREE.Vector2(cx - half + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}

/** Round hole (length ≤ diameter) or slot, centred at origin, length along X. */
export function slotShape(length: number, diameter: number): THREE.Shape {
  const r = diameter / 2;
  const half = Math.max(0, length / 2 - r);
  const s = new THREE.Shape();
  if (half <= 0) {
    s.absarc(0, 0, r, 0, Math.PI * 2, false);
    return s;
  }
  s.moveTo(-half, -r);
  s.lineTo(half, -r);
  s.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-half, r);
  s.absarc(-half, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return s;
}

/** Build the 3D objects of all parts of an assembly. */
export function buildPartObjects(
  parts: BarPart[],
  opts: { selected?: number | null; errorSteps?: Set<number> } = {},
): BarObject[] {
  return parts.map((part) => {
    const o = buildBarObject(part.bar, part.path, {
      ...opts,
      color: part.index === 2 ? COPPER_2 : COPPER,
      holes: part.analysis.holes,
    });
    o.group.position.y = part.offset;
    o.group.updateMatrixWorld(true);
    return o;
  });
}

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#ffffff', '#555566', 1.6));
  const d1 = new THREE.DirectionalLight('#ffffff', 1.6);
  d1.position.set(1, 2, 1.5);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight('#ffffff', 0.6);
  d2.position.set(-1.5, -0.5, -1);
  scene.add(d2);
}

export type ViewName = 'iso' | 'front' | 'top' | 'side';

export const VIEW_DIRS: Record<ViewName, { dir: THREE.Vector3; up: THREE.Vector3 }> = {
  iso: { dir: new THREE.Vector3(1, 0.8, 1.2).normalize(), up: new THREE.Vector3(0, 1, 0) },
  front: { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  top: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  side: { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
};

/** Place an orthographic camera to look at the box from a given view direction. */
export function fitOrtho(
  cam: THREE.OrthographicCamera,
  box: THREE.Box3,
  view: ViewName | { dir: THREE.Vector3; up: THREE.Vector3 },
  aspect: number,
  target?: THREE.Vector3,
) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10);
  const { dir, up } = typeof view === 'string' ? VIEW_DIRS[view] : view;
  cam.up.copy(up);
  cam.position.copy(center).addScaledVector(dir, radius * 4);
  cam.near = 0.1;
  cam.far = radius * 10;
  const h = radius * 1.25;
  cam.left = -h * aspect;
  cam.right = h * aspect;
  cam.top = h;
  cam.bottom = -h;
  cam.zoom = 1;
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  target?.copy(center);
}

/** Render an off-screen isometric picture of the bar (for the printout). */
export function renderSnapshot(parts: BarPart[], bbox: THREE.Box3, width = 1200, height = 800): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setSize(width, height, false);
  renderer.setClearColor('#ffffff');
  const scene = new THREE.Scene();
  addLights(scene);
  const objs = buildPartObjects(parts);
  objs.forEach((o) => scene.add(o.group));
  const cam = new THREE.OrthographicCamera();
  fitOrtho(cam, bbox, 'iso', width / height);
  cam.zoom = 1.6;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  objs.forEach((o) => o.dispose());
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
