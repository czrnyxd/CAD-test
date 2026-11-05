import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { fmt, type Issue } from '../core/analyze';
import type { Assembly } from '../core/assembly';
import {
  PHASE_NAMES,
  barToCabinet,
  cabinetViewBox,
  frameParts,
  phaseShift,
  totalWidth,
  type CabinetCheck,
} from '../core/cabinet';
import { dirVector, keyPoints, legDimensions } from '../core/geometry';
import { DIMENSION_MODE_LABEL, DIRECTION_ARROW, type Busbar, type CabinetConfig } from '../core/model';
import { addLegDimension } from './dimensions3d';
import { Icon } from './Icon';
import { keyboardBusy } from './keys';
import { VIEW_DIRS, addLights, buildPartObjects, fitOrtho, type BarObject, type ViewName } from './scene';

interface Props {
  /** The project as edited (leg lengths shown in labels). */
  bar: Busbar;
  assembly: Assembly;
  selected: number | null;
  errorSteps: Set<number>;
  issues: Issue[];
  onSelect: (i: number | null) => void;
  /** Extra text in the footer under the model. */
  foot?: ReactNode;
  /** Reference cabinet to show around the bar (null = bar alone). */
  cabinet?: { cfg: CabinetConfig; check: CabinetCheck } | null;
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  barObjs: BarObject[];
  overlay: THREE.Group;
  grid: THREE.GridHelper;
  measureGroup: THREE.Group;
  /** Cabinet frame and its labels, placed in bar coordinates. */
  cabGroup: THREE.Group;
  /** The other phases (same shape, shifted across the width). */
  ghosts: BarObject[];
  render: () => void;
}

/** Kind of a snap point – shown by the marker shape (and in the legend). */
export type SnapKind = 'corner' | 'hole' | 'dim' | 'end';

/** A point the measuring tool snaps to, with a description shown to the user. */
interface SnapPoint {
  p: THREE.Vector3;
  label: string;
  kind: SnapKind;
}

const KIND_RANK: Record<SnapKind, number> = { corner: 0, end: 1, hole: 2, dim: 3 };

/** Merge points closer than `eps` (step boundaries share their corners). */
function dedupe(pts: SnapPoint[], eps = 0.5): SnapPoint[] {
  const out: SnapPoint[] = [];
  for (const q of pts) {
    const same = out.find((o) => o.p.distanceTo(q.p) < eps);
    if (!same) out.push(q);
    // A corner that is also a dimension reference point is described as the latter.
    else if (KIND_RANK[q.kind] > KIND_RANK[same.kind]) {
      same.label = q.label;
      same.kind = q.kind;
    }
  }
  return out;
}

function label(text: string, cls: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = `lbl ${cls}`;
  el.textContent = text;
  return new CSS2DObject(el);
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove();
    const anyO = o as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material };
    anyO.geometry?.dispose();
    anyO.material?.dispose();
  });
  g.clear();
}

/** SVG markup of one snap marker (constant size on screen, shape by kind). */
function markerSvg(kind: SnapKind, x: number, y: number, r: number, cls: string): string {
  const t = `transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"`;
  switch (kind) {
    case 'corner':
      return `<rect class="mk mk-corner ${cls}" ${t} x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" rx="1.5"/>`;
    case 'dim':
      return `<path class="mk mk-dim ${cls}" ${t} d="M0 ${-r * 1.3}L${r * 1.3} 0L0 ${r * 1.3}L${-r * 1.3} 0Z"/>`;
    case 'hole':
      return `<g class="mk mk-hole ${cls}" ${t}><circle r="${r}"/><path d="M${-r} 0H${r}M0 ${-r}V${r}"/></g>`;
    default:
      return `<circle class="mk mk-end ${cls}" ${t} r="${r}"/>`;
  }
}

const MARKER_R = 6.5; // ≈ 13 px markers
const SNAP_RADIUS = 60; // px – how far from the finger a tap still snaps
const LOUPE = 150; // px – loupe diameter
const LOUPE_ZOOM = 3;
const HOLD_MS = 300;
/** With more points than this, points hidden behind the bar are not drawn at all. */
const MANY_POINTS = 80;
/** Distance (mm) in front of a point the occlusion ray starts from – farther than any bar. */
const FAR = 100000;

const FRAME_COLOR = '#b9c2cc';
const FRAME_EDGE = '#7d8995';
const FRAME_HIT = '#d9534f';

