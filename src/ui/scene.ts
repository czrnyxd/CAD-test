import * as THREE from 'three';
import { sectionCorners, type BarPath } from '../core/geometry';
import type { Busbar } from '../core/model';

export const COPPER = new THREE.Color('#c87533');
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
  opts: { selected?: number | null; errorSteps?: Set<number> } = {},
): BarObject {
  const { width: W, thickness: T } = bar.section;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const triangleStep: number[] = [];
  const rings = path.samples.map((s) => sectionCorners(s, W, T));

  const colorFor = (step: number) =>
    opts.selected === step ? COPPER_SELECTED : opts.errorSteps?.has(step) ? COPPER_ERROR : COPPER;

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

  for (let k = 1; k < path.samples.length; k++) {
    const step = path.samples[k].stepIndex;
    const col = colorFor(step);
    for (const [a, b, nf] of faces) {
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
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
  const edgeMat = new THREE.LineBasicMaterial({ color: '#3b2210' });
  const edges = new THREE.LineSegments(edgeGeom, edgeMat);

  const group = new THREE.Group();
  group.add(mesh, edges);
  return {
    group,
    mesh,
    triangleStep,
    dispose: () => {
      geom.dispose();
      mat.dispose();
      edgeGeom.dispose();
      edgeMat.dispose();
    },
  };
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
export function renderSnapshot(bar: Busbar, path: BarPath, width = 1200, height = 800): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setSize(width, height, false);
  renderer.setClearColor('#ffffff');
  const scene = new THREE.Scene();
  addLights(scene);
  const obj = buildBarObject(bar, path);
  scene.add(obj.group);
  const cam = new THREE.OrthographicCamera();
  fitOrtho(cam, path.bbox, 'iso', width / height);
  cam.zoom = 1.6;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  obj.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
