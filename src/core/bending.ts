import type { DimensionMode, MachineSettings, Section } from './model';

export const deg2rad = (deg: number) => (deg * Math.PI) / 180;

/** Bend allowance: arc length of the neutral axis. BA = A·(R + K·T) */
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
export function machineAngle(angleDeg: number, settings: MachineSettings): number {
  return angleDeg * (1 + settings.springbackPct / 100);
}

/** Recommended minimum inner radius for a flat bend of copper (rule of thumb: R ≥ T). */
export function minRadius(section: Section): number {
  return section.thickness;
}
