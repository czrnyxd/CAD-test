import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fmt } from '../core/analyze';
import type { Assembly } from '../core/assembly';
import { newId, type Busbar, type SketchAxis, type SketchDim, type SketchRef, type Step } from '../core/model';
import {
  allAxes,
  axisName,
  dimConflicts,
  dragPoint,
  liveDims,
  measureDim,
  refVertex,
  setDimValue,
  sketchGeometry,
  sketchOf,
  vertexRef,
  type Vec2,
} from '../core/sketch';
import { Icon } from './Icon';
import type { NumPadRequest } from './NumPad';

interface Props {
  bar: Busbar;
  assembly: Assembly;
  selected: number | null;
  onSelect: (i: number | null) => void;
  /** Change the project (recorded in the undo history unless record is false). */
  update: (fn: (b: Busbar) => Busbar, record?: boolean) => void;
  /** Change steps the way the step list does (locked dimensions are kept). */
  updateSteps: (fn: (steps: Step[]) => Step[]) => void;
  /** Record a change made in unrecorded steps (dragging) in the undo history. */
  commit: (from: Busbar) => void;
  numpad: (r: NumPadRequest) => void;
  onMessage: (text: string) => void;
  /** 3D / 2D switch shown in the bar above the drawing. */
  modeSwitch: ReactNode;
}

type Tool = 'none' | 'dim' | 'axis';
type Pick = { ref: SketchRef; at: Vec2 };
interface Popover {
  x: number;
  y: number;
  kind: 'dimType' | 'axisDir';
  a?: Pick;
  b?: Pick;
  at?: Vec2;
}

const GRID_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];
const PICK_PX = 16;

