import { describe, expect, it } from 'vitest';
import { analyze, bendOrientations, plural } from './analyze';
import { bendAllowance, bendDeduction, setback } from './bending';
import { buildAssembly } from './assembly';
import { buildPath, collisionIssues, legDimensions } from './geometry';
import { Vector3 } from 'three';
import {
  DEFAULT_SETTINGS,
  bend,
  newBusbar,
  sectionError,
  sectionKey,
  sectionList,
  straight,
  type CabinetConfig,
  type MachineSettings,
  type Section,
  type StraightStep,
} from './model';
import { sanitizeBusbar } from './sanitize';
import { planSync } from './syncPlan';
import { freeHolePosition, removeStep } from './edit';
import { barToCabinet, cabinetConfig, checkCabinet, phaseAxis, widthAxis } from './cabinet';

const S40x10: Section = { width: 40, thickness: 10, material: 'Cu' };
const settings: MachineSettings = { ...DEFAULT_SETTINGS, k: 0.4, radius: 10, minLeg: 0 };

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
    const bar = newBusbar(S40x10, [straight(100), bend(90, 'up', 10), straight(100)]);
    const an = analyze(bar, settings);
    expect(an.flatLength).toBeCloseTo(200 - bendDeduction(90, 10, 0.4, 10), 6);
    expect(an.bends).toHaveLength(1);
    expect(an.bends[0].arcStart).toBeCloseTo(80, 6);
    expect(an.bends[0].position).toBeCloseTo(80 + bendAllowance(90, 10, 0.4, 10) / 2, 6);
    expect(an.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('reports too short leg', () => {
    const bar = newBusbar(S40x10, [straight(15), bend(90, 'up', 10), straight(100)]);
    const an = analyze(bar, settings);
    expect(an.issues.some((i) => i.level === 'error' && i.stepIndex === 0)).toBe(true);
  });

  it('reports bend without straight neighbours', () => {
    const bar = newBusbar(S40x10, [bend(90, 'up', 10), straight(100)]);
    expect(analyze(bar, settings).issues.some((i) => i.level === 'error' && i.stepIndex === 0)).toBe(true);
  });
});

describe('machine setting', () => {
  it('warns when the angle with springback reaches 180°', () => {
    const bar = { ...newBusbar(S40x10, [straight(400), bend(170, 'up', 10), straight(400)]) };
    bar.dimensionMode = 'centerline';
    const codes = (springbackPct: number) => analyze(bar, { ...settings, springbackPct }).issues.map((i) => i.code);
    expect(codes(2)).not.toContain('bend-setting'); // 173,4°
    expect(codes(10)).toContain('bend-setting'); // 187°
  });
});

