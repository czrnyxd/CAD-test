import { Box3, Vector3 } from 'three';
import { analyze, type Analysis, type Issue } from './analyze';
import { buildPath, collisionIssues, type BarPath } from './geometry';
import { DEFAULT_DOUBLE, type BendStep, type Busbar, type DoubleConfig, type MachineSettings, type Step } from './model';

/** One physical bar of the project, ready to display and document. */
export interface BarPart {
  index: 1 | 2;
  label: string;
  /** Bar with the effective radii and leg lengths of this part. */
  bar: Busbar;
  analysis: Analysis;
  path: BarPath;
  /** Displacement of this bar's start along the initial thickness normal (+Y), mm. */
  offset: number;
}

export interface Assembly {
  parts: BarPart[];
  issues: Issue[];
  bbox: Box3;
  /** Double bar: gap between the bars at the middle of each bend arc (they touch only on straight legs). */
  arcGaps: { no: number; gap: number }[];
}

export function doubleConfig(bar: Busbar): DoubleConfig {
  return { ...DEFAULT_DOUBLE, ...bar.double };
}

/**
 * Is the bar lying on the given side the outer one in this bend?
 * A bend "up" turns towards +n, so the bar lying above (on +n) is on the inside.
 */
function isOuter(side: 'above' | 'below', b: BendStep): boolean {
  return (b.direction === 'up') !== (side === 'above');
}

const validBend = (s: Step | undefined): s is BendStep => !!s && s.kind === 'bend' && s.angle > 0 && s.angle < 180;

/**
 * Build the parts of a project.
 *
 * Single bar: the project as is.
 *
 * Double bar: two bars bent separately with the same tool (radius R in every bend), then put
 * together through the thickness at distance d = T + gap. The legs the user entered describe
 * bar 1. The straight legs of bar 2 must be parallel to those of bar 1 at distance d, so at every
 * bend the virtual sharp of bar 2 moves along each leg by d·tan(A/2): its legs are shorter where
 * it is the inner bar and longer where it is the outer one. Holes move with the leg start, so
 * they stay exactly above each other. With equal radii the arcs are not concentric: in a bend the
 * bars do not touch, leaving a gap of (d / cos(A/2) − T) at the middle of the arc.
 */
export function buildAssembly(project: Busbar, settings: MachineSettings): Assembly {
  const dbl = doubleConfig(project);
  if (!dbl.enabled) {
    const analysis = analyze(project, settings);
    const path = buildPath(project, analysis);
    const issues = [...analysis.issues, ...collisionIssues(project, path)];
    return {
      parts: [{ index: 1, label: 'Szyna', bar: project, analysis, path, offset: 0 }],
      issues,
      bbox: path.bbox.clone(),
      arcGaps: [],
    };
  }

  const T = project.section.thickness;
  const d = T + Math.max(0, dbl.gap);
  const side2 = dbl.side;

  const bar1 = project;
  const an1 = analyze(bar1, settings);
  const path1 = buildPath(bar1, an1);

  // Shift of bar 2's virtual sharp along the legs at each bend (+ longer legs, − shorter).
  const shift = (j: number) => {
    const b = project.steps[j];
    if (!validBend(b)) return 0;
    return (isOuter(side2, b) ? 1 : -1) * d * Math.tan((b.angle * Math.PI) / 360);
  };
  const steps2: Step[] = project.steps.map((s, i) => {
    if (s.kind !== 'straight') return s;
    const before = shift(i - 1);
    const after = shift(i + 1);
    return {
      ...s,
      length: s.length + before + after,
      ...(s.holes ? { holes: s.holes.map((h) => ({ ...h, position: h.position + before })) } : {}),
    };
  });
  const bar2: Busbar = { ...project, steps: steps2 };
  const an2 = analyze(bar2, settings);
  const path2 = buildPath(bar2, an2);
  const offset2 = (side2 === 'above' ? 1 : -1) * d;

  const arcGaps = an1.bends.map((b) => ({
    no: b.no,
    gap: d / Math.cos((b.angle * Math.PI) / 360) - T,
  }));

  const issues1 = [...an1.issues, ...collisionIssues(bar1, path1)];
  const issues2 = [...an2.issues, ...collisionIssues(bar2, path2)];
  const issues: Issue[] = [
    ...issues1.map((i) => ({ ...i, message: `Szyna 1: ${i.message}` })),
    // Most problems of bar 2 mirror bar 1 – report only those that bar 1 does not have.
    ...issues2
      .filter((i2) => !issues1.some((i1) => i1.code === i2.code && i1.stepIndex === i2.stepIndex && i1.holeId === i2.holeId))
      .map((i) => ({ ...i, message: `Szyna 2: ${i.message}` })),
  ];

  const bbox = path1.bbox.clone().union(path2.bbox.clone().translate(new Vector3(0, offset2, 0)));
  const sideLabel = side2 === 'above' ? 'nad szyną 1' : 'pod szyną 1';
  return {
    parts: [
      { index: 1, label: 'Szyna 1', bar: bar1, analysis: an1, path: path1, offset: 0 },
      { index: 2, label: `Szyna 2 (${sideLabel})`, bar: bar2, analysis: an2, path: path2, offset: offset2 },
    ],
    issues,
    bbox,
    arcGaps,
  };
}
