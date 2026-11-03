import { bendAllowance, machineAngle, minRadius, setback } from './bending';
import type { BendStep, Busbar, Direction, MachineSettings } from './model';

export type IssueCode =
  | 'empty'
  | 'bend-neighbours'
  | 'bend-angle'
  | 'bend-radius'
  | 'leg-length'
  | 'leg-short'
  | 'leg-min'
  | 'hole-diameter'
  | 'hole-outside'
  | 'hole-near-bend'
  | 'hole-width'
  | 'hole-edge'
  | 'hole-overlap'
  | 'hole-bridge'
  | 'stock-length'
  | 'collision';

export interface Issue {
  level: 'error' | 'warning';
  code: IssueCode;
  stepIndex?: number;
  /** Hole the issue refers to, if any. */
  holeId?: string;
  message: string;
}

/** One step's place on the flat (developed) bar. */
export interface FlatSegment {
  stepIndex: number;
  kind: 'straight' | 'bend';
  /** Position on the flat bar where this segment starts, mm. */
  flatStart: number;
  /** Length on the flat bar, mm (net straight / bend allowance). */
  flatLength: number;
}

export interface BendInfo {
  no: number;
  stepIndex: number;
  direction: Direction;
  angle: number;
  machineAngle: number;
  radius: number;
  bendAllowance: number;
  setback: number;
  arcStart: number;
  arcCenter: number;
  arcEnd: number;
  /** Position to set on the machine stop (depends on bendLineReference). */
  position: number;
}

export interface HoleInfo {
  no: number;
  stepIndex: number;
  holeId: string;
  /** Centre position along the leg's straight (tangent) part, from its start, mm. */
  posOnStraight: number;
  /** Centre position on the flat bar from end A, mm. */
  flatPos: number;
  offset: number;
  diameter: number;
  /** Slot length along the bar (= diameter for a round hole), mm. */
  length: number;
}

export interface Analysis {
  segments: FlatSegment[];
  holes: HoleInfo[];
  /** Net straight (tangent-to-tangent) length for each step index; undefined for non-straight steps. */
  netStraight: (number | undefined)[];
  bends: BendInfo[];
  flatLength: number;
  issues: Issue[];
}