describe('geometry', () => {
  it('L-shape outside dimensions match the 3D model bounding box', () => {
    const bar = newBusbar(S40x10, [straight(100), bend(90, 'up', 10), straight(150)]);
    const an = analyze(bar, settings);
    const path = buildPath(bar, an);
    const size = path.bbox.getSize(new Vector3());
    expect(size.x).toBeCloseTo(100, 1);
    expect(size.y).toBeCloseTo(150, 1);
    expect(size.z).toBeCloseTo(40, 6);
  });

  it('Z offset keeps legs parallel', () => {
    const bar = newBusbar(S40x10, [straight(150), bend(45, 'up', 10), straight(80), bend(45, 'down', 10), straight(150)]);
    const path = buildPath(bar, analyze(bar, settings));
    const end = path.samples[path.samples.length - 1];
    expect(end.t.x).toBeCloseTo(1, 6);
    expect(end.n.y).toBeCloseTo(1, 6);
  });

  it('detects self collision', () => {
    // Tight spiral of four 90° bends returning onto itself.
    const bar = newBusbar(S40x10, [
      straight(200),
      bend(90, 'up', 10),
      straight(100),
      bend(90, 'up', 10),
      straight(100),
      bend(90, 'up', 10),
      straight(200),
    ]);
    const path = buildPath(bar, analyze(bar, settings));
    expect(collisionIssues(bar, path)).toHaveLength(1);
  });

  it('no collision for simple U', () => {
    const bar = newBusbar(S40x10, [straight(150), bend(90, 'up', 10), straight(200), bend(90, 'up', 10), straight(150)]);
    const path = buildPath(bar, analyze(bar, settings));
    expect(collisionIssues(bar, path)).toHaveLength(0);
  });

  const collides = (section: Section, steps: Parameters<typeof newBusbar>[1]) => {
    const bar = newBusbar(section, steps);
    return collisionIssues(bar, buildPath(bar, analyze(bar, settings))).length > 0;
  };

  it('detects a bar crossing itself for every width', () => {
    // Two 120° bends in the same direction: the last leg runs back through the first one.
    for (const width of [20, 40, 60, 80, 100, 120, 200]) {
      const section: Section = { width, thickness: 10, material: 'Cu' };
      expect(collides(section, [straight(150), bend(120, 'up', 10), straight(75), bend(120, 'up', 10), straight(150)])).toBe(
        true,
      );
    }
  });

  it('detects a long thin bar crossing itself', () => {
    const thin: Section = { width: 12, thickness: 2, material: 'Cu' };
    expect(collides(thin, [straight(1800), bend(120, 'up', 4), straight(60), bend(120, 'up', 4), straight(1800)])).toBe(true);
  });

  it('detects legs folded back onto each other (more than half a turn)', () => {
    expect(collides(S40x10, [straight(150), bend(100, 'up', 10), straight(50), bend(100, 'up', 10), straight(150)])).toBe(true);
  });

  it('no collision for a single bend of any angle and radius', () => {
    for (const thickness of [2, 5, 10]) {
      const section: Section = { width: 40, thickness, material: 'Cu' };
      for (const radius of [0, thickness / 2, thickness, 3 * thickness, 20 * thickness]) {
        for (let angle = 5; angle <= 175; angle += 5) {
          // Centre line dimensions, so that the legs are long enough for every angle.
          const bar = { ...newBusbar(section, [straight(3000), bend(angle, 'up', radius), straight(3000)]) };
          bar.dimensionMode = 'centerline';
          const an = analyze(bar, settings);
          if (an.issues.some((i) => i.code === 'leg-short')) continue;
          expect(collisionIssues(bar, buildPath(bar, an)), `T${thickness} R${radius} ${angle}°`).toHaveLength(0);
        }
      }
    }
  });

  it('no collision for legs that only touch (U with inner radius 0 and no straight part between the bends)', () => {
    // Outside dimensions: setback = T = 10 per bend, so the leg between the bends has no straight part.
    expect(collides(S40x10, [straight(150), bend(90, 'up', 0), straight(20), bend(90, 'up', 0), straight(150)])).toBe(false);
  });

  it('no collision for offsets and steps (bends in opposite directions)', () => {
    for (const angle of [15, 45, 90, 135]) {
      expect(
        collides(S40x10, [straight(200), bend(angle, 'up', 10), straight(150), bend(angle, 'down', 10), straight(200)]),
      ).toBe(false);
    }
  });

  it('an end stopping short of another leg is not a collision, an end pushed into it is', () => {
    // Rectangular spiral: the last leg comes back down towards the first one (its upper face is at y = T/2 = 5).
    const spiral = (last: number) => [
      straight(300),
      bend(90, 'up', 10),
      straight(150),
      bend(90, 'up', 10),
      straight(150),
      bend(90, 'up', 10),
      straight(last),
    ];
    const probe = newBusbar(S40x10, spiral(60));
    const endY = buildPath(probe, analyze(probe, settings)).samples.at(-1)!.p.y;
    expect(endY).toBeGreaterThan(5);
    // Lengthening the last leg lowers its end by the same amount.
    expect(collides(S40x10, spiral(60 + (endY - 5) - 1))).toBe(false); // 1 mm gap
    expect(collides(S40x10, spiral(60 + (endY - 5) + 2))).toBe(true); // 2 mm into the first leg
  });
});

