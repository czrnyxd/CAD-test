import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  SECTIONS,
  newBusbar,
  newId,
  sectionError,
  sectionKey,
  type Busbar,
  type MachineSettings,
  type Section,
  type Step,
} from './core/model';
import { sanitizeBusbar, sanitizeSettings } from './core/sanitize';
import type { Tombstone } from './core/syncPlan';
import { TEMPLATES } from './core/templates';

const LS_PROJECTS = 'busbar.projects.v1';
const LS_SETTINGS = 'busbar.settings.v1';
const LS_CURRENT = 'busbar.current.v1';
const LS_SECTIONS = 'busbar.sections.v1';
const LS_DELETED = 'busbar.deleted.v1';
const LS_SETTINGS_AT = 'busbar.settingsAt.v1';
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

/** User-defined sections ("Inny przekrój"), kept for later projects. */
const initialCustomSections: Section[] = (() => {
  const raw = loadJson(LS_SECTIONS);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => ({ width: Number(x?.width), thickness: Number(x?.thickness), material: 'Cu' as const }))
    .filter((x) => sectionError(x.width, x.thickness) === null);
})();

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

/** Projects deleted on this device, until the server has been told (see sync.ts). */
let localDeleted: Tombstone[] = (() => {
  const raw = loadJson(LS_DELETED);
  return Array.isArray(raw) ? raw.filter((d) => d && typeof d.id === 'string' && typeof d.deletedAt === 'string') : [];
})();

export function deleteProject(id: string) {
  delete projects[id];
  persistProjects();
  localDeleted = [...localDeleted.filter((d) => d.id !== id), { id, deletedAt: new Date().toISOString() }];
  lsSet(LS_DELETED, JSON.stringify(localDeleted));
  notifyChange();
}

export function getLocalDeleted(): Tombstone[] {
  return [...localDeleted];
}

export function forgetLocalDeleted(ids: string[]) {
  localDeleted = localDeleted.filter((d) => !ids.includes(d.id));
  lsSet(LS_DELETED, JSON.stringify(localDeleted));
}

/** When the shared machine settings were last changed on this device. */
export function getSettingsUpdatedAt(): string {
  return lsGet(LS_SETTINGS_AT) || '1970-01-01T00:00:00.000Z';
}