export function analyze(bar: Busbar, settings: MachineSettings): Analysis {
  const { steps, section, dimensionMode } = bar;
  const issues: Issue[] = [];

  const setbacks: number[] = steps.map((s) => {
    if (s.kind !== 'bend') return 0;
    if (!(s.angle > 0 && s.angle < 180)) return 0;
    return setback(s.angle, s.radius, section.thickness, dimensionMode);
  });

  // Validation of step order and bend parameters.
  if (steps.length === 0) issues.push({ level: 'error', code: 'empty', message: 'Szyna nie ma żadnych odcinków.' });
  steps.forEach((s, i) => {
    if (s.kind === 'bend') {
      const prev = steps[i - 1];
      const next = steps[i + 1];
      if (!prev || prev.kind !== 'straight' || !next || next.kind !== 'straight') {
        issues.push({
          level: 'error',
          code: 'bend-neighbours',
          stepIndex: i,
          message: 'Gięcie musi mieć odcinek prosty przed i za sobą.',
        });
      }
      if (!(s.angle > 0 && s.angle < 180)) {
        issues.push({
          level: 'error',
          code: 'bend-angle',
          stepIndex: i,
          message: 'Kąt gięcia musi być większy od 0° i mniejszy od 180°.',
        });
      }
      const rMin = minRadius(section);
      if (s.radius < rMin) {
        issues.push({
          level: 'warning',
          code: 'bend-radius',
          stepIndex: i,
          message: `Promień R${fmt(s.radius)} mniejszy niż zalecany R${fmt(rMin)} – ryzyko pęknięcia.`,
        });
      }
    }
    if (s.kind === 'straight' && !(s.length > 0)) {
      issues.push({ level: 'error', code: 'leg-length', stepIndex: i, message: 'Długość odcinka musi być większa od 0.' });
    }
  });

  // Net straight lengths.
  const netStraight: (number | undefined)[] = steps.map((s, i) => {
    if (s.kind !== 'straight') return undefined;
    const before = steps[i - 1]?.kind === 'bend' ? setbacks[i - 1] : 0;
    const after = steps[i + 1]?.kind === 'bend' ? setbacks[i + 1] : 0;
    return s.length - before - after;
  });

  netStraight.forEach((net, i) => {
    if (net === undefined) return;
    const touchesBend = steps[i - 1]?.kind === 'bend' || steps[i + 1]?.kind === 'bend';
    if (net < 0) {
      const needed = (steps[i] as { length: number }).length - net;
      issues.push({
        level: 'error',
        code: 'leg-short',
        stepIndex: i,
        message: `Odcinek za krótki dla tych gięć – minimum ${fmt(needed)} mm.`,
      });
    } else if (touchesBend && net < settings.minLeg) {
      issues.push({
        level: 'warning',
        code: 'leg-min',
        stepIndex: i,
        message: `Prosta część odcinka ${fmt(net)} mm < ${fmt(settings.minLeg)} mm (min. ramię maszyny).`,
      });
    }
  });

  // Flat layout.
  const segments: FlatSegment[] = [];
  const bends: BendInfo[] = [];
  let pos = 0;
  steps.forEach((s, i) => {
    let len = 0;
    if (s.kind === 'straight') {
      len = Math.max(0, netStraight[i] ?? 0);
    } else {
      len = s.angle > 0 && s.angle < 180 ? bendAllowance(s.angle, s.radius, settings.k, section.thickness) : 0;
      bends.push(makeBend(s, i, bends.length + 1, pos, len, setbacks[i], settings));
    }
    segments.push({ stepIndex: i, kind: s.kind, flatStart: pos, flatLength: len });
    pos += len;
  });

  // Holes (on straight parts only): positions first, then numbering along the bar, then checks.
  const holes: HoleInfo[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== 'straight' || !s.holes?.length) return;
    const before = steps[i - 1]?.kind === 'bend' ? setbacks[i - 1] : 0;
    for (const h of s.holes) {
      const posOnStraight = h.position - before;
      holes.push({
        no: 0,
        stepIndex: i,
        holeId: h.id,
        posOnStraight,
        flatPos: segments[i].flatStart + posOnStraight,
        offset: h.offset,
        diameter: h.diameter,
        length: Math.max(h.slot || 0, h.diameter),
      });
    }
  });
  holes.sort((a, b) => a.flatPos - b.flatPos).forEach((h, k) => (h.no = k + 1));

  const T = section.thickness;
  const lastStraight = steps.length - 1 - [...steps].reverse().findIndex((s) => s.kind === 'straight');
  for (const h of holes) {
    const i = h.stepIndex;
    const name = `O${h.no} (${holeLabel(h)})`;
    const push = (level: Issue['level'], code: IssueCode, message: string) =>
      issues.push({ level, code, holeId: h.holeId, stepIndex: i, message });
    const net = Math.max(0, netStraight[i] ?? 0);
    const lo = h.posOnStraight - h.length / 2;
    const hi = h.posOnStraight + h.length / 2;
    const bridge = minBridge(h, T);
    const prevBend = steps[i - 1]?.kind === 'bend';
    const nextBend = steps[i + 1]?.kind === 'bend';

    if (!(h.diameter > 0)) {
      push('error', 'hole-diameter', `Otwór O${h.no}: średnica musi być większa od 0.`);
      continue;
    }
    if (lo < 0 || hi > net) {
      push(
        'error',
        'hole-outside',
        `Otwór ${name} wychodzi poza prostą część odcinka (0–${fmt(net)} mm od ${prevBend ? 'końca łuku' : 'końca szyny'}).`,
      );
    } else {
      const margin = 1.5 * T;
      if ((prevBend && lo < margin) || (nextBend && net - hi < margin)) {
        push('warning', 'hole-near-bend', `Otwór ${name} bliżej niż ${fmt(margin)} mm od gięcia – może się zdeformować.`);
      }
      const startGap = !prevBend && i === 0 ? lo : Infinity;
      const endGap = !nextBend && i === lastStraight ? net - hi : Infinity;
      if (Math.min(startGap, endGap) < bridge) {
        push(
          'warning',
          'hole-edge',
          `Otwór ${name}: tylko ${fmt(Math.min(startGap, endGap))} mm materiału do końca szyny (zalecane ≥ ${fmt(bridge)} mm).`,
        );
      }
    }
    const side = section.width / 2 - Math.abs(h.offset) - h.diameter / 2;
    if (side < 0) {
      push('error', 'hole-width', `Otwór ${name} wychodzi poza szerokość szyny.`);
    } else if (side < bridge) {
      push(
        'warning',
        'hole-edge',
        `Otwór ${name}: tylko ${fmt(side)} mm materiału do boku szyny (zalecane ≥ ${fmt(bridge)} mm).`,
      );
    }
  }

  // Holes on the same leg must not overlap and need a bridge of material between them.
  for (let a = 0; a < holes.length; a++) {
    for (let b = a + 1; b < holes.length; b++) {
      const ha = holes[a];
      const hb = holes[b];
      if (ha.stepIndex !== hb.stepIndex || !(ha.diameter > 0 && hb.diameter > 0)) continue;
      const gap = holeGap(ha, hb);
      const bridge = Math.min(minBridge(ha, T), minBridge(hb, T));
      if (gap < 0) {
        issues.push({
          level: 'error',
          code: 'hole-overlap',
          holeId: hb.holeId,
          stepIndex: hb.stepIndex,
          message: `Otwory O${ha.no} i O${hb.no} nachodzą na siebie.`,
        });
      } else if (gap < bridge) {
        issues.push({
          level: 'warning',
          code: 'hole-bridge',
          holeId: hb.holeId,
          stepIndex: hb.stepIndex,
          message: `Między otworami O${ha.no} i O${hb.no} jest tylko ${fmt(gap)} mm materiału (zalecane ≥ ${fmt(bridge)} mm).`,
        });
      }
    }
  }

  const flatLength = pos;
  if (flatLength > settings.maxLength) {
    issues.push({
      level: 'warning',
      code: 'stock-length',
      message: `Długość cięcia ${fmt(flatLength)} mm przekracza długość handlową ${fmt(settings.maxLength)} mm.`,
    });
  }

  return { segments, holes, netStraight, bends, flatLength, issues };
}