describe('reading projects (import / older versions)', () => {
  const base = () => ({ ...newBusbar(S40x10, [straight(100)]) }) as unknown as Record<string, unknown>;

  it('keeps the twist length and hole positions when a twist is removed', () => {
    const res = sanitizeBusbar(
      {
        ...base(),
        steps: [
          { id: 'a', kind: 'straight', length: 100 },
          { id: 'b', kind: 'twist', angle: 90, length: 80 },
          { id: 'c', kind: 'straight', length: 50, holes: [{ id: 'h', position: 20, offset: 0, diameter: 13, slot: 0 }] },
        ],
      },
      settings,
    );
    const st = res.bar!.steps[0] as StraightStep;
    expect(res.bar!.steps).toHaveLength(1);
    expect(st.length).toBe(230);
    expect(st.holes![0].position).toBe(200);
    expect(res.changes.some((c) => c.includes('skręt'))).toBe(true);
  });

  it('converts edge bends with a notice and does not turn 0° into 90°', () => {
    const res = sanitizeBusbar(
      {
        ...base(),
        steps: [
          { id: 'a', kind: 'straight', length: 100 },
          { id: 'd', kind: 'bend', plane: 'edge', angle: 90, direction: 'right', radius: 40 },
          { id: 'e', kind: 'straight', length: 70 },
          { id: 'f', kind: 'bend', angle: 0, direction: 'up', radius: 10 },
          { id: 'g', kind: 'straight', length: 70 },
        ],
      },
      settings,
    );
    expect(res.bar!.steps[1]).toMatchObject({ direction: 'down', radius: settings.radius });
    expect(res.bar!.steps[3]).toMatchObject({ angle: 0 });
    expect(res.changes.some((c) => c.includes('na kant'))).toBe(true);
    expect(analyze(res.bar!, settings).issues.some((i) => i.code === 'bend-angle')).toBe(true);
  });

  it('converts numeric strings instead of concatenating them', () => {
    const raw = {
      ...base(),
      section: { width: '40', thickness: '10', material: 'Cu' },
      steps: [{ kind: 'straight', length: '332' }],
    };
    const res = sanitizeBusbar(raw, settings);
    expect(res.bar!.section).toEqual({ width: 40, thickness: 10, material: 'Cu' });
    expect(analyze(res.bar!, settings).flatLength).toBe(332);
  });

  it('rejects files without a usable section or steps', () => {
    expect(sanitizeBusbar({ ...base(), section: { width: null } }, settings).bar).toBeNull();
    expect(sanitizeBusbar({ ...base(), section: { width: 40, thickness: -1 } }, settings).bar).toBeNull();
    expect(sanitizeBusbar({ ...base(), steps: 'x' }, settings).bar).toBeNull();
    expect(sanitizeBusbar({ ...base(), steps: [] }, settings).bar).toBeNull();
    expect(sanitizeBusbar(null, settings).bar).toBeNull();
    expect(sanitizeBusbar('abc', settings).error).toBeTruthy();
  });

  it('defaults a missing dimension mode to outside and reports it', () => {
    const raw = base();
    delete raw.dimensionMode;
    const res = sanitizeBusbar(raw, settings);
    expect(res.bar!.dimensionMode).toBe('outside');
    expect(res.changes).toHaveLength(1);
  });

  it('drops invalid holes and sanitizes the double-bar config', () => {
    const res = sanitizeBusbar(
      {
        ...base(),
        double: { enabled: true, side: 'sideways', gap: 'x' },
        steps: [
          {
            kind: 'straight',
            length: 100,
            holes: [
              { position: 'a', diameter: 13 },
              { position: 50, diameter: 13 },
            ],
          },
        ],
      },
      settings,
    );
    expect((res.bar!.steps[0] as StraightStep).holes).toHaveLength(1);
    expect(res.bar!.double).toEqual({ enabled: true, side: 'above', gap: 0 });
    expect(res.changes).toHaveLength(1);
  });

  it('a valid current project passes without changes', () => {
    const bar = newBusbar(S40x10, [
      straight(100, [{ position: 50, offset: 0, diameter: 13, slot: 0 }]),
      bend(90, 'up', 10),
      straight(80),
    ]);
    const res = sanitizeBusbar(JSON.parse(JSON.stringify(bar)), settings);
    expect(res.changes).toEqual([]);
    expect(res.bar).toEqual(bar);
  });
});