/** Listeners for local changes that should go to the server (projects, deletions, settings). */
type ChangeListener = (what: { project?: Busbar; settings?: boolean }) => void;
const changeListeners = new Set<ChangeListener>();
export function onLocalChange(fn: ChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
function notifyChange(what: { project?: Busbar; settings?: boolean } = {}) {
  for (const fn of changeListeners) fn(what);
}

/**
 * Take projects coming from the server (already newer than the local ones). The project open on
 * screen is replaced too, without touching its undo history.
 */
export function applyRemoteProjects(list: unknown[]): number {
  const settings = useStore.getState().settings;
  let n = 0;
  for (const raw of list) {
    const res = sanitizeBusbar(raw, settings);
    if (!res.bar) continue;
    projects[res.bar.id] = res.bar;
    n++;
    const st = useStore.getState();
    if (st.bar.id === res.bar.id && Date.parse(res.bar.updatedAt) > Date.parse(st.bar.updatedAt)) {
      applyingRemote = true;
      useStore.setState({ bar: res.bar });
      applyingRemote = false;
    }
  }
  if (n) persistProjects();
  return n;
}

/** Remove local copies of projects deleted on another device (the project on screen is kept). */
export function removeLocalProjects(ids: string[]) {
  const current = useStore.getState().bar.id;
  let changed = false;
  for (const id of ids) {
    if (id === current || !projects[id]) continue;
    delete projects[id];
    changed = true;
  }
  if (changed) persistProjects();
}

/** Shared machine settings and custom sections from the server. */
export function applyRemoteState(state: { settings?: unknown; settingsUpdatedAt?: string | null; sections?: unknown }) {
  const st = useStore.getState();
  if (state.settings && state.settingsUpdatedAt && Date.parse(state.settingsUpdatedAt) > Date.parse(getSettingsUpdatedAt())) {
    const settings = sanitizeSettings(state.settings, DEFAULT_SETTINGS);
    lsSet(LS_SETTINGS, JSON.stringify(settings));
    lsSet(LS_SETTINGS_AT, state.settingsUpdatedAt);
    useStore.setState({ settings });
  }
  if (Array.isArray(state.sections)) {
    let list = st.customSections;
    for (const x of state.sections) {
      const sec = { width: Number(x?.width), thickness: Number(x?.thickness), material: 'Cu' as const };
      if (sectionError(sec.width, sec.thickness) !== null) continue;
      if ([...SECTIONS, ...list].some((k) => sectionKey(k) === sectionKey(sec))) continue;
      list = [...list, sec];
    }
    if (list !== st.customSections) {
      lsSet(LS_SECTIONS, JSON.stringify(list));
      useStore.setState({ customSections: list });
    }
  }
}

let applyingRemote = false;

/** The starter project created on a fresh device: not sent to the server until it is changed. */
let pristineId: string | null = null;
export function isPristine(id: string): boolean {
  return id === pristineId;
}

function initialBar(): Busbar {
  const currentId = lsGet(LS_CURRENT);
  const existing = currentId && projects[currentId];
  if (existing) return existing;
  const starter = newBusbar(
    SECTIONS.find((s) => s.width === 40 && s.thickness === 10)!,
    TEMPLATES[1].build(initialSettings),
    'Szyna L',
  );
  if (!Object.keys(projects).length) pristineId = starter.id;
  return starter;
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
  /** User-defined sections. */
  customSections: Section[];
  addCustomSection: (s: Section) => void;
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

/**
 * Time of a change that replaces the version dated `previous`: now, but always later than that
 * version, because the newer date decides which version the server and the other devices keep.
 */
export function stampAfter(previous: string): string {
  const prev = Date.parse(previous);
  const now = Date.now();
  return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString();
}

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
  customSections: initialCustomSections,
  addCustomSection: (sec) => {
    const known = [...SECTIONS, ...get().customSections].some((x) => sectionKey(x) === sectionKey(sec));
    if (known) return;
    const customSections = [...get().customSections, { ...sec }];
    lsSet(LS_SECTIONS, JSON.stringify(customSections));
    set({ customSections });
    notifyChange({ settings: true });
  },
  update: (fn, record = true) => {
    const prev = get().bar;
    const next = { ...fn(prev), updatedAt: stampAfter(prev.updatedAt) };
    if (!record) return set({ bar: next });
    set({ bar: next, past: [...get().past.slice(-HISTORY_LIMIT), prev], future: [] });
  },
  updateSteps: (fn) => get().update((b) => ({ ...b, steps: fn(b.steps) })),
  undo: () => {
    const { past, bar, future } = get();
    if (!past.length) return;
    // The restored version is the newest one: with its old date the server would send the undone change back.
    const restored = { ...past[past.length - 1], updatedAt: stampAfter(bar.updatedAt) };
    set({ bar: restored, past: past.slice(0, -1), future: [bar, ...future], selected: null });
  },
  redo: () => {
    const { past, bar, future } = get();
    if (!future.length) return;
    const restored = { ...future[0], updatedAt: stampAfter(bar.updatedAt) };
    set({ bar: restored, past: [...past, bar], future: future.slice(1), selected: null });
  },
  select: (i) => set({ selected: i }),
  setSettings: (s) => {
    const settings = { ...get().settings, ...s };
    const ok = lsSet(LS_SETTINGS, JSON.stringify(settings));
    lsSet(LS_SETTINGS_AT, new Date().toISOString());
    set({ settings, saveOk: ok });
    notifyChange({ settings: true });
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
    if (state.bar.id === pristineId && prev.bar.id === pristineId) pristineId = null; // edited → a real project
    if (!applyingRemote && state.bar.id !== pristineId) notifyChange({ project: state.bar });
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