/** Rebuild the cabinet frame, the other phases and the clearance line. */
function buildCabinet(
  c: Ctx,
  parts: Assembly['parts'],
  cab: { cfg: CabinetConfig; check: CabinetCheck } | null,
  fromCab: THREE.Matrix4 | null,
) {
  c.ghosts.forEach((o) => (c.scene.remove(o.group), o.dispose()));
  c.ghosts = [];
  disposeGroup(c.cabGroup);
  if (!cab || !fromCab) return;
  const { cfg, check } = cab;
  c.cabGroup.matrix.copy(fromCab);
  c.cabGroup.matrixWorldNeedsUpdate = true;

  // Frame: light, see-through boxes with outlined edges; parts the bar goes through are red.
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeom = new THREE.EdgesGeometry(unit);
  const hit = new Set(check.hits);
  frameParts(cfg).forEach((fp, i) => {
    const size = fp.box.getSize(new THREE.Vector3());
    const mat = new THREE.MeshStandardMaterial({
      color: hit.has(i) ? FRAME_HIT : FRAME_COLOR,
      transparent: true,
      opacity: hit.has(i) ? 0.75 : fp.kind === 'post' ? 0.5 : 0.3,
      depthWrite: false,
      metalness: 0.1,
      roughness: 0.8,
    });
    const m = new THREE.Mesh(unit, mat);
    m.scale.copy(size);
    fp.box.getCenter(m.position);
    const e = new THREE.LineSegments(edgeGeom, new THREE.LineBasicMaterial({ color: hit.has(i) ? FRAME_HIT : FRAME_EDGE }));
    e.scale.copy(size);
    e.position.copy(m.position);
    c.cabGroup.add(m, e);
  });
  const W = totalWidth(cfg);
  const band = check.bars;
  // Floor of the cabinet and the field names under the bars.
  const size = Math.ceil((Math.max(W, cfg.depth) + 400) / 100) * 100;
  const floor = new THREE.GridHelper(size, size / 100, '#b5bec8', '#d5dbe1');
  floor.position.set(W / 2, 0, cfg.depth / 2);
  c.cabGroup.add(floor);
  let x0 = 0;
  cfg.bays.forEach((bw, i) => {
    const l = label(cfg.bays.length > 1 ? `Pole ${i + 1} · ${fmt(bw)}` : `Szafa ${fmt(bw)} × ${fmt(cfg.depth)}`, 'lbl-cab');
    l.position.set(x0 + bw / 2, Math.max(0, band.min.y - 120), cfg.depth);
    c.cabGroup.add(l);
    x0 += bw;
  });

  // Other phases: the same bars shifted across the width, see-through. Phase names at end A.
  const phases = Math.max(1, Math.min(4, Math.round(cfg.phases)));
  for (let k = 0; k < phases; k++) {
    const shift = phaseShift(cfg, k);
    if (k > 0) {
      for (const o of buildPartObjects(parts)) {
        o.group.position.add(shift);
        o.group.traverse((x) => {
          const m = (x as THREE.Mesh).material as THREE.Material | undefined;
          if (!m) return;
          m.transparent = true;
          m.opacity = 0.45;
          m.depthWrite = false;
        });
        o.group.updateMatrixWorld(true);
        c.scene.add(o.group);
        c.ghosts.push(o);
      }
    }
    if (phases > 1) {
      const s0 = parts[0].path.samples[0];
      const l = label(PHASE_NAMES[k], 'lbl-phase');
      l.center.set(1.15, 0.5);
      l.position.copy(s0.p).add(shift);
      c.overlay.add(l);
    }
  }

  // Smallest gap to the frame (or the collision) as a dimension line.
  if (check.from && check.to) {
    const touching = check.clearance < 0.05;
    if (!touching) {
      const g = new THREE.BufferGeometry().setFromPoints([check.from, check.to]);
      const line = new THREE.Line(
        g,
        new THREE.LineDashedMaterial({ color: '#0b5cd5', dashSize: 6, gapSize: 4, depthTest: false }),
      );
      line.computeLineDistances();
      line.renderOrder = 9;
      c.cabGroup.add(line);
    }
    const l = label(touching ? 'Kolizja z ramą' : `${fmt(check.clearance)} mm od ramy`, touching ? 'lbl-error' : 'lbl-gap');
    // At the frame end of the line, so it does not cover the labels of the bar.
    l.position.copy(check.to);
    l.center.set(0.5, 1.3);
    c.cabGroup.add(l);
  }
  c.cabGroup.updateMatrixWorld(true);
}

const VIEWS: [ViewName, string][] = [
  ['iso', 'ISO'],
  ['front', 'Przód'],
  ['top', 'Góra'],
  ['side', 'Bok'],
];