/** 2D drawing of the bar in its bending plane: axes, driving dimensions, locks and dragging of legs. */
export function ProfileEditor({
  bar,
  assembly,
  selected,
  onSelect,
  update,
  updateSteps,
  commit,
  numpad,
  onMessage,
  modeSwitch,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<{ s: number; cx: number; cy: number } | null>(null);
  const [tool, setTool] = useState<Tool>('none');
  const [first, setFirst] = useState<Pick | null>(null);
  const [pop, setPop] = useState<Popover | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const g = useMemo(() => sketchGeometry(bar), [bar]);
  const dims = useMemo(() => liveDims(bar, g), [bar, g]);
  const conflicts = useMemo(() => dimConflicts(bar, g), [bar, g]);
  const axes = allAxes(bar);
  const T = bar.section.thickness;

  // Outline of every bar (centreline ± T/2 in the plane), from the same path as the 3D model.
  const outlines = useMemo(
    () =>
      assembly.parts.map((part) => {
        const s = part.path.samples;
        const off = part.offset;
        // Moved like the sketch: the dimension point of end A is the origin.
        const side = (k: number) =>
          s.map((q) => ({
            x: q.p.x + q.n.x * (off + (k * T) / 2) + g.origin.x,
            y: q.p.y + q.n.y * (off + (k * T) / 2) + g.origin.y,
          }));
        return { index: part.index, pts: [...side(1), ...side(-1).reverse()] };
      }),
    [assembly, T, g],
  );

  const bounds = useMemo(() => {
    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;
    for (const o of outlines)
      for (const p of o.pts) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
    for (const a of sketchOf(bar).axes) {
      if (a.dir === 'v') ((x0 = Math.min(x0, a.at)), (x1 = Math.max(x1, a.at)));
      else ((y0 = Math.min(y0, a.at)), (y1 = Math.max(y1, a.at)));
    }
    return { x0, y0, x1, y1 };
  }, [outlines, bar]);

  useLayoutEffect(() => {
    const el = hostRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
    return () => ro.disconnect();
  }, []);

  const fit = () => {
    const { x0, y0, x1, y1 } = bounds;
    // Room around the drawing for the dimension rows.
    const rows = dims.length;
    const s = Math.min((size.w - 220 - rows * 20) / Math.max(1, x1 - x0), (size.h - 200 - rows * 20) / Math.max(1, y1 - y0));
    setView({ s: Math.max(0.02, Math.min(20, s)), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  };
  // Fit when another project is opened or the window size changes.
  const fittedFor = useRef('');
  useEffect(() => {
    const key = `${bar.id}:${size.w}x${size.h}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    fit();
  });

  const afterDrag = useRef(false);
  const v = view ?? { s: 1, cx: 0, cy: 0 };
  // After a change (not while dragging) bring the whole bar back into view when part of it left it.
  useEffect(() => {
    if (!view || gesture.current) return;
    // Not right after a drag: the view stays where the user was working.
    if (afterDrag.current) {
      afterDrag.current = false;
      return;
    }
    const lo = { x: view.cx - size.w / 2 / view.s, y: view.cy - size.h / 2 / view.s };
    const hi = { x: view.cx + size.w / 2 / view.s, y: view.cy + size.h / 2 / view.s };
    if (bounds.x0 < lo.x || bounds.x1 > hi.x || bounds.y0 < lo.y || bounds.y1 > hi.y) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);
  const toS = (p: Vec2) => ({ x: size.w / 2 + (p.x - v.cx) * v.s, y: size.h / 2 - (p.y - v.cy) * v.s });
  const toW = (x: number, y: number): Vec2 => ({ x: v.cx + (x - size.w / 2) / v.s, y: v.cy - (y - size.h / 2) / v.s });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // ------------------------------------------------------------ picking
  const nearestVertex = (x: number, y: number) => {
    let best: { i: number; d: number } | null = null;
    g.vertices.forEach((p, i) => {
      const s = toS(p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < PICK_PX && (!best || d < best.d)) best = { i, d };
    });
    return best as { i: number; d: number } | null;
  };
  const nearestAxis = (x: number, y: number) => {
    let best: { a: SketchAxis; d: number } | null = null;
    for (const a of axes) {
      const s = toS({ x: a.at, y: a.at });
      const d = a.dir === 'v' ? Math.abs(s.x - x) : Math.abs(s.y - y);
      if (d < 10 && (!best || d < best.d)) best = { a, d };
    }
    return best as { a: SketchAxis; d: number } | null;
  };
  const pickAt = (x: number, y: number): Pick | null => {
    const vtx = nearestVertex(x, y);
    if (vtx) {
      const ref = vertexRef(g, vtx.i);
      if (ref) return { ref, at: g.vertices[vtx.i] };
    }
    const ax = nearestAxis(x, y);
    if (ax) return { ref: { kind: 'axis', axis: ax.a.id }, at: toW(x, y) };
    return null;
  };

  // ------------------------------------------------------------ editing
  const setSketch = (fn: (sk: { axes: SketchAxis[]; dims: SketchDim[] }) => { axes: SketchAxis[]; dims: SketchDim[] }) =>
    update((b) => ({ ...b, sketch: fn(sketchOf(b)) }));

  const editDim = (d: SketchDim) =>
    numpad({
      title: `Wymiar ${d.type === 'h' ? 'poziomy' : d.type === 'v' ? 'pionowy' : 'po prostej'} – ustaw wartość`,
      value: Math.round(Math.abs(measureDim(bar, g, d)) * 100) / 100,
      unit: 'mm',
      min: d.type === 'd' ? 1 : 0,
      max: 20000,
      onOk: (val) => {
        const res = setDimValue(useLatest.current, d.id, val);
        if (res.ok) update(() => res.bar);
        else onMessage(res.message ?? 'Nie da się ustawić tego wymiaru.');
      },
    });
  // The keypad calls back after the project may have changed – always work on the latest one.
  const useLatest = useRef(bar);
  useLatest.current = bar;

  const addDim = (type: SketchDim['type'], a: Pick, b: Pick) => {
    const d: SketchDim = { id: newId(), type, a: a.ref, b: b.ref, value: 0, locked: false };
    d.value = Math.round(Math.abs(measureDim(bar, g, d)) * 100) / 100;
    const next = { ...bar, sketch: { ...sketchOf(bar), dims: [...sketchOf(bar).dims, d] } };
    update(() => next);
    useLatest.current = next;
    editDim(d);
  };

  const finishPick = (b: Pick, x: number, y: number) => {
    const a = first!;
    setFirst(null);
    const isAxis = (p: Pick) => p.ref.kind === 'axis';
    if (isAxis(a) && isAxis(b)) {
      onMessage('Odległość między osiami ustawiasz położeniem osi – kliknij jej opis.');
      return;
    }
    if (a.ref.kind === 'pt' && b.ref.kind === 'pt' && refVertex(g, a.ref) === refVertex(g, b.ref)) return;
    const axis = [a, b].find(isAxis);
    if (axis) {
      const dir = axes.find((q) => q.id === (axis.ref as { axis: string }).axis)!.dir;
      // A vertical axis (x = const) gives a horizontal distance, and the other way round.
      addDim(dir === 'v' ? 'h' : 'v', a, b);
      return;
    }
    setPop({ x, y, kind: 'dimType', a, b });
  };

  const addAxis = (dir: 'h' | 'v', at: Vec2) => {
    const pos = Math.round((dir === 'v' ? at.x : at.y) * 10) / 10;
    const ax: SketchAxis = { id: newId(), dir, at: pos };
    setSketch((sk) => ({ ...sk, axes: [...sk.axes, ax] }));
    setTool('none');
  };

  const editAxis = (a: SketchAxis) =>
    numpad({
      title: `${axisName(bar, a.id)} – ${a.dir === 'v' ? 'odległość od osi Y (x)' : 'odległość od osi X (y)'}`,
      value: a.at,
      unit: 'mm',
      min: -20000,
      max: 20000,
      onOk: (val) =>
        update((b) => ({
          ...b,
          sketch: { ...sketchOf(b), axes: sketchOf(b).axes.map((q) => (q.id === a.id ? { ...q, at: val } : q)) },
        })),
    });

  const toggleStepLock = (i: number) =>
    update((b) => ({ ...b, steps: b.steps.map((s, k) => (k === i ? { ...s, locked: !s.locked } : s)) }));

  const editLeg = (i: number) => {
    const s = bar.steps[i];
    if (s.kind !== 'straight') return;
    onSelect(i);
    numpad({
      title: `Odcinek ${g.legs.findIndex((l) => l.stepIndex === i) + 1} – długość`,
      value: s.length,
      unit: 'mm',
      min: 1,
      max: 10000,
      onOk: (val) => updateSteps((steps) => steps.map((q, k) => (k === i ? { ...q, length: val } : q))),
    });
  };
  const editAngle = (i: number) => {
    const s = bar.steps[i];
    if (s.kind !== 'bend') return;
    onSelect(i);
    numpad({
      title: 'O ile giąć',
      value: s.angle,
      unit: '°',
      min: 1,
      max: 179,
      quick: [15, 30, 45, 60, 90, 120, 135],
      figure: 'bend-angle',
      onOk: (val) => updateSteps((steps) => steps.map((q, k) => (k === i ? { ...q, angle: val } : q))),
    });
  };

  // ------------------------------------------------------------ pointer: drag legs, pan, zoom, pick
  const gesture = useRef<
    | { kind: 'pan'; x: number; y: number; cx: number; cy: number; moved: boolean; leg?: number }
    | {
        kind: 'end';
        /** 'A': end A follows the cursor (the bar keeps end B in place), 'B': end B follows the cursor. */
        which: 'A' | 'B';
        start: Busbar;
        /** Position of the grabbed end and of end B at the start, and the view then. */
        p0: Vec2;
        b0: Vec2;
        v0: { s: number; cx: number; cy: number };
        x: number;
        y: number;
        moved: boolean;
        done: boolean;
      }
    | null
  >(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const frame = useRef(0);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('.sk-tag, .sk-pop')) return;
    const { x, y } = local(e);
    pointers.current.set(e.pointerId, { x, y });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(p.x - q.x, p.y - q.y), s: v.s };
      gesture.current = null;
      return;
    }
    setPop(null);
    if (tool === 'dim') {
      const p = pickAt(x, y);
      if (!p) return;
      if (!first) setFirst(p);
      else finishPick(p, x, y);
      return;
    }
    if (tool === 'axis') {
      const vtx = nearestVertex(x, y);
      const at = vtx ? g.vertices[vtx.i] : toW(x, y);
      const snapped = vtx ? at : { x: Math.round(at.x / 10) * 10, y: Math.round(at.y / 10) * 10 };
      setPop({ x, y, kind: 'axisDir', at: snapped });
      return;
    }
    // An end of the bar: grab it and move it.
    const end = e.button === 0 ? endAt(x, y) : null;
    if (end) {
      const last = g.vertices.length - 1;
      gesture.current = {
        kind: 'end',
        which: end,
        start: bar,
        p0: g.vertices[end === 'A' ? 0 : last],
        b0: g.vertices[last],
        v0: v,
        x,
        y,
        moved: false,
        done: false,
      };
      return;
    }
    // A leg: a click selects it; dragging (from anywhere) moves the view.
    const legEl = (e.target as Element).closest('[data-leg]');
    const leg = legEl ? Number(legEl.getAttribute('data-leg')) : undefined;
    gesture.current = { kind: 'pan', x, y, cx: v.cx, cy: v.cy, moved: false, leg };
  };

  const onMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x, y });
    if (pinch.current && pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      const s = Math.max(0.02, Math.min(40, (pinch.current.s * Math.hypot(p.x - q.x, p.y - q.y)) / pinch.current.d));
      setView({ ...v, s });
      return;
    }
    const gs = gesture.current;
    if (!gs) {
      if (tool === 'dim') setHover(nearestVertex(x, y)?.i ?? null);
      else {
        const end = endAt(x, y);
        setHover(end === 'A' ? 0 : end === 'B' ? g.vertices.length - 1 : null);
      }
      return;
    }
    if (Math.hypot(x - gs.x, y - gs.y) > 4) gs.moved = true;
    if (!gs.moved) return;
    if (gs.kind === 'pan') {
      setView({ s: v.s, cx: gs.cx - (x - gs.x) / v.s, cy: gs.cy + (y - gs.y) / v.s });
      return;
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => moveEnd(gs, x, y));
  };

  /** Which end of the bar is under (x, y) on screen, if any. */
  const endAt = (x: number, y: number): 'A' | 'B' | null => {
    const near = (p: Vec2) => {
      const q = toS(p);
      return Math.hypot(q.x - x, q.y - y) < PICK_PX + 4;
    };
    if (near(g.vertices[g.vertices.length - 1])) return 'B';
    if (near(g.vertices[0])) return 'A';
    return null;
  };

  /**
   * Move the grabbed end to the cursor. End A is the origin of the drawing, so moving A means
   * moving end B the opposite way and then shifting the view, which leaves end B in place on
   * screen and brings end A under the cursor.
   */
  const moveEnd = (gs: Extract<NonNullable<typeof gesture.current>, { kind: 'end' }>, x: number, y: number) => {
    const d = { x: (x - gs.x) / gs.v0.s, y: -(y - gs.y) / gs.v0.s };
    const last = sketchGeometry(gs.start).vertices.length - 1;
    const to =
      gs.which === 'B'
        ? { x: Math.round(gs.p0.x + d.x), y: Math.round(gs.p0.y + d.y) }
        : { x: Math.round(gs.b0.x - d.x), y: Math.round(gs.b0.y - d.y) };
    const res = dragPoint(gs.start, last, to);
    // Out of reach of the locks: the bar stays where it last could be.
    if (!res.ok) return;
    gs.done = true;
    update(() => res.bar, false);
    if (gs.which === 'A') {
      const b = sketchGeometry(res.bar).vertices[last];
      setView({ s: gs.v0.s, cx: gs.v0.cx + b.x - gs.b0.x, cy: gs.v0.cy + b.y - gs.b0.y });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const gs = gesture.current;
    gesture.current = null;
    if (!gs) return;
    if (gs.kind === 'end') {
      cancelAnimationFrame(frame.current);
      if (gs.moved) {
        // Finish at the exact final position, then put the whole drag in the undo history as one change.
        const { x, y } = local(e);
        moveEnd(gs, x, y);
        afterDrag.current = true;
        commit(gs.start);
        if (!gs.done) onMessage('Tego końca nie da się przesunąć – długości i kąty są zablokowane.');
      }
    } else if (!gs.moved) onSelect(gs.leg === undefined || gs.leg === selected ? null : gs.leg);
  };

  const onWheel = (e: React.WheelEvent) => {
    const { x, y } = local(e);
    const w = toW(x, y);
    const s = Math.max(0.02, Math.min(40, v.s * Math.exp(-e.deltaY * 0.0015)));
    // Zoom around the cursor.
    setView({ s, cx: w.x - (x - size.w / 2) / s, cy: w.y + (y - size.h / 2) / s });
  };
  useEffect(() => {
    // Prevent the page from scrolling while zooming the drawing.
    const el = hostRef.current!;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFirst(null);
        setPop(null);
        setTool('none');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------ drawing
  const gridStep = GRID_STEPS.find((st) => st * v.s >= 24) ?? 5000;
  const tl = toW(0, 0);
  const br = toW(size.w, size.h);
  const gridLines: ReactNode[] = [];
  for (let gx = Math.ceil(tl.x / gridStep) * gridStep; gx <= br.x; gx += gridStep) {
    const sx = toS({ x: gx, y: 0 }).x;
    gridLines.push(
      <line key={`gx${gx}`} className={gx % (gridStep * 5) === 0 ? 'sk-grid2' : 'sk-grid'} x1={sx} x2={sx} y1={0} y2={size.h} />,
    );
  }
  for (let gy = Math.ceil(br.y / gridStep) * gridStep; gy <= tl.y; gy += gridStep) {
    const sy = toS({ x: 0, y: gy }).y;
    gridLines.push(
      <line key={`gy${gy}`} className={gy % (gridStep * 5) === 0 ? 'sk-grid2' : 'sk-grid'} x1={0} x2={size.w} y1={sy} y2={sy} />,
    );
  }

  const poly = (pts: Vec2[]) =>
    pts
      .map((p) => toS(p))
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
  const bbS = { a: toS({ x: bounds.x0, y: bounds.y1 }), b: toS({ x: bounds.x1, y: bounds.y0 }) };

  // Dimension geometry on screen: rows above (horizontal) and right of (vertical) the drawing.
  let hRow = 0;
  let vRow = 0;
  const dimShapes = dims.map((d) => {
    const pt = (r: SketchRef) => (r.kind === 'pt' ? toS(g.vertices[refVertex(g, r)!]) : null);
    const axisPos = (r: SketchRef) => {
      const a = axes.find((q) => q.id === (r as { axis: string }).axis)!;
      return toS({ x: a.at, y: a.at });
    };
    const val = Math.abs(measureDim(bar, g, d));
    const bad = conflicts.has(d.id);
    if (d.type === 'd') {
      const a = pt(d.a)!;
      const b = pt(d.b)!;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const off = 34;
      const nx = (-(b.y - a.y) / len) * off;
      const ny = ((b.x - a.x) / len) * off;
      const a2 = { x: a.x + nx, y: a.y + ny };
      const b2 = { x: b.x + nx, y: b.y + ny };
      return {
        d,
        val,
        bad,
        ext: [
          [a, a2],
          [b, b2],
        ],
        line: [a2, b2],
        label: { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 },
      };
    }
    const horiz = d.type === 'h';
    const ends = [d.a, d.b].map((r) => (r.kind === 'pt' ? pt(r)! : axisPos(r)));
    if (horiz) {
      const y = bbS.a.y - 46 - 40 * hRow++;
      const xa = ends[0].x;
      const xb = ends[1].x;
      const ext = [d.a, d.b].map((r, k) =>
        r.kind === 'pt'
          ? [ends[k], { x: ends[k].x, y: y - 6 }]
          : [
              { x: ends[k].x, y },
              { x: ends[k].x, y: y - 6 },
            ],
      );
      return {
        d,
        val,
        bad,
        ext,
        line: [
          { x: xa, y },
          { x: xb, y },
        ],
        label: { x: (xa + xb) / 2, y },
      };
    }
    const x = bbS.b.x + 56 + 40 * vRow++;
    const ya = ends[0].y;
    const yb = ends[1].y;
    const ext = [d.a, d.b].map((r, k) =>
      r.kind === 'pt'
        ? [ends[k], { x: x + 6, y: ends[k].y }]
        : [
            { x, y: ends[k].y },
            { x: x + 6, y: ends[k].y },
          ],
    );
    return {
      d,
      val,
      bad,
      ext,
      line: [
        { x, y: ya },
        { x, y: yb },
      ],
      label: { x, y: (ya + yb) / 2 },
    };
  });

  const legTag = (i: number) => {
    const leg = g.legs[i];
    const s = bar.steps[leg.stepIndex];
    if (s.kind !== 'straight') return null;
    const a = toS(g.center[leg.from]);
    const b = toS(g.center[leg.to]);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Beside the leg, on the side away from the next bend.
    const off = (T * v.s) / 2 + 26;
    const nx = (-(b.y - a.y) / len) * off;
    const ny = ((b.x - a.x) / len) * off;
    const next = bar.steps[leg.stepIndex + 1] ?? bar.steps[leg.stepIndex - 1];
    const sign = next?.kind === 'bend' && next.direction === 'up' ? -1 : 1; // outside of the bend
    return (
      <div
        key={s.id}
        className={`sk-tag sk-leg ${selected === leg.stepIndex ? 'is-sel' : ''} ${s.locked ? 'is-locked' : ''}`}
        style={{ left: (a.x + b.x) / 2 + sign * nx, top: (a.y + b.y) / 2 + sign * ny }}
      >
        <button className="sk-val" title="Zmień długość" onClick={() => editLeg(leg.stepIndex)}>
          {fmt(s.length)}
        </button>
        <LockButton locked={!!s.locked} what="długość" onClick={() => toggleStepLock(leg.stepIndex)} />
      </div>
    );
  };

  const bendTag = (k: number) => {
    const bd = g.bends[k];
    const s = bar.steps[bd.stepIndex];
    if (s.kind !== 'bend') return null;
    const p = toS(g.vertices[bd.vertex]);
    return (
      <div
        key={s.id}
        className={`sk-tag sk-bend ${selected === bd.stepIndex ? 'is-sel' : ''} ${s.locked ? 'is-locked' : ''}`}
        style={{ left: p.x, top: p.y }}
      >
        <button className="sk-val" title="Zmień kąt" onClick={() => editAngle(bd.stepIndex)}>
          G{k + 1} {fmt(s.angle)}°
        </button>
        <LockButton locked={!!s.locked} what="kąt" onClick={() => toggleStepLock(bd.stepIndex)} />
      </div>
    );
  };

  const hint =
    tool === 'dim'
      ? first
        ? 'Kliknij drugi punkt albo oś (Esc – przerwij)'
        : 'Kliknij punkt szyny (kropka) albo oś, od której mierzysz'
      : tool === 'axis'
        ? 'Kliknij miejsce albo punkt szyny, przez który ma przechodzić oś'
        : 'Złap koniec szyny (zielony punkt) i przeciągnij · kłódka blokuje wartość';

  return (
    <div className="bb-viewport viewer sketch2d">
      <div className="bb-viewbar">
        {modeSwitch}
        <button className="bb-btn bb-btn--secondary vb-fit" title="Dopasuj do okna" onClick={fit}>
          <Icon name="fit" />
          <span className="vb-text">Dopasuj</span>
        </button>
        <span className="bb-spacer" />
        <button
          className={`bb-toggle ${tool === 'axis' ? 'is-on' : ''}`}
          aria-pressed={tool === 'axis'}
          onClick={() => {
            setTool((t) => (t === 'axis' ? 'none' : 'axis'));
            setFirst(null);
            setPop(null);
          }}
        >
          <Icon name="axis" />
          Oś
        </button>
        <button
          className={`bb-toggle ${tool === 'dim' ? 'is-on' : ''}`}
          aria-pressed={tool === 'dim'}
          onClick={() => {
            setTool((t) => (t === 'dim' ? 'none' : 'dim'));
            setFirst(null);
            setPop(null);
          }}
        >
          <Icon name="dims" />
          Wymiar
        </button>
      </div>
      <div
        className={`bb-viewcanvas sk-canvas tool-${tool} ${tool === 'none' && hover !== null ? 'over-end' : ''}`}
        ref={hostRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <svg className="sk-svg" width={size.w} height={size.h}>
          {gridLines}
          {/* Axes */}
          {axes.map((a) => {
            const s = toS({ x: a.at, y: a.at });
            const base = a.id === 'X' || a.id === 'Y';
            return a.dir === 'v' ? (
              <line key={a.id} className={`sk-axis ${base ? 'is-base' : ''}`} x1={s.x} x2={s.x} y1={0} y2={size.h} />
            ) : (
              <line key={a.id} className={`sk-axis ${base ? 'is-base' : ''}`} x1={0} x2={size.w} y1={s.y} y2={s.y} />
            );
          })}
          {/* Bars */}
          {outlines.map((o) => (
            <polygon key={o.index} className={`sk-bar ${o.index === 2 ? 'is-second' : ''}`} points={poly(o.pts)} />
          ))}
          {/* Centreline through the virtual sharps */}
          {/* Reference lines (outer faces for outside dimensions) through the dimension points */}
          {g.lines.map(([p, q], k) => {
            const a = toS(p);
            const b = toS(q);
            // Extended a little past the ends, so the corners read as the crossing of two lines.
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const ex = ((b.x - a.x) / len) * 24;
            const ey = ((b.y - a.y) / len) * 24;
            return <line key={k} className="sk-center" x1={a.x - ex} y1={a.y - ey} x2={b.x + ex} y2={b.y + ey} />;
          })}
          {/* Grab areas of the legs (wide, invisible) */}
          {g.legs.map((l) => {
            const a = toS(g.center[l.from]);
            const b = toS(g.center[l.to]);
            return (
              <line
                key={l.id}
                data-leg={l.stepIndex}
                className={`sk-grab ${selected === l.stepIndex ? 'is-sel' : ''}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={Math.max(22, T * v.s + 10)}
              />
            );
          })}
          {/* Dimensions */}
          {dimShapes.map((ds) => (
            <g key={ds.d.id} className={`sk-dim ${ds.d.locked ? 'is-locked' : ''} ${ds.bad ? 'is-bad' : ''}`}>
              {ds.ext.map(([p, q], k) => (
                <line key={k} className="sk-ext" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
              ))}
              <line
                className="sk-dline"
                x1={ds.line[0].x}
                y1={ds.line[0].y}
                x2={ds.line[1].x}
                y2={ds.line[1].y}
                markerStart="url(#sk-arrow)"
                markerEnd="url(#sk-arrow)"
              />
            </g>
          ))}
          {/* Points */}
          {g.vertices.map((p, i) => {
            const s = toS(p);
            const end = i === 0 || i === g.vertices.length - 1;
            const isFirst = first?.ref.kind === 'pt' && refVertex(g, first.ref) === i;
            return (
              <circle
                key={i}
                className={`sk-pt ${end ? 'is-end' : ''} ${hover === i ? 'is-hover' : ''} ${isFirst ? 'is-first' : ''}`}
                cx={s.x}
                cy={s.y}
                r={tool === 'dim' ? 7 : end ? 8 : 4.5}
              />
            );
          })}
          <defs>
            <marker
              id="sk-arrow"
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 1L10 5L0 9z" className="sk-arrowhead" />
            </marker>
          </defs>
        </svg>

        {/* Labels and controls (HTML on top of the drawing) */}
        <div className="sk-tags">
          {axes.map((a) => {
            const s = toS({ x: a.at, y: a.at });
            const base = a.id === 'X' || a.id === 'Y';
            const style = a.dir === 'v' ? { left: s.x, top: 14 } : { left: 14, top: s.y };
            return (
              <div key={a.id} className={`sk-tag sk-axtag ${base ? 'is-base' : ''} dir-${a.dir}`} style={style}>
                {base ? (
                  <span className="sk-axname">{a.id}</span>
                ) : (
                  <>
                    <button className="sk-val" title="Zmień położenie osi" onClick={() => editAxis(a)}>
                      {axisName(bar, a.id)} · {fmt(a.at)}
                    </button>
                    <button
                      className="sk-x"
                      title="Usuń oś"
                      onClick={() =>
                        setSketch((sk) => ({
                          axes: sk.axes.filter((q) => q.id !== a.id),
                          dims: sk.dims.filter(
                            (d) => !(d.a.kind === 'axis' && d.a.axis === a.id) && !(d.b.kind === 'axis' && d.b.axis === a.id),
                          ),
                        }))
                      }
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {g.legs.map((_, i) => legTag(i))}
          {g.bends.map((_, k) => bendTag(k))}
          {dimShapes.map((ds) => (
            <div
              key={ds.d.id}
              className={`sk-tag sk-dimtag ${ds.d.locked ? 'is-locked' : ''} ${ds.bad ? 'is-bad' : ''}`}
              style={{ left: ds.label.x, top: ds.label.y }}
            >
              <button className="sk-val" title="Ustaw wymiar – szyna dopasuje się" onClick={() => editDim(ds.d)}>
                {ds.bad ? `${fmt(ds.d.value)} ≠ ${fmt(ds.val)}` : fmt(ds.val)}
              </button>
              <LockButton
                locked={ds.d.locked}
                what="wymiar"
                onClick={() =>
                  setSketch((sk) => ({
                    ...sk,
                    dims: sk.dims.map((q) =>
                      q.id === ds.d.id ? { ...q, locked: !q.locked, value: Math.round(ds.val * 100) / 100 } : q,
                    ),
                  }))
                }
              />
              <button
                className="sk-x"
                title="Usuń wymiar"
                onClick={() => setSketch((sk) => ({ ...sk, dims: sk.dims.filter((q) => q.id !== ds.d.id) }))}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
          {g.vertices.length > 0 && (
            <div className="sk-tag sk-a" style={{ left: toS(g.vertices[0]).x, top: toS(g.vertices[0]).y }}>
              A
            </div>
          )}
        </div>

        {pop && (
          <div className="sk-pop" style={{ left: pop.x, top: pop.y }}>
            {pop.kind === 'dimType' ? (
              <>
                <span className="sk-pop-title">Jaki wymiar?</span>
                {(
                  [
                    ['h', 'Poziomy'],
                    ['v', 'Pionowy'],
                    ['d', 'Po prostej'],
                  ] as const
                ).map(([t, l]) => (
                  <button
                    key={t}
                    className="bb-btn bb-btn--secondary"
                    onClick={() => {
                      setPop(null);
                      addDim(t, pop.a!, pop.b!);
                    }}
                  >
                    {l}
                  </button>
                ))}
              </>
            ) : (
              <>
                <span className="sk-pop-title">Oś przez ten punkt</span>
                <button
                  className="bb-btn bb-btn--secondary"
                  onClick={() => {
                    setPop(null);
                    addAxis('v', pop.at!);
                  }}
                >
                  Pionowa (x = {fmt(pop.at!.x)})
                </button>
                <button
                  className="bb-btn bb-btn--secondary"
                  onClick={() => {
                    setPop(null);
                    addAxis('h', pop.at!);
                  }}
                >
                  Pozioma (y = {fmt(pop.at!.y)})
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="bb-viewfoot">
        <span className="sk-hint">{hint}</span>
        {conflicts.size > 0 && (
          <span className="vf-cab is-bad">
            <Icon name="stop" size={20} />
            <b>Wymiary w konflikcie: {conflicts.size}</b>
          </span>
        )}
        <span className="vf-mode">
          Wymiary do{' '}
          <b>
            {bar.dimensionMode === 'outside'
              ? 'zewnętrznej krawędzi'
              : bar.dimensionMode === 'inside'
                ? 'wewnętrznej krawędzi'
                : 'osi szyny'}
          </b>
        </span>
      </div>
    </div>
  );
}

function LockButton({ locked, what, onClick }: { locked: boolean; what: string; onClick: () => void }) {
  return (
    <button
      className={`sk-lock ${locked ? 'is-on' : ''}`}
      aria-pressed={locked}
      title={locked ? `Odblokuj ${what}` : `Zablokuj ${what} (nie zmieni się przy przesuwaniu i wymiarach)`}
      onClick={onClick}
    >
      <Icon name={locked ? 'lock' : 'unlock'} size={18} />
    </button>
  );
}
