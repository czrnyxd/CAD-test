import { fmt } from './analyze';
import {
  DEFAULT_DOUBLE,
  newId,
  type Busbar,
  type DimensionMode,
  type DoubleConfig,
  type Hole,
  type MachineSettings,
  type Step,
  type StraightStep,
} from './model';

/**
 * Result of reading a project from an untrusted source (imported file, local storage written by an
 * older version). `bar` is null when the data cannot be used at all; `changes` lists every
 * correction that alters the project, so the user can be told to check it.
 */
export interface SanitizeResult {
  bar: Busbar | null;
  changes: string[];
  error?: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Number from a number or a numeric string (also with a decimal comma); NaN otherwise. */
function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v.trim().replace(',', '.'));
  return NaN;
}

const DIMENSION_MODES: DimensionMode[] = ['outside', 'inside', 'centerline'];

export function sanitizeBusbar(raw: unknown, settings: MachineSettings): SanitizeResult {
  const changes: string[] = [];
  const fail = (error: string): SanitizeResult => ({ bar: null, changes, error });

  if (!isObj(raw)) return fail('To nie jest plik projektu szyny.');
  if (!isObj(raw.section)) return fail('Brak przekroju szyny w projekcie.');
  const width = num(raw.section.width);
  const thickness = num(raw.section.thickness);
  if (!(width > 0 && width < 1000) || !(thickness > 0 && thickness < 200)) {
    return fail('Nieprawidłowy przekrój szyny (szerokość lub grubość).');
  }
  const material = raw.section.material === 'Al' ? 'Al' : 'Cu';
  if (!Array.isArray(raw.steps)) return fail('Brak listy odcinków w projekcie.');

  let dimensionMode = raw.dimensionMode as DimensionMode;
  if (!DIMENSION_MODES.includes(dimensionMode)) {
    dimensionMode = 'outside';
    changes.push('Brak trybu wymiarowania – przyjęto wymiary po zewnętrznej.');
  }

  // Steps.
  const steps: Step[] = [];
  const appendStraight = (length: number, holes: Hole[], id: string) => {
    const prev = steps[steps.length - 1];
    if (prev?.kind === 'straight') {
      const shift = prev.length;
      prev.length += length;
      if (holes.length) prev.holes = [...(prev.holes ?? []), ...holes.map((h) => ({ ...h, position: h.position + shift }))];
    } else {
      const st: StraightStep = { id, kind: 'straight', length };
      if (holes.length) st.holes = holes;
      steps.push(st);
    }
  };

  raw.steps.forEach((s, idx) => {
    const no = idx + 1;
    if (!isObj(s)) {
      changes.push(`Pominięto nieczytelny krok nr ${no}.`);
      return;
    }
    const id = typeof s.id === 'string' && s.id ? s.id : newId();
    if (s.kind === 'straight') {
      let length = num(s.length);
      if (!Number.isFinite(length)) {
        length = 0;
        changes.push(`Odcinek (krok ${no}) nie miał poprawnej długości – ustawiono 0, popraw ją.`);
      }
      const holes: Hole[] = [];
      if (Array.isArray(s.holes)) {
        s.holes.forEach((h) => {
          const hole = sanitizeHole(h);
          if (hole) holes.push(hole);
          else changes.push(`Pominięto nieprawidłowy otwór w kroku ${no}.`);
        });
      }
      appendStraight(length, holes, id);
    } else if (s.kind === 'bend') {
      const angle = num(s.angle);
      let radius = num(s.radius);
      if (!(radius >= 0)) {
        radius = settings.radius;
        changes.push(`Gięcie (krok ${no}) nie miało promienia – przyjęto R${fmt(radius)}.`);
      }
      const edge = s.plane === 'edge';
      if (edge) {
        radius = settings.radius;
        changes.push(`Gięcie na kant (krok ${no}) zamieniono na płaskie – maszyna nie gnie na kant. Sprawdź kształt.`);
      }
      let direction: 'up' | 'down';
      if (s.direction === 'up' || s.direction === 'down') direction = s.direction;
      else if (s.direction === 'left' || s.direction === 'right') direction = s.direction === 'right' ? 'down' : 'up';
      else {
        direction = 'up';
        changes.push(`Gięcie (krok ${no}) nie miało kierunku – przyjęto „w górę”.`);
      }
      // An invalid angle is kept as is: the analysis reports it as an error instead of guessing.
      steps.push({ id, kind: 'bend', angle: Number.isFinite(angle) ? angle : 0, direction, radius });
      if (!Number.isFinite(angle)) changes.push(`Gięcie (krok ${no}) nie miało kąta – ustaw go.`);
    } else if (s.kind === 'twist') {
      const length = Math.max(0, num(s.length) || 0);
      appendStraight(length, [], id);
      changes.push(
        `Usunięto skręt (krok ${no}) – maszyna nie wykonuje skrętów. Jego strefę ${fmt(length)} mm doliczono do odcinka.`,
      );
    } else {
      changes.push(`Pominięto nieznany krok nr ${no}.`);
    }
  });
  if (!steps.length) return fail('Projekt nie zawiera żadnych odcinków.');

  // Double bar.
  let double: DoubleConfig | undefined;
  if (isObj(raw.double)) {
    const gap = num(raw.double.gap);
    double = {
      enabled: raw.double.enabled === true,
      side: raw.double.side === 'below' ? 'below' : 'above',
      gap: gap >= 0 ? gap : DEFAULT_DOUBLE.gap,
    };
  }

  const quantity = Math.round(num(raw.quantity));
  const updatedAt =
    typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : new Date().toISOString();
  const bar: Busbar = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Szyna',
    orderNo: typeof raw.orderNo === 'string' ? raw.orderNo : '',
    quantity: quantity >= 1 ? quantity : 1,
    section: { width, thickness, material },
    dimensionMode,
    steps,
    updatedAt,
  };
  if (double) bar.double = double;
  return { bar, changes };
}

function sanitizeHole(h: unknown): Hole | null {
  if (!isObj(h)) return null;
  const position = num(h.position);
  const diameter = num(h.diameter);
  const offset = h.offset === undefined ? 0 : num(h.offset);
  const slot = h.slot === undefined ? 0 : num(h.slot);
  if (![position, diameter, offset, slot].every(Number.isFinite) || !(diameter > 0) || slot < 0) return null;
  return { id: typeof h.id === 'string' && h.id ? h.id : newId(), position, offset, diameter, slot };
}

/** Settings from storage: keep known keys with values of the right type. */
export function sanitizeSettings(raw: unknown, defaults: MachineSettings): MachineSettings {
  const out = { ...defaults };
  if (!isObj(raw)) return out;
  for (const k of Object.keys(defaults) as (keyof MachineSettings)[]) {
    const def = defaults[k];
    const v = raw[k];
    if (typeof def === 'number') {
      const n = num(v);
      if (Number.isFinite(n) && n >= 0) (out as Record<string, unknown>)[k] = n;
    } else if (k === 'bendLineReference') {
      if (v === 'start' || v === 'center' || v === 'end') out.bendLineReference = v;
    } else if (typeof v === 'string') {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}
