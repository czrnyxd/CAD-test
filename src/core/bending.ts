import type { DimensionMode, MachineSettings, Plane, Section } from './model';

export const deg2rad = (deg: number) => (deg * Math.PI) / 180;

/** Material thickness in the bending direction: T for flat bends, W for edge bends. */
export function bendThickness(section: Section, plane: Plane): number {
  return plane === 'flat' ? section.thickness : section.width;
}

export function kFactor(settings: MachineSettings, plane: Plane): number {
  return plane === 'flat' ? settings.kFlat : settings.kEdge;
}

/** Bend allowance: arc length of the neutral axis. BA = A·(R + K·t) */
export function bendAllowance(angleDeg: number, radius: number, k: number, t: number): number {
  return deg2rad(angleDeg) * (radius + k * t);
}

/**
 * Setback: distance from the virtual sharp to the tangent point of the bend, measured along the leg.
 * Depends on which surface the legs are dimensioned to.
 */
export function setback(angleDeg: number, radius: number, t: number, mode: DimensionMode): number {
  const c = mode === 'outside' ? t : mode === 'inside' ? 0 : t / 2;
  return (radius + c) * Math.tan(deg2rad(angleDeg) / 2);
}

/** Bend deduction for outside dimensions: BD = 2·OSSB − BA */
export function bendDeduction(angleDeg: number, radius: number, k: number, t: number): number {
  return 2 * setback(angleDeg, radius, t, 'outside') - bendAllowance(angleDeg, radius, k, t);
}

/** Angle to set on the machine, compensating springback. */
export function machineAngle(angleDeg: number, plane: Plane, settings: MachineSettings): number {
  const pct = plane === 'flat' ? settings.springbackFlatPct : settings.springbackEdgePct;
  return angleDeg * (1 + pct / 100);
}

/** Recommended minimum inner radius (rule of thumb for copper, conservative). */
export function minRadius(section: Section, plane: Plane): number {
  return plane === 'flat' ? section.thickness : section.width;
}
