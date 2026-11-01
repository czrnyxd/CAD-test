import { Box3, Vector3 } from 'three';
import { analyze, type Analysis, type Issue } from './analyze';
import { setback } from './bending';
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

/**
 * Build the parts of a project.
 *
 * Single bar: the project as is.
 * Double bar: both bars are stacked through the thickness at distance d = T + gap. In every bend
 * the inner bar gets the radius from the project (tool radius) and the outer one R + d, so the
 * arcs are concentric and the bars nest. The leg lengths entered by the user describe bar 1; the
 * straight (tangent) parts of bar 2 are equal to those of bar 1, holes keep their place on them.
 */
export function buildAssembly(project: Busbar, settings: MachineSettings): Assembly {
  const dbl = doubleConfig(project);
  if (!dbl.enabled) {
    const analysis = analyze(project, settings);
    const path = buildPath(project, analysis);
    const issues = [...analysis.issues, ...collisionIssues(project, path)];
    return { parts: [{ index: 1, label: 'Szyna', bar: project, analysis, path, offset: 0 }], issues, bbox: path.bbox.clone() };
  }

  const T = project.section.thickness;
  const d = T + Math.max(0, dbl.gap);
  const side2 = dbl.side;
  const side1 = side2 === 'above' ? 'below' : 'above';

  // Bar 1: same legs, radius increased where it is the outer bar.
  const bar1: Busbar = {
    ...project,
    steps: project.steps.map((s) => (s.kind === 'bend' ? { ...s, radius: s.radius + (isOuter(side1, s) ? d : 0) } : s)),
  };
  const an1 = analyze(bar1, settings);
  const path1 = buildPath(bar1, an1);

  // Bar 2: radii for its side, legs rebuilt from the common straight parts.
  const bends2: Step[] = project.steps.map((s) =>
    s.kind === 'bend' ? { ...s, radius: s.radius + (isOuter(side2, s) ? d : 0) } : s,
  );
  const sb = (steps: Step[], i: number) => {
    const s = steps[i];
    if (!s || s.kind !== 'bend' || !(s.angle > 0 && s.angle < 180)) return 0;
    return setback(s.angle, s.radius, T, project.dimensionMode);
  };
  const steps2: Step[] = bends2.map((s, i) => {
    if (s.kind !== 'straight') return s;
    const net = an1.netStraight[i] ?? 0;
    const before1 = sb(bar1.steps, i - 1);
    const before2 = sb(bends2, i - 1);
    const after2 = sb(bends2, i + 1);
    return {
      ...s,
      length: net + before2 + after2,
      holes: s.holes?.map((h) => ({ ...h, position: h.position - before1 + before2 })),
    };
  });
  const bar2: Busbar = { ...project, steps: steps2 };
  const an2 = analyze(bar2, settings);
  const path2 = buildPath(bar2, an2);
  const offset2 = (side2 === 'above' ? 1 : -1) * d;

  const issues: Issue[] = [
    ...an1.issues.map((i) => ({ ...i, message: `Szyna 1: ${i.message}` })),
    ...collisionIssues(bar1, path1).map((i) => ({ ...i, message: `Szyna 1: ${i.message}` })),
    // Most problems of bar 2 mirror bar 1 – report only those that bar 1 does not have.
    ...an2.issues
      .filter((i2) => !an1.issues.some((i1) => i1.code === i2.code && i1.stepIndex === i2.stepIndex && i1.holeId === i2.holeId))
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
  };
}
