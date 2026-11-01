import {
  bendAllowance,
  bendThickness,
  kFactor,
  machineAngle,
  minRadius,
  setback,
} from './bending';
import type { BendStep, Busbar, MachineSettings, Plane, Direction } from './model';

export interface Issue {
  level: 'error' | 'warning';
  stepIndex?: number;
  message: string;
}

/** One step's place on the flat (developed) bar. */
export interface FlatSegment {
  stepIndex: number;
  kind: 'straight' | 'bend' | 'twist';
  /** Position on the flat bar where this segment starts, mm. */
  flatStart: number;
  /** Length on the flat bar, mm (net straight / bend allowance / twist zone). */
  flatLength: number;
}

export interface BendInfo {
  no: number;
  stepIndex: number;
  plane: Plane;
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

export interface TwistInfo {
  no: number;
  stepIndex: number;
  angle: number;
  start: number;
  end: number;
}

export interface Analysis {
  segments: FlatSegment[];
  /** Net straight (tangent-to-tangent) length for each step index; undefined for non-straight steps. */
  netStraight: (number | undefined)[];
  bends: BendInfo[];
  twists: TwistInfo[];
  flatLength: number;
  issues: Issue[];
}

export function analyze(bar: Busbar, settings: MachineSettings): Analysis {
  const { steps, section, dimensionMode } = bar;
  const issues: Issue[] = [];

  const setbacks: number[] = steps.map((s) => {
    if (s.kind !== 'bend') return 0;
    if (!(s.angle > 0 && s.angle < 180)) return 0;
    return setback(s.angle, s.radius, bendThickness(section, s.plane), dimensionMode);
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
      const rMin = minRadius(section, s.plane);
      if (s.radius < rMin) {
        issues.push({
          level: 'warning',
          stepIndex: i,
          message: `Promień R${fmt(s.radius)} mniejszy niż zalecany R${fmt(rMin)} – ryzyko pęknięcia.`,
        });
      }
    }
    if (s.kind === 'twist') {
      if (s.length < 2 * section.width) {
        issues.push({
          level: 'warning',
          stepIndex: i,
          message: `Strefa skrętu krótsza niż 2×szerokość (${fmt(2 * section.width)} mm).`,
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
  const twists: TwistInfo[] = [];
  let pos = 0;
  steps.forEach((s, i) => {
    let len = 0;
    if (s.kind === 'straight') {
      len = Math.max(0, netStraight[i] ?? 0);
    } else if (s.kind === 'bend') {
      const t = bendThickness(section, s.plane);
      len = s.angle > 0 && s.angle < 180 ? bendAllowance(s.angle, s.radius, kFactor(settings, s.plane), t) : 0;
      bends.push(makeBend(s, i, bends.length + 1, pos, len, setbacks[i], settings));
    } else {
      len = Math.max(0, s.length);
      twists.push({ no: twists.length + 1, stepIndex: i, angle: s.angle, start: pos, end: pos + len });
    }
    segments.push({ stepIndex: i, kind: s.kind, flatStart: pos, flatLength: len });
    pos += len;
  });

  const flatLength = pos;
  if (flatLength > settings.maxLength) {
    issues.push({
      level: 'warning',
      message: `Długość cięcia ${fmt(flatLength)} mm przekracza długość handlową ${fmt(settings.maxLength)} mm.`,
    });
  }

  return { segments, netStraight, bends, twists, flatLength, issues };
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
    plane: s.plane,
    direction: s.direction,
    angle: s.angle,
    machineAngle: machineAngle(s.angle, s.plane, settings),
    radius: s.radius,
    bendAllowance: ba,
    setback: sb,
    arcStart: start,
    arcCenter: center,
    arcEnd: end,
    position,
  };
}

/** Format a number in Polish style with up to 1 decimal place. */
export function fmt(v: number, digits = 1): string {
  return v.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