describe('holes', () => {
  it('hole position on the flat bar', () => {
    const bar = newBusbar(S40x10, [
      straight(100, [{ position: 30, offset: 0, diameter: 13, slot: 0 }]),
      bend(90, 'up', 10),
      straight(150, [{ position: 100, offset: 5, diameter: 13, slot: 20 }]),
    ]);
    const an = analyze(bar, settings);
    expect(an.holes).toHaveLength(2);
    expect(an.holes[0].flatPos).toBeCloseTo(30, 6);
    // second leg: straight part starts after setback 20, flat start = 80 + BA
    expect(an.holes[1].flatPos).toBeCloseTo(80 + bendAllowance(90, 10, 0.4, 10) + (100 - 20), 6);
    expect(an.holes[1].length).toBe(20);
    expect(an.issues).toHaveLength(0);
  });

  it('reports hole inside the bend zone', () => {
    const bar = newBusbar(S40x10, [
      straight(100, [{ position: 95, offset: 0, diameter: 13, slot: 0 }]),
      bend(90, 'up', 10),
      straight(100),
    ]);
    expect(analyze(bar, settings).issues.some((i) => i.level === 'error' && i.stepIndex === 0)).toBe(true);
  });

  it('reports hole outside the width', () => {
    const bar = newBusbar(S40x10, [straight(100, [{ position: 50, offset: 15, diameter: 13, slot: 0 }])]);
    expect(analyze(bar, settings).issues.some((i) => i.level === 'error')).toBe(true);
  });
});

describe('double bar (both bars bent separately with the same tool)', () => {
  type Part = ReturnType<typeof buildAssembly>['parts'][number];
  const holeWorld = (part: Part, k: number) => {
    const h = part.analysis.holes[k];
    const f = part.path.samples[part.path.stepRanges[h.stepIndex][0]];
    return f.p
      .clone()
      .addScaledVector(f.t, h.posOnStraight)
      .addScaledVector(f.w, h.offset)
      .add(new Vector3(0, part.offset, 0));
  };
  /** Distance of a point from the centre line of a part (min over densely sampled segments). */
  const distToCentreline = (part: Part, p: Vector3) => {
    let best = Infinity;
    const s = part.path.samples;
    const off = new Vector3(0, part.offset, 0);
    for (let k = 1; k < s.length; k++) {
      const a = s[k - 1].p.clone().add(off);
      const b = s[k].p.clone().add(off);
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
      best = Math.min(best, a.addScaledVector(ab, t).distanceTo(p));
    }
    return best;
  };

  const shapes = {
    L: () => [
      straight(200, [{ position: 50, offset: 0, diameter: 13, slot: 0 }]),
      bend(90, 'up', 10),
      straight(150, [{ position: 100, offset: 0, diameter: 13, slot: 0 }]),
    ],
    Z: () => [
      straight(150, [{ position: 40, offset: 5, diameter: 13, slot: 0 }]),
      bend(45, 'up', 10),
      straight(120, [{ position: 60, offset: 0, diameter: 11, slot: 20 }]),
      bend(90, 'down', 10),
      straight(160, [{ position: 90, offset: -8, diameter: 13, slot: 0 }]),
    ],
  };
  const make = (
    shape: keyof typeof shapes,
    side: 'above' | 'below',
    gap: number,
    mode: 'outside' | 'inside' | 'centerline' = 'outside',
  ) => ({
    ...newBusbar(S40x10, shapes[shape]()),
    dimensionMode: mode,
    double: { enabled: true, side, gap },
  });

  it('reports a collision of bar 2 with itself even when bar 1 is fine', () => {
    // Rectangular spiral; bar 2 lies inside it, so its end reaches its own first leg before the end of bar 1 does.
    const spiral = (last: number) => [
      straight(300),
      bend(90, 'up', 10),
      straight(150),
      bend(90, 'up', 10),
      straight(150),
      bend(90, 'up', 10),
      straight(last),
    ];
    const probe = newBusbar(S40x10, spiral(60));
    const endY = buildPath(probe, analyze(probe, settings)).samples.at(-1)!.p.y;
    // End of bar 1 stops 1 mm above its first leg.
    const bar = { ...newBusbar(S40x10, spiral(60 + (endY - 5) - 1)), double: { enabled: true, side: 'above' as const, gap: 0 } };
    const collisions = buildAssembly(bar, settings).issues.filter((i) => i.code === 'collision');
    expect(collisions).toHaveLength(1);
    expect(collisions[0].message).toMatch(/^Szyna 2:/);
    expect(buildAssembly({ ...bar, double: undefined }, settings).issues.some((i) => i.code === 'collision')).toBe(false);
  });

  it('both bars use the tool radius in every bend', () => {
    const [p1, p2] = buildAssembly(make('Z', 'above', 2), settings).parts;
    for (const p of [p1, p2]) for (const s of p.bar.steps) if (s.kind === 'bend') expect(s.radius).toBe(10);
  });

  it('inner bar legs are d·tan(A/2) shorter per bend, outer longer', () => {
    const [p1, p2] = buildAssembly(make('L', 'above', 0), settings).parts; // bar 2 inside the 90° bend
    expect((p2.bar.steps[0] as StraightStep).length).toBeCloseTo(200 - 10, 6);
    expect((p2.bar.steps[2] as StraightStep).length).toBeCloseTo(150 - 10, 6);
    expect(p2.analysis.flatLength).toBeLessThan(p1.analysis.flatLength);
    const [, q2] = buildAssembly(make('L', 'below', 0), settings).parts; // bar 2 outside
    expect((q2.bar.steps[0] as StraightStep).length).toBeCloseTo(210, 6);
  });

  for (const shape of ['L', 'Z'] as const)
    for (const side of ['above', 'below'] as const)
      for (const gap of [0, 3])
        for (const mode of ['outside', 'inside', 'centerline'] as const)
          it(`${shape}, bar 2 ${side}, gap ${gap}, ${mode}: legs parallel at T+gap, holes coaxial, no overlap`, () => {
            const asm = buildAssembly(make(shape, side, gap, mode), settings);
            const [p1, p2] = asm.parts;
            const d = 10 + gap;
            // straight legs: bar 2's leg lies on the line of bar 1's leg shifted by d along its normal
            p2.bar.steps.forEach((st, i) => {
              if (st.kind !== 'straight') return;
              const f1 = p1.path.samples[p1.path.stepRanges[i][0]];
              for (const k of p2.path.stepRanges[i]) {
                const v = p2.path.samples[k].p
                  .clone()
                  .add(new Vector3(0, p2.offset, 0))
                  .sub(f1.p);
                expect(Math.abs(v.dot(f1.n))).toBeCloseTo(d, 4);
                expect(v.dot(f1.w)).toBeCloseTo(0, 6);
              }
            });
            // holes: the line between matching hole centres is along the thickness normal, length d
            p1.analysis.holes.forEach((_, k) => {
              const a = holeWorld(p1, k);
              const b = holeWorld(p2, k);
              expect(a.distanceTo(b)).toBeCloseTo(d, 4);
            });
            // nowhere closer than d (bars never overlap, arcs only open a gap)
            for (const sm of p2.path.samples) {
              const pt = sm.p.clone().add(new Vector3(0, p2.offset, 0));
              expect(distToCentreline(p1, pt)).toBeGreaterThan(d - 1e-6);
            }
            expect(asm.issues.filter((x) => x.level === 'error')).toHaveLength(0);
          });

  it('reports the arc gap', () => {
    const asm = buildAssembly(make('L', 'above', 0), settings);
    expect(asm.arcGaps[0].gap).toBeCloseTo(10 * Math.SQRT2 - 10, 6);
  });
});

