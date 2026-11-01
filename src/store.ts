import { create } from 'zustand';
import {
  SECTIONS,
  migrateBusbar,
  migrateSettings,
  newBusbar,
  newId,
  type Busbar,
  type MachineSettings,
  type Step,
} from './core/model';
import { TEMPLATES } from './core/templates';

const LS_PROJECTS = 'busbar.projects.v1';
const LS_SETTINGS = 'busbar.settings.v1';
const LS_CURRENT = 'busbar.current.v1';
const HISTORY_LIMIT = 200;

// Storage may be missing or throw (private mode, sandboxed frames) – never let it break the app.
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = lsGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadProjects(): Record<string, Busbar> {
  const raw = load<Record<string, Busbar>>(LS_PROJECTS, {});
  const settings = migrateSettings(load<Partial<MachineSettings>>(LS_SETTINGS, {}));
  const out: Record<string, Busbar> = {};
  for (const [id, b] of Object.entries(raw)) {
    try {
      out[id] = migrateBusbar(b, settings);
    } catch {
      /* skip broken entry */
    }
  }
  return out;
}

function saveProject(bar: Busbar) {
  const all = loadProjects();
  all[bar.id] = bar;
  lsSet(LS_PROJECTS, JSON.stringify(all));
  lsSet(LS_CURRENT, bar.id);
}

export function deleteProject(id: string) {
  const all = loadProjects();
  delete all[id];
  lsSet(LS_PROJECTS, JSON.stringify(all));
}

function initialState(): { bar: Busbar; settings: MachineSettings } {
  const settings = migrateSettings(load<Partial<MachineSettings>>(LS_SETTINGS, {}));
  const projects = loadProjects();
  const currentId = lsGet(LS_CURRENT);
  const bar =
    (currentId && projects[currentId]) ||
    newBusbar(
      SECTIONS.find((s) => s.width === 40 && s.thickness === 10)!,
      TEMPLATES[1].build(settings),
      'Szyna L',
    );
  return { bar, settings };
}

export interface AppState {
  bar: Busbar;
  past: Busbar[];
  future: Busbar[];
  settings: MachineSettings;
  selected: number | null;
  /** Apply a change to the busbar (recorded in undo history). */
  update: (fn: (bar: Busbar) => Busbar, record?: boolean) => void;
  updateSteps: (fn: (steps: Step[]) => Step[]) => void;
  undo: () => void;
  redo: () => void;
  select: (i: number | null) => void;
  setSettings: (s: Partial<MachineSettings>) => void;
  open: (bar: Busbar) => void;
}

const init = initialState();

export const useStore = create<AppState>((set, get) => ({
  bar: init.bar,
  past: [],
  future: [],
  settings: init.settings,
  selected: null,
  update: (fn, record = true) => {
    const prev = get().bar;
    const next = { ...fn(prev), updatedAt: new Date().toISOString() };
    if (!record) return set({ bar: next });
    set({ bar: next, past: [...get().past.slice(-HISTORY_LIMIT), prev], future: [] });
  },
  updateSteps: (fn) => get().update((b) => ({ ...b, steps: fn(b.steps) })),
  undo: () => {
    const { past, bar, future } = get();
    if (!past.length) return;
    set({ bar: past[past.length - 1], past: past.slice(0, -1), future: [bar, ...future], selected: null });
  },
  redo: () => {
    const { past, bar, future } = get();
    if (!future.length) return;
    set({ bar: future[0], past: [...past, bar], future: future.slice(1), selected: null });
  },
  select: (i) => set({ selected: i }),
  setSettings: (s) => {
    const settings = { ...get().settings, ...s };
    lsSet(LS_SETTINGS, JSON.stringify(settings));
    set({ settings });
  },
  open: (bar) => set({ bar, past: [], future: [], selected: null }),
}));

// Autosave current project.
useStore.subscribe((state, prev) => {
  if (state.bar !== prev.bar) saveProject(state.bar);
});
saveProject(init.bar);

export function duplicateBar(bar: Busbar): Busbar {
  return {
    ...structuredClone(bar),
    id: newId(),
    name: `${bar.name} (kopia)`,
    steps: bar.steps.map((s) => ({ ...s, id: newId() })),
    updatedAt: new Date().toISOString(),
  };
}