function makeBend(
  s: BendStep,
  stepIndex: number,
  no: number,
  start: number,
  ba: number,
  sb: number,
  settings: MachineSettings,
): BendInfo {
  const center = start + ba / 2;
  const end = start + ba;
  const position = settings.bendLineReference === 'start' ? start : settings.bendLineReference === 'end' ? end : center;
  return {
    no,
    stepIndex,
    direction: s.direction,
    angle: s.angle,
    machineAngle: machineAngle(s.angle, settings),
    radius: s.radius,
    bendAllowance: ba,
    setback: sb,
    arcStart: start,
    arcCenter: center,
    arcEnd: end,
    position,
  };
}

function holeLabel(h: { diameter: number; length: number }): string {
  return h.length > h.diameter ? `${fmt(h.diameter)}×${fmt(h.length)}` : `Ø${fmt(h.diameter)}`;
}

/** Recommended minimum material between a hole and an edge or another hole (rule of thumb). */
export function minBridge(h: { diameter: number }, thickness: number): number {
  return Math.min(thickness, h.diameter / 2);
}

/**
 * Material between two holes of the same leg (negative = overlap). Holes are capsules: a segment
 * along the bar (length − diameter) swept by a circle of the hole radius.
 */
export function holeGap(
  a: { posOnStraight: number; offset: number; diameter: number; length: number },
  b: { posOnStraight: number; offset: number; diameter: number; length: number },
): number {
  const ha = Math.max(0, a.length / 2 - a.diameter / 2);
  const hb = Math.max(0, b.length / 2 - b.diameter / 2);
  const dx = Math.max(0, Math.abs(a.posOnStraight - b.posOnStraight) - ha - hb);
  const dy = Math.abs(a.offset - b.offset);
  return Math.hypot(dx, dy) - a.diameter / 2 - b.diameter / 2;
}

/** Format a number in Polish style with up to 1 decimal place. */
export function fmt(v: number, digits = 1): string {
  return v.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/**
 * How to lay the bar in the machine for each bend. The bar always goes in with end A against the
 * stop; before a bend in the opposite direction to the previous one the bar is turned over, before a
 * bend in the same direction it is not.
 */
export type BendOrientation = 'first' | 'same' | 'flip';

export function bendOrientations(bends: { direction: Direction }[]): BendOrientation[] {
  return bends.map((b, i) => (i === 0 ? 'first' : b.direction === bends[i - 1].direction ? 'same' : 'flip'));
}

export const ORIENTATION_LABEL: Record<BendOrientation, string> = {
  first: 'ułóż wg kierunku',
  same: 'bez obracania',
  flip: 'obróć szynę',
};

/** Polish plural form: plural(2, ['błąd', 'błędy', 'błędów']) → '2 błędy'. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const word = n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
  return `${n} ${word}`;
}
