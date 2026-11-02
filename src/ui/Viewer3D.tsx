import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { fmt } from '../core/analyze';
import type { Assembly } from '../core/assembly';
import { dirVector, keyPoints, legDimensions } from '../core/geometry';
import { DIMENSION_MODE_LABEL, DIRECTION_ARROW, type Busbar } from '../core/model';
import { addLegDimension } from './dimensions3d';
import { addLights, buildPartObjects, fitOrtho, type BarObject, type ViewName } from './scene';

interface Props {
  /** The project as edited (leg lengths shown in labels). */
  bar: Busbar;
  assembly: Assembly;
  selected: number | null;
  errorSteps: Set<number>;
  onSelect: (i: number | null) => void;
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
  render: () => void;
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

export function Viewer3D({ bar, assembly, selected, errorSteps, onSelect }: Props) {
  const part1 = assembly.parts[0];
  const { path, analysis } = part1;
  const bbox = assembly.bbox;
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const [measure, setMeasure] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [points, setPoints] = useState<THREE.Vector3[]>([]);
  const fittedFor = useRef<string | null>(null);
  const keyPts = useRef<THREE.Vector3[]>([]);

  // A measurement belongs to the shape it was taken on – clear it when the bar changes.
  useEffect(() => setPoints([]), [assembly]);

  // Init renderer once.
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#e9edf1');
    host.appendChild(renderer.domElement);
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = 'label-layer';
    host.appendChild(labelRenderer.domElement);

    const scene = new THREE.Scene();
    addLights(scene);
    const grid = new THREE.GridHelper(4000, 80, '#b8c2cc', '#d3d9df');
    grid.position.y = -0.01;
    scene.add(grid);
    const overlay = new THREE.Group();
    const measureGroup = new THREE.Group();
    scene.add(overlay, measureGroup);

    const camera = new THREE.OrthographicCamera();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.zoomToCursor = true;

    const render = () => {
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    controls.addEventListener('change', render);

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

    ctxRef.current = { renderer, labelRenderer, scene, camera, controls, barObjs: [], overlay, grid, measureGroup, render };
    resize();
    return () => {
      ro.disconnect();
      controls.dispose();
      ctxRef.current?.barObjs.forEach((o) => o.dispose());
      disposeGroup(overlay);
      disposeGroup(measureGroup);
      renderer.dispose();
      host.innerHTML = '';
      ctxRef.current = null;
    };
  }, []);

