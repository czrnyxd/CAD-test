// Parametric busbar model: a chain of steps (straight, bend, twist).
// All lengths in mm, all angles in degrees.

export type Plane = 'flat' | 'edge';
export type Direction = 'up' | 'down' | 'left' | 'right';
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
  plane: Plane;
  /** Bend angle (how much the bar is bent), 0 < angle < 180. */
  angle: number;
  direction: Direction;
  /** Inner bend radius, mm. */
  radius: number;
}

export interface TwistStep {
  id: string;
  kind: 'twist';
  /** Twist angle around the bar axis, positive = clockwise looking along the bar. */
  angle: number;
  /** Length of the twist zone, mm. */
  length: number;
}

export type Step = StraightStep | BendStep | TwistStep;

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
  /** Default inner radius for flat bends (through thickness). */
  radiusFlat: number;
  /** Default inner radius for edge bends (through width). */
  radiusEdge: number;
  /** Neutral axis factor for flat bends. */
  kFlat: number;
  /** Neutral axis factor for edge bends. */
  kEdge: number;
  /** Springback correction in % of bend angle (machine setting = angle * (1 + pct/100)). */
  springbackFlatPct: number;
  springbackEdgePct: number;
  /** Minimum straight (tangent) length next to a bend, required by the tooling. */
  minLeg: number;
  /** Which point of the bend zone is the position the operator sets on the stop. */
  bendLineReference: BendLineReference;
  /** Maximum stock length. */
  maxLength: number;
}

export const DEFAULT_SETTINGS: MachineSettings = {
  machineName: 'Giętarka 1',
  radiusFlat: 10,
  radiusEdge: 40,
  kFlat: 0.4,
  kEdge: 0.45,
  springbackFlatPct: 2,
  springbackEdgePct: 3,
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

export function bend(plane: Plane, angle: number, direction: Direction, radius: number): BendStep {
  return { id: newId(), kind: 'bend', plane, angle, direction, radius };
}

export function twist(angle: number, length: number): TwistStep {
  return { id: newId(), kind: 'twist', angle, length };
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
  left: 'w lewo',
  right: 'w prawo',
};

export const DIRECTION_ARROW: Record<Direction, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

export const PLANE_LABEL: Record<Plane, string> = {
  flat: 'płaskie',
  edge: 'na kant',
};

export const DIMENSION_MODE_LABEL: Record<DimensionMode, string> = {
  outside: 'po zewnętrznej',
  inside: 'po wewnętrznej',
  centerline: 'po osi',
};