describe('editing steps', () => {
  const h = (position: number) => ({ position, offset: 0, diameter: 13, slot: 0 });

  it('removing a bend merges the legs and keeps hole positions on the bar', () => {
    const steps = [straight(100, [h(30)]), bend(90, 'up', 10), straight(150, [h(60)])];
    const out = removeStep(steps, 1);
    expect(out).toHaveLength(1);
    const leg = out[0] as StraightStep;
    expect(leg.length).toBe(250);
    expect(leg.holes!.map((x) => x.position)).toEqual([30, 160]);
  });

  it('removing a leg removes the bend before it (or after it for the first leg)', () => {
    const steps = [straight(100), bend(90, 'up', 10), straight(150), bend(45, 'down', 10), straight(80)];
    expect(removeStep(steps, 4).map((s) => s.kind)).toEqual(['straight', 'bend', 'straight']);
    expect((removeStep(steps, 4)[1] as { angle: number }).angle).toBe(90);
    expect(removeStep(steps, 0).map((s) => s.kind)).toEqual(['straight', 'bend', 'straight']);
    expect((removeStep(steps, 0)[1] as { angle: number }).angle).toBe(45);
  });

  it('the last leg cannot be removed', () => {
    const steps = [straight(100)];
    expect(removeStep(steps, 0)).toBe(steps);
  });
});

