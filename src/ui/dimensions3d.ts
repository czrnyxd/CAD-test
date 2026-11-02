import * as THREE from 'three';
import type { LegDimension } from '../core/geometry';

const DIM_COLOR = '#1f5fbf';
const REF_COLOR = '#e8590c';
const CONSTRUCTION_COLOR = '#7b8794';

/**
 * Draw a leg dimension like on a technical drawing, in the front plane of the bar (w = +W/2):
 * extension lines from the two reference points, a dimension line with arrows, reference point
 * markers and dashed construction lines from the faces to the virtual sharp corners.
 * Returns the point where the value label should go.
 */
export function addLegDimension(
  group: THREE.Group,
  d: LegDimension,
  opts: { width: number; spacing: number; highlight?: boolean },
): THREE.Vector3 {
  const front = new THREE.Vector3(0, 0, opts.width / 2 + 0.5);
  const from = d.from.clone().add(front);
  const to = d.to.clone().add(front);
  const across = Math.max(0, to.clone().sub(from).dot(d.outward));
  const k = across + opts.spacing;
  const d1 = from.clone().addScaledVector(d.outward, k);
  const d2 = from.clone().addScaledVector(d.dir, d.length).addScaledVector(d.outward, k);
  const overshoot = opts.spacing * 0.25;
  const color = opts.highlight ? '#1677ff' : DIM_COLOR;

  const lineMat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
  const segs = [
    // extension lines
    from,
    d1.clone().addScaledVector(d.outward, overshoot),
    to,
    d2.clone().addScaledVector(d.outward, overshoot),
    // dimension line
    d1,
    d2,
  ];
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), lineMat);
  lines.renderOrder = 6;
  group.add(lines);

  // Arrow heads.
  const a = Math.min(14, Math.max(4, opts.spacing * 0.4));
  const coneMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  for (const [p, dir] of [
    [d1, d.dir.clone().negate()],
    [d2, d.dir.clone()],
  ] as const) {
    if (d.length < a * 2.5) continue; // too short for arrows – keep the line only
    const cone = new THREE.Mesh(new THREE.ConeGeometry(a * 0.3, a, 12), coneMat);
    cone.position.copy(p).addScaledVector(dir, -a / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.renderOrder = 6;
    group.add(cone);
  }

  // Dashed construction lines: face extended to the virtual sharp.
  if (d.construction.length) {
    const pts = d.construction.flatMap(([p, q]) => [p.clone().add(front), q.clone().add(front)]);
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const dashed = new THREE.LineSegments(
      geom,
      new THREE.LineDashedMaterial({
        color: CONSTRUCTION_COLOR,
        dashSize: a * 0.6,
        gapSize: a * 0.4,
        depthTest: false,
        transparent: true,
      }),
    );
    dashed.computeLineDistances();
    dashed.renderOrder = 5;
    group.add(dashed);
  }

  // Reference points ("from here – to here").
  const dotMat = new THREE.MeshBasicMaterial({ color: REF_COLOR, depthTest: false, transparent: true });
  for (const p of [from, to]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(a * 0.4, 12, 8), dotMat);
    dot.position.copy(p);
    dot.renderOrder = 7;
    group.add(dot);
  }

  return d1.clone().lerp(d2, 0.5);
}
