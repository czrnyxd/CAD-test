// Parametric busbar model: a chain of straight legs and flat bends (bent through the thickness).
// All lengths in mm, all angles in degrees.

export type Direction = 'up' | 'down';
export type DimensionMode = 'outside' | 'inside' | 'centerline';
export type BendLineReference = 'start' | 'center' | 'end';

export interface Section {
  width: number; // W, mm
  thickness: number; // T, mm
  material: 'Cu' | 'Al';
}

export interface StraightStep {
  id: string;
  kind: 'straight';
  /** Leg length as dimensioned (to virtual sharps, according to dimensionMode). */
  length: number;
}

export interface BendStep {
  id: string;
  kind: 'bend';
  /** Bend angle (how much the bar is bent), 0 < angle < 180. */
  angle: number;
  direction: Direction;
  /** Inner bend radius, mm. */
  radius: number;
}

export type Step = StraightStep | BendStep;

export interface Busbar {
  id: string;
  name: string;
  orderNo: string;
  quantity: number;
  section: Section;
  dimensionMode: DimensionMode;
  steps: Step[];
  updatedAt: string;
}

export interface MachineSettings {
  machineName: string;
  /** Default inner bend radius (tool radius). */
  radius: number;
  /** Neutral axis factor. */
  k: number;
  /** Springback correction in % of bend angle (machine setting = angle * (1 + pct/100)). */
  springbackPct: number;
  /** Minimum straight (tangent) length next to a bend, required by the tooling. */
  minLeg: number;
  /** Which point of the bend zone is the position the operator sets on the stop. */
  bendLineReference: BendLineReference;
  /** Maximum stock length. */
  maxLength: number;
}

export const DEFAULT_SETTINGS: MachineSettings = {
  machineName: 'Giętarka 1',
  radius: 10,
  k: 0.4,
  springbackPct: 2,
  minLeg: 30,
  bendLineReference: 'center',
  maxLength: 4000,
};

export const SECTIONS: Section[] = [
  [12, 2], [15, 3], [20, 3], [20, 5], [25, 5], [30, 5], [30, 10], [40, 5], [40, 10],
  [50, 5], [50, 10], [60, 10], [80, 10], [100, 10], [120, 10],
].map(([w, t]) => ({ width: w, thickness: t, material: 'Cu' as const }));

export function sectionLabel(s: Section): string {
  return `${s.material} ${s.width}×${s.thickness}`;
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${idCounter}`;
}

export function straight(length: number): StraightStep {
  return { id: newId(), kind: 'straight', length };
}

export function bend(angle: number, direction: Direction, radius: number): BendStep {
  return { id: newId(), kind: 'bend', angle, direction, radius };
}

export function newBusbar(section: Section, steps: Step[], name = 'Nowa szyna'): Busbar {
  return {
    id: newId(),
    name,
    orderNo: '',
    quantity: 1,
    section: { ...section },
    dimensionMode: 'outside',
    steps,
    updatedAt: new Date().toISOString(),
  };
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  up: 'w górę',
  down: 'w dół',
};

export const DIRECTION_ARROW: Record<Direction, string> = {
  up: '↑',
  down: '↓',
};

export const DIMENSION_MODE_LABEL: Record<DimensionMode, string> = {
  outside: 'po zewnętrznej',
  inside: 'po wewnętrznej',
  centerline: 'po osi',
};

/**
 * Bring a project saved by an older version to the current model:
 * edge bends become flat bends, twists are dropped and the neighbouring legs merged.
 */
export function migrateBusbar(raw: Busbar, settings: MachineSettings): Busbar {
  const steps: Step[] = [];
  for (const s of raw.steps as unknown as Record<string, unknown>[]) {
    if (s.kind === 'straight') {
      const prev = steps[steps.length - 1];
      if (prev?.kind === 'straight') prev.length += Number(s.length) || 0;
      else steps.push({ id: String(s.id ?? newId()), kind: 'straight', length: Number(s.length) || 0 });
    } else if (s.kind === 'bend') {
      const edge = s.plane === 'edge';
      steps.push({
        id: String(s.id ?? newId()),
        kind: 'bend',
        angle: Number(s.angle) || 90,
        direction: s.direction === 'down' || s.direction === 'right' ? 'down' : 'up',
        radius: edge ? settings.radius : Number(s.radius) || settings.radius,
      });
    }
    // other kinds (e.g. twist) are no longer supported and are skipped
  }
  return { ...raw, steps };
}

/** Keep only known settings keys (older versions stored more). */
export function migrateSettings(raw: Partial<MachineSettings>): MachineSettings {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof MachineSettings)[]) {
    if (raw[k] !== undefined) (out as Record<string, unknown>)[k] = raw[k];
  }
  return out;
}