describe('bend line reference and dimension modes', () => {
  const bar = newBusbar(S40x10, [straight(100), bend(90, 'up', 10), straight(100)]);
  const ba = bendAllowance(90, 10, 0.4, 10);

  it('start / centre / end of the bend zone', () => {
    expect(analyze(bar, { ...settings, bendLineReference: 'start' }).bends[0].position).toBeCloseTo(80, 6);
    expect(analyze(bar, { ...settings, bendLineReference: 'center' }).bends[0].position).toBeCloseTo(80 + ba / 2, 6);
    expect(analyze(bar, { ...settings, bendLineReference: 'end' }).bends[0].position).toBeCloseTo(80 + ba, 6);
  });

  it('hole on the second leg in inside and centerline modes', () => {
    for (const [mode, sb] of [
      ['inside', 10],
      ['centerline', 15],
    ] as const) {
      const b = {
        ...newBusbar(S40x10, [
          straight(100),
          bend(90, 'up', 10),
          straight(100, [{ position: 50, offset: 0, diameter: 13, slot: 0 }]),
        ]),
        dimensionMode: mode,
      };
      const an = analyze(b, settings);
      expect(an.holes[0].posOnStraight).toBeCloseTo(50 - sb, 6);
      expect(an.holes[0].flatPos).toBeCloseTo(100 - sb + ba + (50 - sb), 6);
    }
  });
});

describe('hole checks', () => {
  const leg = (...holes: { position: number; offset?: number; diameter?: number; slot?: number }[]) =>
    newBusbar(S40x10, [
      straight(
        200,
        holes.map((x) => ({ offset: 0, diameter: 13, slot: 0, ...x })),
      ),
    ]);
  const codes = (b: ReturnType<typeof leg>) => analyze(b, settings).issues.map((i) => `${i.level}:${i.code}`);

  it('overlapping holes are an error, thin bridge a warning, enough material is fine', () => {
    expect(codes(leg({ position: 50 }, { position: 55 }))).toContain('error:hole-overlap');
    expect(codes(leg({ position: 50 }, { position: 66 }))).toContain('warning:hole-bridge'); // 3 mm between
    expect(codes(leg({ position: 50 }, { position: 80 }))).toEqual([]);
  });

  it('slots are treated as capsules', () => {
    // slot 13×40 centred at 60 spans 40..80; a Ø13 hole at 90 leaves 3.5 mm
    expect(codes(leg({ position: 60, slot: 40 }, { position: 90 }))).toContain('warning:hole-bridge');
    expect(codes(leg({ position: 60, slot: 40 }, { position: 84 }))).toContain('error:hole-overlap');
  });

  it('too little material to the bar end or side is a warning', () => {
    expect(codes(leg({ position: 7 }))).toContain('warning:hole-edge'); // 0.5 mm to end A
    expect(codes(leg({ position: 100, offset: 13 }))).toContain('warning:hole-edge'); // 0.5 mm to the side
    expect(codes(leg({ position: 100, offset: 14 }))).toContain('error:hole-width');
  });
});

describe('leg dimension reference points', () => {
  const shapes = [
    [straight(200), bend(90, 'up', 10), straight(150)],
    [straight(150), bend(45, 'up', 10), straight(80), bend(45, 'down', 10), straight(150)],
    [straight(120), bend(30, 'down', 15), straight(60), bend(120, 'up', 10), straight(130)],
    [straight(300)],
  ];
  for (const mode of ['outside', 'inside', 'centerline'] as const)
    shapes.forEach((steps, k) =>
      it(`shape ${k + 1}, ${mode}: measured distance equals the entered leg length`, () => {
        const bar = {
          ...newBusbar(
            S40x10,
            steps.map((s) => ({ ...s })),
          ),
          dimensionMode: mode,
        };
        const path = buildPath(bar, analyze(bar, settings));
        const dims = legDimensions(bar, path);
        const legs = bar.steps.filter((s) => s.kind === 'straight') as StraightStep[];
        expect(dims).toHaveLength(legs.length);
        dims.forEach((d, n) => expect(d.length).toBeCloseTo(legs[n].length, 6));
      }),
    );

  it('outside reference of an L lies on the outer faces (bounding box corner)', () => {
    const bar = newBusbar(S40x10, [straight(100), bend(90, 'up', 10), straight(150)]);
    const path = buildPath(bar, analyze(bar, settings));
    const [d1, d2] = legDimensions(bar, path);
    // the virtual sharp of the outer faces is the outer corner of the bounding box: x = 100, y = −T/2
    expect(d1.to.x).toBeCloseTo(100, 6);
    expect(d1.to.y).toBeCloseTo(-5, 6);
    expect(d2.from.distanceTo(d1.to)).toBeCloseTo(0, 6);
  });
});

