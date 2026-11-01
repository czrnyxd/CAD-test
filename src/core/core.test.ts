import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { bendAllowance, bendDeduction, setback } from './bending';
import { buildPath, collisionIssues } from './geometry';
import { Vector3 } from 'three';
import { DEFAULT_SETTINGS, bend, newBusbar, straight, twist, type MachineSettings, type Section } from './model';

const S40x10: Section = { width: 40, thickness: 10, material: 'Cu' };
const settings: MachineSettings = { ...DEFAULT_SETTINGS, kFlat: 0.4, kEdge: 0.45, radiusFlat: 10, minLeg: 0 };

describe('bending formulas', () => {
  it('bend allowance 90°, R10, T10, K0.4', () => {
    expect(bendAllowance(90, 10, 0.4, 10)).toBeCloseTo((Math.PI / 2) * 14, 6);
  });
  it('setback depends on dimension mode', () => {
    expect(setback(90, 10, 10, 'outside')).toBeCloseTo(20, 6);
    expect(setback(90, 10, 10, 'inside')).toBeCloseTo(10, 6);
    expect(setback(90, 10, 10, 'centerline')).toBeCloseTo(15, 6);
  });
  it('bend deduction', () => {
    expect(bendDeduction(90, 10, 0.4, 10)).toBeCloseTo(40 - (Math.PI / 2) * 14, 6);
  });
});

describe('analyze', () => {
  it('L-shape flat length = sum of outside legs − BD', () => {
    const bar = newBusbar(S40x10, [straight(100), bend('flat', 90, 'up', 10), straight(100)]);
    const an = analyze(bar, settings);
    expect(an.flatLength).toBeCloseTo(200 - bendDeduction(90, 10, 0.4, 10), 6);
    expect(an.bends).toHaveLength(1);
    expect(an.bends[0].arcStart).toBeCloseTo(80, 6);
    expect(an.bends[0].position).toBeCloseTo(80 + bendAllowance(90, 10, 0.4, 10) / 2, 6);
    expect(an.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('edge bend uses width as bending thickness', () => {
    const bar = newBusbar(S40x10, [straight(300), bend('edge', 90, 'right', 40), straight(300)]);
    const an = analyze(bar, settings);
    expect(an.netStraight[0]).toBeCloseTo(300 - 80, 6);
    expect(an.flatLength).toBeCloseTo(600 - bendDeduction(90, 40, 0.45, 40), 6);
  });

  it('reports too short leg', () => {
    const bar = newBusbar(S40x10, [straight(15), bend('flat', 90, 'up', 10), straight(100)]);
    const an = analyze(bar, settings);
    expect(an.issues.some((i) => i.level === 'error' && i.stepIndex === 0)).toBe(true);
  });

  it('reports bend without straight neighbours', () => {
    const bar = newBusbar(S40x10, [bend('flat', 90, 'up', 10), straight(100)]);
    expect(analyze(bar, settings).issues.some((i) => i.level === 'error' && i.stepIndex === 0)).toBe(true);
  });

  it('twist adds its zone length', () => {
    const bar = newBusbar(S40x10, [straight(100), twist(90, 80), straight(100)]);
    expect(analyze(bar, settings).flatLength).toBeCloseTo(280, 6);
  });
});

describe('geometry', () => {
  it('L-shape outside dimensions match the 3D model bounding box', () => {
    const bar = newBusbar(S40x10, [straight(100), bend('flat', 90, 'up', 10), straight(150)]);
    const an = analyze(bar, settings);
    const path = buildPath(bar, an);
    const size = path.bbox.getSize(new Vector3());
    expect(size.x).toBeCloseTo(100, 1);
    expect(size.y).toBeCloseTo(150, 1);
    expect(size.z).toBeCloseTo(40, 6);
  });

  it('edge bend to the right turns towards +Z', () => {
    const bar = newBusbar(S40x10, [straight(200), bend('edge', 90, 'right', 40), straight(200)]);
    const path = buildPath(bar, analyze(bar, settings));
    const end = path.samples[path.samples.length - 1];
    expect(end.t.z).toBeCloseTo(1, 6);
    const size = path.bbox.getSize(new Vector3());
    expect(size.x).toBeCloseTo(200, 1);
    expect(size.z).toBeCloseTo(200, 1);
    expect(size.y).toBeCloseTo(10, 6);
  });

  it('Z offset keeps legs parallel', () => {
    const bar = newBusbar(S40x10, [
      straight(150),
      bend('flat', 45, 'up', 10),
      straight(80),
      bend('flat', 45, 'down', 10),
      straight(150),
    ]);
    const path = buildPath(bar, analyze(bar, settings));
    const end = path.samples[path.samples.length - 1];
    expect(end.t.x).toBeCloseTo(1, 6);
    expect(end.n.y).toBeCloseTo(1, 6);
  });

  it('detects self collision', () => {
    // Tight spiral of four 90° bends returning onto itself.
    const bar = newBusbar(S40x10, [
      straight(200),
      bend('flat', 90, 'up', 10),
      straight(100),
      bend('flat', 90, 'up', 10),
      straight(100),
      bend('flat', 90, 'up', 10),
      straight(200),
    ]);
    const path = buildPath(bar, analyze(bar, settings));
    expect(collisionIssues(bar, path)).toHaveLength(1);
  });

  it('no collision for simple U', () => {
    const bar = newBusbar(S40x10, [
      straight(150),
      bend('flat', 90, 'up', 10),
      straight(200),
      bend('flat', 90, 'up', 10),
      straight(150),
    ]);
    const path = buildPath(bar, analyze(bar, settings));
    expect(collisionIssues(bar, path)).toHaveLength(0);
  });
});