export function Viewer3D({ bar, assembly, selected, errorSteps, issues, onSelect, foot, cabinet }: Props) {
  const part1 = assembly.parts[0];
  const { path, analysis } = part1;
  /** Cabinet → bar coordinates, and the rotation part of bar → cabinet (for the view directions). */
  const toCab = cabinet ? barToCabinet(cabinet.cfg) : null;
  const fromCab = toCab ? toCab.clone().invert() : null;
  // With the cabinet: fit the bars together with the frame around them.
  const bbox = cabinet && fromCab ? cabinetViewBox(cabinet.cfg, cabinet.check.bars).applyMatrix4(fromCab) : assembly.bbox;
  /** View direction; with the cabinet the views are those of the cabinet (front = from the doors). */
  const viewDir = (v: ViewName) => {
    const d = VIEW_DIRS[v];
    if (!fromCab) return d;
    const r = new THREE.Matrix3().setFromMatrix4(fromCab);
    return { dir: d.dir.clone().applyMatrix3(r).normalize(), up: d.up.clone().applyMatrix3(r).normalize() };
  };
  const hostRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<SVGSVGElement>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const loupeSvgRef = useRef<SVGSVGElement>(null);
  const loupeTextRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const [measure, setMeasure] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [view, setViewName] = useState<ViewName | null>('iso');
  const [points, setPoints] = useState<SnapPoint[]>([]);
  /** Snap candidates near the last tap, to switch the last point to a neighbouring one. */
  const [cand, setCand] = useState<{ list: SnapPoint[]; idx: number } | null>(null);
  const fittedFor = useRef<string | null>(null);
  const keyPts = useRef<SnapPoint[]>([]);
  /** Which snap points are hidden behind the bar (recomputed when the view stops moving). */
  const occluded = useRef<boolean[]>([]);
  /** Marker state read by the render loop (refs, so rendering does not need React). */
  const markState = useRef<{ on: boolean; chosen: SnapPoint[]; hot: SnapPoint | null }>({ on: false, chosen: [], hot: null });

  // A measurement belongs to the shape it was taken on – clear it when the bar changes.
  useEffect(() => {
    setPoints([]);
    setCand(null);
  }, [assembly]);

  /** Screen position (px, relative to the canvas) of a 3D point. */
  const toScreen = (p: THREE.Vector3) => {
    const c = ctxRef.current!;
    const el = c.renderer.domElement;
    const v = p.clone().project(c.camera);
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight, z: v.z };
  };

  /** Redraw the snap markers (SVG on top of the canvas). Called after every render. */
  const drawMarkers = () => {
    const svg = markRef.current;
    const c = ctxRef.current;
    if (!svg || !c) return;
    const st = markState.current;
    if (!st.on) {
      svg.innerHTML = '';
      return;
    }
    const pts = keyPts.current;
    const many = pts.length > MANY_POINTS;
    let html = '';
    pts.forEach((q, i) => {
      const hidden = occluded.current[i];
      if (hidden && many) return;
      const s = toScreen(q.p);
      html += markerSvg(q.kind, s.x, s.y, MARKER_R, hidden ? 'is-behind' : '');
    });
    for (const q of st.chosen) {
      const s = toScreen(q.p);
      html += markerSvg(q.kind, s.x, s.y, MARKER_R * 1.6, 'is-chosen');
    }
    if (st.hot) {
      const s = toScreen(st.hot.p);
      html += `<circle class="mk-hot" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${MARKER_R * 2.6}"/>`;
    }
    svg.innerHTML = html;
  };
  const drawMarkersRef = useRef(drawMarkers);
  drawMarkersRef.current = drawMarkers;

  /** Find which snap points are behind the bar, by casting a ray from each point towards the camera. */
  const updateOcclusion = () => {
    const c = ctxRef.current;
    if (!c) return;
    const meshes = c.barObjs.map((o) => o.mesh);
    const toCam = new THREE.Vector3(0, 0, 1).applyQuaternion(c.camera.quaternion);
    const ray = new THREE.Raycaster();
    occluded.current = keyPts.current.map((q) => {
      // From the camera side towards the point (front faces are hit), hidden when something is in front of it.
      ray.set(q.p.clone().addScaledVector(toCam, FAR), toCam.clone().negate());
      const hit = ray.intersectObjects(meshes, false)[0];
      return !!hit && hit.distance < FAR - 0.3;
    });
  };
  const occlusionRef = useRef(updateOcclusion);
  occlusionRef.current = updateOcclusion;

  // Init renderer once.
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#eef1f4');
    renderer.domElement.className = 'viewer-gl';
    host.prepend(renderer.domElement);
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = 'label-layer';
    renderer.domElement.after(labelRenderer.domElement);

    const scene = new THREE.Scene();
    addLights(scene);
    const grid = new THREE.GridHelper(4000, 80, '#b5bec8', '#d5dbe1');
    grid.position.y = -0.01;
    scene.add(grid);
    const overlay = new THREE.Group();
    const measureGroup = new THREE.Group();
    const cabGroup = new THREE.Group();
    cabGroup.matrixAutoUpdate = false;
    scene.add(overlay, measureGroup, cabGroup);

    const camera = new THREE.OrthographicCamera();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.zoomToCursor = true;

    const render = () => {
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      drawMarkersRef.current();
    };
    let moved = false;
    controls.addEventListener('change', () => {
      moved = true;
      render();
    });
    controls.addEventListener('start', () => (moved = false));
    controls.addEventListener('end', () => {
      if (!moved) return;
      setViewName(null);
      occlusionRef.current();
      drawMarkersRef.current();
    });

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      const aspect = w / h;
      const halfH = (camera.top - camera.bottom) / 2 || 100;
      camera.left = -halfH * aspect;
      camera.right = halfH * aspect;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    ctxRef.current = {
      renderer,
      labelRenderer,
      scene,
      camera,
      controls,
      barObjs: [],
      overlay,
      grid,
      measureGroup,
      cabGroup,
      ghosts: [],
      render,
    };
    fittedFor.current = null; // a new renderer has a fresh camera: fit it to the part
    resize();
    return () => {
      ro.disconnect();
      controls.dispose();
      ctxRef.current?.barObjs.forEach((o) => o.dispose());
      ctxRef.current?.ghosts.forEach((o) => o.dispose());
      disposeGroup(overlay);
      disposeGroup(cabGroup);
      disposeGroup(measureGroup);
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
      ctxRef.current = null;
    };
  }, []);

  /** Fit the whole part; with no view given keep the current viewing direction. */
  const setView = (v?: ViewName) => {
    const c = ctxRef.current;
    if (!c) return;
    const el = hostRef.current!;
    const dirView = v
      ? viewDir(v)
      : {
          dir: c.camera.position.clone().sub(c.controls.target).normalize(),
          up: c.camera.up.clone(),
        };
    fitOrtho(c.camera, bbox, dirView, el.clientWidth / Math.max(1, el.clientHeight), c.controls.target);
    c.controls.update();
    if (v) setViewName(v);
    updateOcclusion();
    c.render();
  };

  /** True when some corner of the bounding box is outside the current view. */
  const outOfView = () => {
    const c = ctxRef.current;
    if (!c) return false;
    c.camera.updateMatrixWorld();
    const { min, max } = bbox;
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          const v = new THREE.Vector3(x, y, z).project(c.camera);
          if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) return true;
        }
    return false;
  };

  // Rebuild bar when the model changes.
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    c.barObjs.forEach((o) => (c.scene.remove(o.group), o.dispose()));
    c.barObjs = buildPartObjects(assembly.parts, { selected, errorSteps });
    c.barObjs.forEach((o) => c.scene.add(o.group));
    // Keep the floor grid just below the part so it never cuts through it (the cabinet has its own floor).
    c.grid.position.y = assembly.bbox.min.y - 1;
    c.grid.visible = !cabinet;
    // Snap points for measuring: section corners and hole centres (both faces) of every bar.
    const { width: W, thickness: T } = bar.section;
    keyPts.current = dedupe(
      assembly.parts.flatMap((part) => {
        const shift = new THREE.Vector3(0, part.offset, 0);
        const name = assembly.parts.length > 1 ? ` (szyna ${part.index})` : '';
        const all = keyPoints(part.path, W, T);
        const ends = all.slice(-2);
        const pts: SnapPoint[] = all.slice(0, -2).map((p) => ({ p, label: `Narożnik${name}`, kind: 'corner' }));
        ends.forEach((p, k) => pts.push({ p, label: `Środek końca ${k === 0 ? 'A' : 'B'}${name}`, kind: 'end' }));
        for (const h of part.analysis.holes) {
          const f = part.path.samples[part.path.stepRanges[h.stepIndex][0]];
          const c0 = f.p.clone().addScaledVector(f.t, h.posOnStraight).addScaledVector(f.w, h.offset);
          for (const side of [1, -1])
            pts.push({
              p: c0.clone().addScaledVector(f.n, (side * T) / 2),
              label: `Środek otworu O${h.no}${name}`,
              kind: 'hole',
            });
        }
        // Reference points of the leg dimensions (sharp corners), on both side faces.
        if (part.index === 1) {
          for (const d of legDimensions(part.bar, part.path)) {
            for (const z of [W / 2, -W / 2]) {
              for (const p of [d.from, d.to])
                pts.push({ p: p.clone().add(new THREE.Vector3(0, 0, z)), label: 'Punkt wymiaru (ostry narożnik)', kind: 'dim' });
            }
          }
        }
        return pts.map((q) => ({ ...q, p: q.p.add(shift) }));
      }),
    );

    // Overlay: dimension labels and the direction arrow of the selected bend.
    disposeGroup(c.overlay);
    if (showDims) {
      // Leg dimensions drawn from / to the reference points of the dimension mode.
      const spacing = Math.min(120, Math.max(22, bbox.getSize(new THREE.Vector3()).length() * 0.08));
      for (const d of legDimensions(bar, path)) {
        const s = bar.steps[d.stepIndex];
        if (s.kind !== 'straight') continue;
        const at = addLegDimension(c.overlay, d, { width: bar.section.width, spacing, highlight: d.stepIndex === selected });
        const l = label(`${fmt(s.length)}`, d.stepIndex === selected ? 'lbl-sel' : 'lbl-dim');
        l.position.copy(at);
        c.overlay.add(l);
      }
      bar.steps.forEach((s, i) => {
        const [a, b] = path.stepRanges[i];
        if (s.kind === 'bend') {
          const midS = path.samples[Math.round((a + b) / 2)];
          const info = analysis.bends.find((x) => x.stepIndex === i);
          const l = label(
            `G${info?.no ?? '?'} ${fmt(s.angle)}° ${DIRECTION_ARROW[s.direction]}`,
            i === selected ? 'lbl-sel' : 'lbl-bend',
          );
          // Outside the arc, so it does not cover the dimension reference points at the corner.
          l.position.copy(midS.p).addScaledVector(dirVector(midS, s.direction), -(bar.section.thickness / 2 + spacing * 0.9));
          c.overlay.add(l);
        }
      });
      const double = assembly.parts.length > 1;
      for (const part of assembly.parts) {
        const s0 = part.path.samples[0];
        const start = label(double ? `A${part.index}` : 'A', 'lbl-start');
        // Bars are only one thickness apart: push the labels apart on screen (bar 2 above / below).
        if (double) {
          const otherOffset = assembly.parts.find((q) => q !== part)!.offset;
          const isUpper = part.offset > otherOffset;
          start.center.set(0.5, isUpper ? 1.15 : -0.15);
        }
        start.position
          .copy(s0.p)
          .addScaledVector(s0.t, -bar.section.width * 0.6)
          .add(new THREE.Vector3(0, part.offset, 0));
        c.overlay.add(start);
      }
      // Hole numbers matching the hole table (labels are drawn on top, one per hole).
      for (const h of part1.analysis.holes) {
        const f = path.samples[path.stepRanges[h.stepIndex][0]];
        const l = label(`O${h.no}`, 'lbl-hole');
        l.position
          .copy(f.p)
          .addScaledVector(f.t, h.posOnStraight)
          .addScaledVector(f.w, h.offset)
          .addScaledVector(f.n, bar.section.thickness / 2);
        l.center.set(-0.3, 1.6); // beside and above the hole, clear of the leg dimension label
        c.overlay.add(l);
      }
    }
    // Errors are always shown on the model, next to the step they belong to.
    for (const step of errorSteps) {
      const range = path.stepRanges[step];
      const msg = issues.find((x) => x.level === 'error' && x.stepIndex === step)?.message;
      if (!range || !msg) continue;
      const mid = path.samples[Math.round((range[0] + range[1]) / 2)];
      const l = label(msg.replace(/^Szyna \d: /, ''), 'lbl-error');
      l.position.copy(mid.p);
      l.center.set(0.5, -0.4);
      c.overlay.add(l);
    }
    if (selected !== null && bar.steps[selected]?.kind === 'bend') {
      const s = bar.steps[selected];
      if (s.kind === 'bend') {
        const f = path.samples[path.stepRanges[selected][0]];
        const dir = dirVector(f, s.direction);
        const len = Math.max(60, bar.section.width * 2);
        const arrow = new THREE.ArrowHelper(dir.clone().normalize(), f.p, len, '#0b5cd5', len * 0.3, len * 0.18);
        arrow.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m) m.depthTest = false;
          o.renderOrder = 5;
        });
        c.overlay.add(arrow);
      }
    }

    buildCabinet(c, assembly.parts, cabinet ?? null, fromCab);

    // Fit the camera when a different project is opened.
    const fitKey = `${bar.id}:${assembly.parts.length}:${cabinet ? 'cab' : ''}`;
    const [prevId, , prevCab] = fittedFor.current?.split(':') ?? [];
    if (prevId !== bar.id || prevCab !== (cabinet ? 'cab' : '')) {
      fittedFor.current = fitKey;
      setView('iso');
    } else if (fittedFor.current !== fitKey) {
      // Switched between single and double bar: fit the new set of bars, keep the viewing direction.
      fittedFor.current = fitKey;
      setView();
    } else if (outOfView()) {
      setView();
    }
    updateOcclusion();
    c.render();
  }, [bar, assembly, selected, errorSteps, issues, showDims, cabinet]);

  // Measurement visuals: the line and its value (the point markers are drawn as SVG on top).
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    disposeGroup(c.measureGroup);
    markState.current.on = measure;
    markState.current.chosen = measure ? points : [];
    if (measure && points.length === 2) {
      const g = new THREE.BufferGeometry().setFromPoints(points.map((q) => q.p));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#0b5cd5', depthTest: false }));
      line.renderOrder = 11;
      c.measureGroup.add(line);
      const l = label(`${fmt(points[0].p.distanceTo(points[1].p))} mm`, 'lbl-measure');
      l.position.copy(points[0].p).lerp(points[1].p, 0.5);
      c.measureGroup.add(l);
    }
    c.render();
  }, [measure, points, assembly]);

  // Pointer handling: tap selects a step (or a measuring point); in measuring mode a long press opens the loupe.
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    const el = c.renderer.domElement;
    let down: { x: number; y: number; id: number } | null = null;
    let holdTimer = 0;
    let loupe: { renderer: THREE.WebGLRenderer; cam: THREE.OrthographicCamera } | null = null;
    let looping = false;
    let holding = false;
    let pick: SnapPoint | null = null;
    let finger = { x: 0, y: 0, w: 1, h: 1 };
    const pointers = new Set<number>();

    const local = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
    };

    /** Snap points near (x, y) on screen, nearest first; points in front win over hidden ones. */
    const nearby = (x: number, y: number, radius: number) =>
      keyPts.current
        .map((q, i) => {
          const s = toScreen(q.p);
          return { q, d: Math.hypot(s.x - x, s.y - y), behind: occluded.current[i] ? 12 : 0, depth: s.z };
        })
        .filter((o) => o.d < radius)
        .sort((a, b) => a.d + a.behind - (b.d + b.behind) || a.depth - b.depth)
        .map((o) => o.q);

    const choose = (list: SnapPoint[]) => {
      if (!list.length) return;
      setPoints((pts) => (pts.length >= 2 ? [list[0]] : [...pts, list[0]]));
      setCand({ list, idx: 0 });
    };

    // ---- loupe: the same scene rendered by a second, small renderer, zoomed around the finger ----
    const loupeEl = loupeRef.current!;
    const ensureLoupe = () => {
      if (loupe) return loupe;
      const r = new THREE.WebGLRenderer({ antialias: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      r.setClearColor('#eef1f4');
      r.setSize(LOUPE, LOUPE);
      r.domElement.className = 'loupe-gl';
      loupeEl.prepend(r.domElement);
      loupe = { renderer: r, cam: new THREE.OrthographicCamera() };
      return loupe;
    };
    const drawLoupe = () => {
      looping = false;
      const l = loupe;
      if (!l || !holding) return;
      const { x, y, w, h } = finger;
      const src = LOUPE / LOUPE_ZOOM;
      l.cam.copy(c.camera);
      l.cam.setViewOffset(w, h, x - src / 2, y - src / 2, src, src);
      l.cam.updateProjectionMatrix();
      l.renderer.render(c.scene, l.cam);
      // Above the finger, clamped to the view; below it when there is no room above.
      let top = y - LOUPE - 70;
      if (top < 4) top = Math.min(h - LOUPE - 4, y + 70);
      const left = Math.max(4, Math.min(w - LOUPE - 4, x - LOUPE / 2));
      loupeEl.style.transform = `translate(${left}px, ${top}px)`;
      // Snap markers inside the loupe and the point that will be chosen on release.
      pick = nearby(x, y, SNAP_RADIUS / 1.5)[0] ?? null;
      markState.current.hot = pick;
      const map = (p: THREE.Vector3) => {
        const s = toScreen(p);
        return { x: (s.x - x) * LOUPE_ZOOM + LOUPE / 2, y: (s.y - y) * LOUPE_ZOOM + LOUPE / 2 };
      };
      let html = '';
      keyPts.current.forEach((q, i) => {
        const s = map(q.p);
        if (s.x < -10 || s.y < -10 || s.x > LOUPE + 10 || s.y > LOUPE + 10) return;
        html += markerSvg(q.kind, s.x, s.y, MARKER_R, occluded.current[i] ? 'is-behind' : '');
      });
      if (pick) {
        const s = map(pick.p);
        html += `<circle class="mk-hot" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${MARKER_R * 2.4}"/>`;
      }
      const m = LOUPE / 2;
      html += `<path class="loupe-cross" d="M${m - 14} ${m}h28M${m} ${m - 14}v28"/>`;
      loupeSvgRef.current!.innerHTML = html;
      loupeTextRef.current!.textContent = pick ? pick.label : 'Przesuń palec do punktu';
      drawMarkersRef.current();
    };
    const scheduleLoupe = () => {
      if (looping) return;
      looping = true;
      requestAnimationFrame(drawLoupe);
    };
    const openLoupe = () => {
      holding = true;
      c.controls.enabled = false; // the finger now aims instead of rotating the model
      ensureLoupe();
      loupeEl.classList.add('is-open');
      scheduleLoupe();
    };
    const closeLoupe = (commit: boolean) => {
      if (!holding) return;
      holding = false;
      loupeEl.classList.remove('is-open');
      c.controls.enabled = true;
      markState.current.hot = null;
      const chosen = pick;
      pick = null;
      if (commit && chosen) choose([chosen, ...nearby(finger.x, finger.y, SNAP_RADIUS).filter((q) => q !== chosen)]);
      c.render();
    };

    const onDown = (e: PointerEvent) => {
      pointers.add(e.pointerId);
      if (pointers.size > 1) {
        // A second finger (zoom / pan) cancels aiming.
        clearTimeout(holdTimer);
        closeLoupe(false);
        down = null;
        return;
      }
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      // The loupe is for fingers; a mouse already shows the point under the cursor.
      if (measure && e.pointerType !== 'mouse') {
        finger = local(e);
        holdTimer = window.setTimeout(openLoupe, HOLD_MS);
      }
    };
    // Mouse: show which point a click would pick (ring + name next to the cursor).
    let hoverFrame = 0;
    const hover = (e: PointerEvent) => {
      const tip = tipRef.current;
      if (!measure || e.buttons || e.pointerType !== 'mouse') {
        if (tip) tip.classList.remove('is-on');
        if (markState.current.hot && !holding) {
          markState.current.hot = null;
          c.render();
        }
        return;
      }
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const { x, y } = local(e);
        const hot = nearby(x, y, SNAP_RADIUS / 1.5)[0] ?? null;
        if (hot !== markState.current.hot) {
          markState.current.hot = hot;
          drawMarkersRef.current();
        }
        if (tip) {
          tip.classList.toggle('is-on', !!hot);
          if (hot) {
            const s = toScreen(hot.p);
            tip.textContent = hot.label;
            tip.style.transform = `translate(${Math.round(s.x + 18)}px, ${Math.round(s.y - 44)}px)`;
          }
        }
      });
    };
    const onLeave = () => {
      tipRef.current?.classList.remove('is-on');
      if (markState.current.hot && !holding) {
        markState.current.hot = null;
        c.render();
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!down) hover(e);
      if (!down || e.pointerId !== down.id) return;
      if (holding) {
        finger = local(e);
        scheduleLoupe();
        return;
      }
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) clearTimeout(holdTimer); // it is a rotation
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      clearTimeout(holdTimer);
      if (holding) {
        finger = local(e);
        closeLoupe(true);
        down = null;
        return;
      }
      if (!down || e.pointerId !== down.id) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 8) return;
      const { x, y, w, h } = local(e);
      if (measure) {
        // Snap to the nearest key point on screen; remember the other ones nearby.
        choose(nearby(x, y, SNAP_RADIUS));
        return;
      }
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), c.camera);
      let best: { dist: number; step: number } | null = null;
      for (const o of c.barObjs) {
        const hit = ray.intersectObject(o.mesh)[0];
        if (hit && hit.faceIndex != null && (!best || hit.distance < best.dist)) {
          best = { dist: hit.distance, step: o.triangleStep[hit.faceIndex] };
        }
      }
      onSelect(best ? best.step : null);
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      clearTimeout(holdTimer);
      closeLoupe(false);
      down = null;
    };
    // Long press must not open the browser's context menu while measuring.
    const noMenu = (e: Event) => {
      if (measure) e.preventDefault();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('contextmenu', noMenu);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      clearTimeout(holdTimer);
      cancelAnimationFrame(hoverFrame);
      el.removeEventListener('pointerleave', onLeave);
      closeLoupe(false);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('contextmenu', noMenu);
      if (loupe) {
        loupe.renderer.dispose();
        loupe.renderer.domElement.remove();
      }
    };
  }, [measure, onSelect]);

  // Keyboard: 1–4 views, F fit, W dimensions, M measuring.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || keyboardBusy(e)) return;
    const k = e.key.toLowerCase();
    const v = VIEWS[Number(k) - 1];
    if (v) setView(v[0]);
    else if (k === 'f') setView();
    else if (k === 'w') setShowDims((x) => !x);
    else if (k === 'm') {
      setMeasure((x) => !x);
      setPoints([]);
      setCand(null);
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const size = assembly.bbox.getSize(new THREE.Vector3());
  const d = points.length === 2 ? points[1].p.clone().sub(points[0].p) : null;
  /** The same distance along the cabinet axes (width, height, depth). */
  const dc = d && toCab ? d.clone().transformDirection(toCab).multiplyScalar(d.length()) : null;
  const ck = cabinet?.check;
  /** Switch the last placed point to the next candidate near the tap. */
  const nextCandidate = () => {
    if (!cand || cand.list.length < 2) return;
    const idx = (cand.idx + 1) % cand.list.length;
    setCand({ ...cand, idx });
    setPoints((pts) => [...pts.slice(0, -1), cand.list[idx]]);
  };

  return (
    <div className={`bb-viewport viewer ${measure ? 'measuring' : ''}`}>
      <div className="bb-viewbar">
        <div className="bb-seg" role="radiogroup" aria-label="Widok modelu">
          {VIEWS.map(([v, l], k) => (
            <button
              key={v}
              title={`${l} (${k + 1})`}
              role="radio"
              aria-checked={view === v}
              className={`bb-seg-opt ${view === v ? 'is-selected' : ''}`}
              onClick={() => setView(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <button className="bb-btn bb-btn--secondary vb-fit" title="Dopasuj do okna (F)" onClick={() => setView()}>
          <Icon name="fit" />
          <span className="vb-text">Dopasuj</span>
        </button>
        <span className="bb-spacer" />
        <button
          className={`bb-toggle ${showDims ? 'is-on' : ''}`}
          aria-pressed={showDims}
          title="Wymiary (W)"
          onClick={() => setShowDims((v) => !v)}
        >
          <Icon name="dims" />
          Wymiary
          <span className="bb-toggle-state">{showDims ? 'wł.' : 'wył.'}</span>
        </button>
        <button
          className={`bb-toggle ${measure ? 'is-on' : ''}`}
          aria-pressed={measure}
          title="Zmierz (M)"
          onClick={() => {
            setMeasure((m) => !m);
            setPoints([]);
            setCand(null);
          }}
        >
          <Icon name="ruler" />
          Zmierz
          <span className="bb-toggle-state">{measure ? 'wł.' : 'wył.'}</span>
        </button>
      </div>
      <div className="bb-viewcanvas" ref={hostRef}>
        <svg className="snap-layer" ref={markRef} aria-hidden="true" />
        <div className="hover-tip" ref={tipRef} aria-hidden="true" />
        <div className="loupe" ref={loupeRef} aria-hidden="true">
          <svg className="loupe-marks" ref={loupeSvgRef} width={LOUPE} height={LOUPE} />
          <div className="loupe-text" ref={loupeTextRef} />
        </div>
        {measure && (
          <div className="bb-measurecard">
            {d ? (
              <div className="bb-measure-main">
                <span className="bb-tile-label">Pomiar</span>
                <span className="bb-measure-val">{fmt(d.length())} mm</span>
                <span className="bb-measure-delta">
                  {dc
                    ? `Szer. ${fmt(Math.abs(dc.x))} · Wys. ${fmt(Math.abs(dc.y))} · Głęb. ${fmt(Math.abs(dc.z))}`
                    : `ΔX ${fmt(Math.abs(d.x))} · ΔY ${fmt(Math.abs(d.y))} · ΔZ ${fmt(Math.abs(d.z))}`}
                </span>
              </div>
            ) : (
              <div className="bb-measure-main measure-help">
                <b>{points.length === 0 ? 'Dotknij pierwszego punktu' : 'Dotknij drugiego punktu'}</b>
                <span className="hint-touch">Przytrzymaj palec, żeby celować z lupą</span>
                <span className="hint-mouse">Najedź myszą – podświetla się punkt, który zostanie wybrany</span>
              </div>
            )}
            <div className="measure-side">
              {points.length > 0 && (
                <ol className="measure-points">
                  {points.map((q, k) => (
                    <li key={k}>
                      <SnapGlyph kind={q.kind} /> {q.label}
                    </li>
                  ))}
                </ol>
              )}
              {points.length > 0 && (
                <div className="measure-actions">
                  {cand && cand.list.length > 1 && (
                    <button className="bb-btn bb-btn--secondary" onClick={nextCandidate}>
                      <Icon name="rotate" />
                      Inny punkt ({cand.idx + 1}/{cand.list.length})
                    </button>
                  )}
                  <button
                    className="bb-btn bb-btn--secondary"
                    onClick={() => {
                      setPoints([]);
                      setCand(null);
                    }}
                  >
                    <Icon name="close" />
                    Wyczyść
                  </button>
                </div>
              )}
              {points.length === 0 && (
                <div className="measure-legend">
                  <span>
                    <SnapGlyph kind="corner" /> narożnik
                  </span>
                  <span>
                    <SnapGlyph kind="dim" /> punkt wymiaru
                  </span>
                  <span>
                    <SnapGlyph kind="hole" /> otwór
                  </span>
                  <span>
                    <SnapGlyph kind="end" /> środek końca
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="bb-viewfoot">
        <span>
          Gabaryty{' '}
          <b>
            {fmt(size.x, 0)} × {fmt(size.y, 0)} × {fmt(size.z, 0)} mm
          </b>
        </span>
        <span className="vf-mode">
          Wymiary <b>{DIMENSION_MODE_LABEL[bar.dimensionMode]}</b>
        </span>
        {foot}
        {ck && (
          <span className={`vf-cab ${ck.hits.length || ck.phasesOverlap ? 'is-bad' : ck.outside ? 'is-warn' : ''}`}>
            {ck.hits.length ? (
              <>
                <Icon name="stop" size={20} />
                <b>Kolizja z ramą</b>
                {cabinet!.cfg.phases > 1 && ` (${ck.hitPhases.map((k) => PHASE_NAMES[k]).join(', ')})`}
              </>
            ) : ck.phasesOverlap ? (
              <>
                <Icon name="stop" size={20} />
                <b>Fazy nachodzą na siebie</b>
              </>
            ) : (
              <>
                Od ramy <b>{fmt(ck.clearance)} mm</b>
              </>
            )}
            {ck.outside && !ck.hits.length && (
              <>
                <Icon name="warn" size={20} />
                <b>wychodzi poza szafę</b>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Small legend glyph of a snap point kind (same shapes as the markers on the model). */
function SnapGlyph({ kind }: { kind: SnapKind }) {
  return (
    <svg
      className="snap-glyph"
      width="18"
      height="18"
      viewBox="-9 -9 18 18"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markerSvg(kind, 0, 0, 5.5, '') }}
    />
  );
}