describe('custom sections', () => {
  it('validates width and thickness', () => {
    expect(sectionError(63, 10)).toBeNull();
    expect(sectionError(3, 1)).toMatch(/Szerokość/);
    expect(sectionError(63, 0)).toMatch(/Grubość/);
    expect(sectionError(20, 20)).toMatch(/mniejsza/);
  });

  it('merges standard, custom and current sections without duplicates, sorted', () => {
    const custom = [
      { width: 63, thickness: 10, material: 'Cu' as const },
      { width: 40, thickness: 10, material: 'Cu' as const }, // already standard
    ];
    const list = sectionList(custom, { width: 75, thickness: 8, material: 'Cu' });
    const keys = list.map(sectionKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('63x10');
    expect(keys).toContain('75x8');
    expect(keys.indexOf('60x10')).toBeLessThan(keys.indexOf('63x10'));
    expect(keys.indexOf('63x10')).toBeLessThan(keys.indexOf('75x8'));
  });

  it('a custom section works in the calculations', () => {
    const bar = newBusbar({ width: 63, thickness: 8, material: 'Cu' }, [straight(200), bend(90, 'up', 8), straight(150)]);
    const an = analyze(bar, settings);
    expect(an.flatLength).toBeCloseTo(350 - bendDeduction(90, 8, 0.4, 8), 6);
  });
});

describe('bar orientation in the machine', () => {
  it('turn the bar over only when the direction changes', () => {
    const o = bendOrientations([
      { direction: 'up' },
      { direction: 'up' },
      { direction: 'down' },
      { direction: 'down' },
      { direction: 'up' },
    ]);
    expect(o).toEqual(['first', 'same', 'flip', 'same', 'flip']);
  });
});

describe('new hole position', () => {
  it('middle of an empty leg, away from existing holes otherwise', () => {
    expect(freeHolePosition([], 0, 180, 13)).toBe(90);
    const second = freeHolePosition([90], 0, 180, 13, 10);
    expect(Math.abs(second - 90)).toBeGreaterThan(60);
    const third = freeHolePosition([90, second], 0, 180, 13, 10);
    expect(Math.min(Math.abs(third - 90), Math.abs(third - second))).toBeGreaterThan(30);
  });
});

describe('polish plural', () => {
  it('uses one / few / many forms', () => {
    const f: [string, string, string] = ['gięcie', 'gięcia', 'gięć'];
    expect(plural(1, f)).toBe('1 gięcie');
    expect(plural(2, f)).toBe('2 gięcia');
    expect(plural(5, f)).toBe('5 gięć');
    expect(plural(0, f)).toBe('0 gięć');
    expect(plural(12, f)).toBe('12 gięć');
    expect(plural(22, f)).toBe('22 gięcia');
  });
});

describe('sync plan', () => {
  const b = (id: string, updatedAt: string) => ({ ...newBusbar(S40x10, [straight(100)]), id, updatedAt });
  const T = (h: number) => `2026-11-01T${String(h).padStart(2, '0')}:00:00.000Z`;

  it('pushes local-only and newer, applies remote-only and newer', () => {
    const local = { a: b('a', T(10)), b: b('b', T(12)), c: b('c', T(10)) };
    const remote = [b('b', T(11)), b('c', T(13)), b('d', T(9))];
    const plan = planSync(local, remote, [], []);
    expect(plan.toPush.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(plan.toApply.map((x) => x.id).sort()).toEqual(['c', 'd']);
  });

  it('deletion on another device removes the local copy unless it was changed later', () => {
    const local = { a: b('a', T(10)), e: b('e', T(14)) };
    const plan = planSync(
      local,
      [],
      [
        { id: 'a', deletedAt: T(11) },
        { id: 'e', deletedAt: T(11) },
      ],
      [],
    );
    expect(plan.toRemoveLocal).toEqual(['a']);
    expect(plan.toPush.map((x) => x.id)).toEqual(['e']);
  });

  it('deletion here is sent to the server unless the server copy is newer', () => {
    const remote = [b('x', T(10)), b('y', T(15))];
    const plan = planSync(
      {},
      remote,
      [],
      [
        { id: 'x', deletedAt: T(12) },
        { id: 'y', deletedAt: T(12) },
      ],
    );
    expect(plan.toDeleteRemote).toEqual(['x']);
    expect(plan.toApply.map((p) => p.id)).toEqual(['y']);
  });

  it('nothing to do when both sides are equal', () => {
    const plan = planSync({ a: b('a', T(10)) }, [b('a', T(10))], [], []);
    expect(plan).toEqual({ toPush: [], toApply: [], toRemoveLocal: [], toDeleteRemote: [] });
  });
});

describe('reference cabinet', () => {
  const L = (bar: ReturnType<typeof newBusbar>, cab: Partial<CabinetConfig>) =>
    checkCabinet(
      buildAssembly(bar, settings),
      cabinetConfig({ ...cab, enabled: true }),
      bar.section.width,
      bar.section.thickness,
    );

  it('places end A and the bar direction in the cabinet', () => {
    const c = cabinetConfig({ a: { x: 100, y: 1500, z: 200 }, heading: '+x', upSide: '+z' });
    const m = barToCabinet(c);
    expect(new Vector3(0, 0, 0).applyMatrix4(m).toArray()).toEqual([100, 1500, 200]);
    const p = new Vector3(10, 0, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(110);
    // Bend "up" turns towards the front, so the width runs vertically (w = t × n = −y).
    expect(widthAxis(c)).toBe('-y');
    expect(phaseAxis({ ...c, phaseDir: -1 })).toBe('+y');
  });

  it('keeps bend direction perpendicular to the bar', () => {
    expect(cabinetConfig({ heading: '+z', upSide: '-z' }).upSide).not.toMatch(/z/);
  });

  it('measures the gap to the frame and finds collisions', () => {
    const bar = newBusbar(S40x10, [straight(500)]);
    // Straight bar 40×10 along x at the back, 100 mm from the back frame plane, starting right of the left upright.
    const ok = L(bar, { bays: [800], post: 50, a: { x: 100, y: 1000, z: 100 }, heading: '+x', upSide: '+z', phases: 1 });
    expect(ok.hits).toEqual([]);
    expect(ok.outside).toBe(false);
    // Nearest: the back left upright (x ≤ 50, z ≤ 50); bar starts at x = 100, its back face is at z = 95.
    expect(ok.clearance).toBeCloseTo(Math.hypot(50, 45), 1);
    const hit = L(bar, { bays: [800], post: 50, a: { x: 20, y: 1000, z: 30 }, heading: '+x', upSide: '+z', phases: 1 });
    expect(hit.hits.length).toBeGreaterThan(0);
    expect(hit.clearance).toBe(0);
    const out = L(bar, {
      bays: [400],
      post: 50,
      a: { x: 100, y: 1000, z: 300 },
      heading: '+x',
      upSide: '+z',
      phases: 1,
      depth: 600,
    });
    expect(out.outside).toBe(true);
  });

  it('stacks phases across the bar width', () => {
    const bar = newBusbar(S40x10, [straight(300)]);
    const r = L(bar, { a: { x: 100, y: 1500, z: 300 }, phases: 3, pitch: 150, phaseDir: 1 });
    // Width is vertical (−y): three phases 150 mm apart, each 40 mm high.
    expect(r.bars.max.y - r.bars.min.y).toBeCloseTo(340, 0);
    expect(r.phasesOverlap).toBe(false);
    expect(L(bar, { phases: 2, pitch: 30 }).phasesOverlap).toBe(true);
  });

  it('reads a stored cabinet and repairs bad values', () => {
    const bar = newBusbar(S40x10, [straight(300)]);
    const res = sanitizeBusbar(
      {
        ...bar,
        cabinet: { enabled: true, bays: [800, 'x', 600], depth: -5, heading: '+y', upSide: '+y', phases: 9, a: { x: '120,5' } },
      },
      settings,
    );
    const c = res.bar!.cabinet!;
    expect(c.bays).toEqual([800, 600]);
    expect(c.depth).toBe(600);
    expect(c.phases).toBe(4);
    expect(c.a.x).toBe(120.5);
    expect(c.upSide[1]).not.toBe('y');
  });
});
