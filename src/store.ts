import { create } from 'zustand';
import { DEFAULT_SETTINGS, SECTIONS, newBusbar, newId, type Busbar, type MachineSettings, type Step } from './core/model';
import { sanitizeBusbar, sanitizeSettings } from './core/sanitize';
import { TEMPLATES } from './core/templates';

const LS_PROJECTS = 'busbar.projects.v1';
const LS_SETTINGS = 'busbar.settings.v1';
const LS_CURRENT = 'busbar.current.v1';
const HISTORY_LIMIT = 200;

// Storage may be missing or throw (private mode, sandboxed frames, quota) – never let it break the app.
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function loadJson(key: string): unknown {
  try {
    const raw = lsGet(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

const initialSettings = sanitizeSettings(loadJson(LS_SETTINGS), DEFAULT_SETTINGS);

/** Projects kept in memory; storage is read once and written on every change. */
const projects: Record<string, Busbar> = {};
/** Corrections made while reading stored projects (older versions), by project id. */
const loadChanges: Record<string, string[]> = {};
{
  const raw = loadJson(LS_PROJECTS);
  if (raw && typeof raw === 'object') {
    for (const [id, b] of Object.entries(raw as Record<string, unknown>)) {
      const res = sanitizeBusbar(b, initialSettings);
      if (!res.bar) continue;
      projects[id] = { ...res.bar, id };
      if (res.changes.length) loadChanges[id] = res.changes;
    }
  }
}

export function loadProjects(): Record<string, Busbar> {
  return { ...projects };
}

/** Corrections applied to a stored project when it was read (shown once when it is opened). */
export function takeLoadChanges(id: string): string[] {
  const c = loadChanges[id] ?? [];
  delete loadChanges[id];
  return c;
}

function persistProjects(): boolean {
  return lsSet(LS_PROJECTS, JSON.stringify(projects));
}

function saveProject(bar: Busbar): boolean {
  projects[bar.id] = bar;
  const ok = persistProjects();
  lsSet(LS_CURRENT, bar.id);
  return ok;
}

export function deleteProject(id: string) {
  delete projects[id];
  persistProjects();
}

function initialBar(): Busbar {
  const currentId = lsGet(LS_CURRENT);
  return (
    (currentId && projects[currentId]) ||
    newBusbar(
      SECTIONS.find((s) => s.width === 40 && s.thickness === 10)!,
      TEMPLATES[1].build(initialSettings),
      'Szyna L',
    )
  );
}

export interface AppState {
  bar: Busbar;
  past: Busbar[];
  future: Busbar[];
  settings: MachineSettings;
  selected: number | null;
  /** False when the last autosave failed (storage full or unavailable). */
  saveOk: boolean;
  /** Message for the user (e.g. corrections made when a project was read). */
  notice: string | null;
  /** Apply a change to the busbar (recorded in undo history unless record = false). */
  update: (fn: (bar: Busbar) => Busbar, record?: boolean) => void;
  updateSteps: (fn: (steps: Step[]) => Step[]) => void;
  undo: () => void;
  redo: () => void;
  select: (i: number | null) => void;
  setSettings: (s: Partial<MachineSettings>) => void;
  open: (bar: Busbar, changes?: string[]) => void;
  setNotice: (n: string | null) => void;
}

const init = initialBar();
const initChanges = takeLoadChanges(init.id);

function changesNotice(changes: string[]): string | null {
  return changes.length ? `Projekt poprawiono przy wczytaniu – sprawdź go:\n• ${changes.join('\n• ')}` : null;
}

export const useStore = create<AppState>((set, get) => ({
  bar: init,
  past: [],
  future: [],
  settings: initialSettings,
  selected: null,
  saveOk: true,
  notice: changesNotice(initChanges),
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
    const ok = lsSet(LS_SETTINGS, JSON.stringify(settings));
    set({ settings, saveOk: ok });
  },
  open: (bar, changes) =>
    set({
      bar,
      past: [],
      future: [],
      selected: null,
      notice: changesNotice([...(changes ?? []), ...takeLoadChanges(bar.id)]),
    }),
  setNotice: (notice) => set({ notice }),
}));

// Autosave current project.
useStore.subscribe((state, prev) => {
  if (state.bar !== prev.bar) {
    const ok = saveProject(state.bar);
    if (ok !== state.saveOk) useStore.setState({ saveOk: ok });
  }
});
saveProject(init);

export function duplicateBar(bar: Busbar): Busbar {
  return {
    ...structuredClone(bar),
    id: newId(),
    name: `${bar.name} (kopia)`,
    steps: bar.steps.map((s) => ({ ...s, id: newId() })),
    updatedAt: new Date().toISOString(),
  };
}
