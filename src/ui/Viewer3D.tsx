import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { fmt, type Analysis } from '../core/analyze';
import { keyPoints, type BarPath } from '../core/geometry';
import { DIRECTION_ARROW, type Busbar } from '../core/model';
import { addLights, buildBarObject, fitOrtho, type BarObject, type ViewName } from './scene';

interface Props {
  bar: Busbar;
  path: BarPath;
  analysis: Analysis;
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
  barObj?: BarObject;
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

export function Viewer3D({ bar, path, analysis, selected, errorSteps, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const [measure, setMeasure] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [points, setPoints] = useState<THREE.Vector3[]>([]);
  const fittedFor = useRef<string | null>(null);
  const keyPts = useRef<THREE.Vector3[]>([]);

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
    const axes = new THREE.AxesHelper(60);
    scene.add(axes);
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

    ctxRef.current = { renderer, labelRenderer, scene, camera, controls, overlay, grid, measureGroup, render };
    resize();
    return () => {
      ro.disconnect();
      controls.dispose();
      ctxRef.current?.barObj?.dispose();
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
    fitOrtho(c.camera, path.bbox, view, el.clientWidth / Math.max(1, el.clientHeight), c.controls.target);
    c.controls.update();
    c.render();
  };

  /** True when some corner of the bounding box is outside the current view. */
  const outOfView = () => {
    const c = ctxRef.current;
    if (!c) return false;
    c.camera.updateMatrixWorld();
    const { min, max } = path.bbox;
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
    c.barObj && (c.scene.remove(c.barObj.group), c.barObj.dispose());
    c.barObj = buildBarObject(bar, path, { selected, errorSteps });
    c.scene.add(c.barObj.group);
    // Keep the floor grid just below the part so it never cuts through it.
    c.grid.position.y = path.bbox.min.y - 1;
    keyPts.current = keyPoints(path, bar.section.width, bar.section.thickness);

    // Overlay: dimension labels and the direction arrow of the selected bend.
    disposeGroup(c.overlay);
    if (showDims) {
      let legNo = 0;
      bar.steps.forEach((s, i) => {
        const [a, b] = path.stepRanges[i];
        const sa = path.samples[a];
        const sb = path.samples[b];
        if (s.kind === 'straight') {
          legNo++;
          const mid = sa.p.clone().lerp(sb.p, 0.5);
          const l = label(`${fmt(s.length)}`, i === selected ? 'lbl-sel' : 'lbl-dim');
          l.position.copy(mid);
          c.overlay.add(l);
        } else if (s.kind === 'bend') {
          const midS = path.samples[Math.round((a + b) / 2)];
          const info = analysis.bends.find((x) => x.stepIndex === i);
          const l = label(`G${info?.no ?? '?'} ${fmt(s.angle)}° ${DIRECTION_ARROW[s.direction]}`, i === selected ? 'lbl-sel' : 'lbl-bend');
          l.position.copy(midS.p);
          c.overlay.add(l);
        } else {
          const midS = path.samples[Math.round((a + b) / 2)];
          const l = label(`skręt ${fmt(s.angle)}°`, i === selected ? 'lbl-sel' : 'lbl-bend');
          l.position.copy(midS.p);
          c.overlay.add(l);
        }
      });
      const start = label('A', 'lbl-start');
      start.position.copy(path.samples[0].p).addScaledVector(path.samples[0].t, -bar.section.width * 0.6);
      c.overlay.add(start);
    }
    if (selected !== null && bar.steps[selected]?.kind === 'bend') {
      const s = bar.steps[selected];
      if (s.kind === 'bend') {
        const f = path.samples[path.stepRanges[selected][0]];
        const dir =
          s.direction === 'up' ? f.n : s.direction === 'down' ? f.n.clone().negate() : s.direction === 'right' ? f.w : f.w.clone().negate();
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
  }, [bar, path, analysis, selected, errorSteps, showDims]);

  // Measurement visuals.
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    disposeGroup(c.measureGroup);
    if (measure) {
      const size = Math.max(2, bar.section.thickness * 0.35);
      const sg = new THREE.SphereGeometry(size, 10, 8);
      const kp = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: '#1677ff', transparent: true, opacity: 0.45, depthTest: false }), keyPts.current.length);
      keyPts.current.forEach((p, i) => kp.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
      kp.renderOrder = 10;
      c.measureGroup.add(kp);
      for (const p of points) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(size * 1.6, 14, 10), new THREE.MeshBasicMaterial({ color: '#e8590c', depthTest: false }));
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
  }, [measure, points, path, bar.section.thickness]);

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
      const hit = c.barObj ? ray.intersectObject(c.barObj.mesh)[0] : undefined;
      if (hit && hit.faceIndex != null) onSelect(c.barObj!.triangleStep[hit.faceIndex] ?? null);
      else onSelect(null);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [measure, onSelect]);

  const size = path.bbox.getSize(new THREE.Vector3());
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
        Gabaryty: {fmt(size.x)} × {fmt(size.y)} × {fmt(size.z)} mm
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
