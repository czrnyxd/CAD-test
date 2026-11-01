import { bendAllowance, machineAngle, minRadius, setback } from './bending';
import type { BendStep, Busbar, Direction, MachineSettings } from './model';

export interface Issue {
  level: 'error' | 'warning';
  stepIndex?: number;
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
  if (steps.length === 0) issues.push({ level: 'error', message: 'Szyna nie ma żadnych odcinków.' });
  steps.forEach((s, i) => {
    if (s.kind === 'bend') {
      const prev = steps[i - 1];
      const next = steps[i + 1];
      if (!prev || prev.kind !== 'straight' || !next || next.kind !== 'straight') {
        issues.push({ level: 'error', stepIndex: i, message: 'Gięcie musi mieć odcinek prosty przed i za sobą.' });
      }
      if (!(s.angle > 0 && s.angle < 180)) {
        issues.push({ level: 'error', stepIndex: i, message: 'Kąt gięcia musi być większy od 0° i mniejszy od 180°.' });
      }
      const rMin = minRadius(section);
      if (s.radius < rMin) {
        issues.push({
          level: 'warning',
          stepIndex: i,
          message: `Promień R${fmt(s.radius)} mniejszy niż zalecany R${fmt(rMin)} – ryzyko pęknięcia.`,
        });
      }
    }
    if (s.kind === 'straight' && !(s.length > 0)) {
      issues.push({ level: 'error', stepIndex: i, message: 'Długość odcinka musi być większa od 0.' });
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
        stepIndex: i,
        message: `Odcinek za krótki dla tych gięć – minimum ${fmt(needed)} mm.`,
      });
    } else if (touchesBend && net < settings.minLeg) {
      issues.push({
        level: 'warning',
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

  // Holes (on straight parts only).
  const holes: HoleInfo[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== 'straight' || !s.holes?.length) return;
    const before = steps[i - 1]?.kind === 'bend' ? setbacks[i - 1] : 0;
    const net = Math.max(0, netStraight[i] ?? 0);
    const seg = segments[i];
    for (const h of s.holes) {
      const length = Math.max(h.slot || 0, h.diameter);
      const posOnStraight = h.position - before;
      holes.push({
        no: 0,
        stepIndex: i,
        holeId: h.id,
        posOnStraight,
        flatPos: seg.flatStart + posOnStraight,
        offset: h.offset,
        diameter: h.diameter,
        length,
      });
      const lo = posOnStraight - length / 2;
      const hi = posOnStraight + length / 2;
      if (!(h.diameter > 0)) {
        issues.push({ level: 'error', stepIndex: i, message: 'Średnica otworu musi być większa od 0.' });
      } else if (lo < 0 || hi > net) {
        issues.push({
          level: 'error',
          stepIndex: i,
          message: `Otwór ${holeLabel(h)} wychodzi poza prostą część odcinka (0–${fmt(net)} mm od ${before ? 'końca łuku' : 'końca szyny'}).`,
        });
      } else {
        const margin = 1.5 * section.thickness;
        const nearPrev = steps[i - 1]?.kind === 'bend' && lo < margin;
        const nearNext = steps[i + 1]?.kind === 'bend' && net - hi < margin;
        if (nearPrev || nearNext) {
          issues.push({
            level: 'warning',
            stepIndex: i,
            message: `Otwór ${holeLabel(h)} bliżej niż ${fmt(margin)} mm od gięcia – może się zdeformować.`,
          });
        }
      }
      if (Math.abs(h.offset) + h.diameter / 2 > section.width / 2) {
        issues.push({ level: 'error', stepIndex: i, message: `Otwór ${holeLabel(h)} wychodzi poza szerokość szyny.` });
      }
    }
  });
  holes.sort((a, b) => a.flatPos - b.flatPos).forEach((h, k) => (h.no = k + 1));

  const flatLength = pos;
  if (flatLength > settings.maxLength) {
    issues.push({
      level: 'warning',
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
  const position =
    settings.bendLineReference === 'start' ? start : settings.bendLineReference === 'end' ? end : center;
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

function holeLabel(h: { diameter: number; slot: number }): string {
  return h.slot > h.diameter ? `${fmt(h.diameter)}×${fmt(h.slot)}` : `Ø${fmt(h.diameter)}`;
}

/** Format a number in Polish style with up to 1 decimal place. */
export function fmt(v: number, digits = 1): string {
  return v.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