  /** Fit the whole part; with no view given keep the current viewing direction. */
  const setView = (v?: ViewName) => {
    const c = ctxRef.current;
    if (!c) return;
    const el = hostRef.current!;
    const view = v ?? {
      dir: c.camera.position.clone().sub(c.controls.target).normalize(),
      up: c.camera.up.clone(),
    };
    fitOrtho(c.camera, bbox, view, el.clientWidth / Math.max(1, el.clientHeight), c.controls.target);
    c.controls.update();
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
    // Keep the floor grid just below the part so it never cuts through it.
    c.grid.position.y = bbox.min.y - 1;
    // Snap points for measuring: section corners and hole centres (both faces) of every bar.
    const { width: W, thickness: T } = bar.section;
    keyPts.current = assembly.parts.flatMap((part) => {
      const shift = new THREE.Vector3(0, part.offset, 0);
      const pts = keyPoints(part.path, W, T);
      for (const h of part.analysis.holes) {
        const f = part.path.samples[part.path.stepRanges[h.stepIndex][0]];
        const c0 = f.p.clone().addScaledVector(f.t, h.posOnStraight).addScaledVector(f.w, h.offset);
        pts.push(c0.clone().addScaledVector(f.n, T / 2), c0.clone().addScaledVector(f.n, -T / 2));
      }
      return pts.map((p) => p.add(shift));
    });

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
        l.center.set(-0.15, 1.2);
        c.overlay.add(l);
      }
    }
    if (selected !== null && bar.steps[selected]?.kind === 'bend') {
      const s = bar.steps[selected];
      if (s.kind === 'bend') {
        const f = path.samples[path.stepRanges[selected][0]];
        const dir = dirVector(f, s.direction);
        const len = Math.max(60, bar.section.width * 2);
        const arrow = new THREE.ArrowHelper(dir.clone().normalize(), f.p, len, '#1677ff', len * 0.3, len * 0.18);
        arrow.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m) m.depthTest = false;
          o.renderOrder = 5;
        });
        c.overlay.add(arrow);
      }
    }

    // Fit the camera when a different project is opened.
    if (fittedFor.current !== bar.id) {
      fittedFor.current = bar.id;
      setView('iso');
    } else if (outOfView()) {
      setView();
    }
    c.render();
  }, [bar, assembly, selected, errorSteps, showDims]);

  // Measurement visuals.
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    disposeGroup(c.measureGroup);
    if (measure) {
      const size = Math.max(2, bar.section.thickness * 0.35);
      const sg = new THREE.SphereGeometry(size, 10, 8);
      const kp = new THREE.InstancedMesh(
        sg,
        new THREE.MeshBasicMaterial({ color: '#1677ff', transparent: true, opacity: 0.45, depthTest: false }),
        keyPts.current.length,
      );
      keyPts.current.forEach((p, i) => kp.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
      kp.renderOrder = 10;
      c.measureGroup.add(kp);
      for (const p of points) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(size * 1.6, 14, 10),
          new THREE.MeshBasicMaterial({ color: '#e8590c', depthTest: false }),
        );
        m.position.copy(p);
        m.renderOrder = 11;
        c.measureGroup.add(m);
      }
      if (points.length === 2) {
        const g = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#e8590c', depthTest: false }));
        line.renderOrder = 11;
        c.measureGroup.add(line);
        const l = label(`${fmt(points[0].distanceTo(points[1]))} mm`, 'lbl-measure');
        l.position.copy(points[0]).lerp(points[1], 0.5);
        c.measureGroup.add(l);
      }
    }
    c.render();
  }, [measure, points, assembly, bar.section.thickness]);

  // Tap handling (tap = pointer down/up without moving).
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    const el = c.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 8) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (measure) {
        // Snap to the nearest key point on screen.
        let best: THREE.Vector3 | null = null;
        let bestD = 45;
        for (const p of keyPts.current) {
          const v = p.clone().project(c.camera);
          const sx = ((v.x + 1) / 2) * rect.width;
          const sy = ((1 - v.y) / 2) * rect.height;
          const d = Math.hypot(sx - x, sy - y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best) setPoints((pts) => (pts.length >= 2 ? [best!] : [...pts, best!]));
        return;
      }
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), c.camera);
      let best: { dist: number; step: number } | null = null;
      for (const o of c.barObjs) {
        const hit = ray.intersectObject(o.mesh)[0];
        if (hit && hit.faceIndex != null && (!best || hit.distance < best.dist)) {
          best = { dist: hit.distance, step: o.triangleStep[hit.faceIndex] };
        }
      }
      onSelect(best ? best.step : null);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [measure, onSelect]);

  const size = bbox.getSize(new THREE.Vector3());
  const d = points.length === 2 ? points[1].clone().sub(points[0]) : null;

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={hostRef} />
      <div className="viewer-toolbar">
        <button onClick={() => setView('iso')}>ISO</button>
        <button onClick={() => setView('front')}>Przód</button>
        <button onClick={() => setView('top')}>Góra</button>
        <button onClick={() => setView('side')}>Bok</button>
        <button onClick={() => setView()} title="Dopasuj widok">
          ⤢
        </button>
        <span className="sep" />
        <button className={showDims ? 'on' : ''} onClick={() => setShowDims((v) => !v)}>
          Wymiary
        </button>
        <button
          className={measure ? 'on accent' : ''}
          onClick={() => {
            setMeasure((m) => !m);
            setPoints([]);
          }}
        >
          📏 Zmierz
        </button>
      </div>
      <div className="viewer-info">
        Gabaryty: {fmt(size.x)} × {fmt(size.y)} × {fmt(size.z)} mm · wymiary ramion{' '}
        <b>{DIMENSION_MODE_LABEL[bar.dimensionMode]}</b>
      </div>
      {measure && (
        <div className="measure-panel">
          {points.length === 0 && <div>Dotknij pierwszego punktu (narożnik / środek końca)</div>}
          {points.length === 1 && <div>Dotknij drugiego punktu</div>}
          {d && (
            <>
              <div className="measure-big">{fmt(d.length())} mm</div>
              <div>
                ΔX {fmt(Math.abs(d.x))} · ΔY {fmt(Math.abs(d.y))} · ΔZ {fmt(Math.abs(d.z))}
              </div>
              <button onClick={() => setPoints([])}>Wyczyść</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
