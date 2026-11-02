import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
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
  type MachineSettings,
  type Section,
  type StraightStep,
} from './model';
import { sanitizeBusbar } from './sanitize';
import { removeStep } from './edit';

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
