import { create } from 'zustand';
import { planSync, type Tombstone } from './core/syncPlan';
import type { Busbar } from './core/model';
import {
  applyRemoteProjects,
  applyRemoteState,
  forgetLocalDeleted,
  getLocalDeleted,
  getSettingsUpdatedAt,
  isPristine,
  loadProjects,
  onLocalChange,
  removeLocalProjects,
  useStore,
} from './store';

/**
 * Synchronization with the BusBar CAD server (server/server.mjs).
 *
 * The app keeps working offline: everything is saved locally first. When a server is configured,
 * changes are sent shortly after they happen and a full exchange runs at start, every minute and
 * when the connection comes back. The newer version of a project wins; the server keeps the
 * previous versions.
 */

const LS_SERVER = 'busbar.server.v1';
const PUSH_DELAY = 1500;
const SYNC_INTERVAL = 60_000;

export interface ServerConfig {
  /** Server address; empty = the server this app was loaded from. */
  url: string;
  /** Access code (API_TOKEN on the server). */
  token: string;
}

export type SyncState = 'off' | 'detected' | 'syncing' | 'ok' | 'offline' | 'auth' | 'error';

interface SyncStore {
  state: SyncState;
  lastSync: string | null;
  message: string | null;
  config: ServerConfig | null;
}

export const useSync = create<SyncStore>(() => ({ state: 'off', lastSync: null, message: null, config: loadConfig() }));

function loadConfig(): ServerConfig | null {
  try {
    const raw = localStorage.getItem(LS_SERVER);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return typeof c?.token === 'string' && c.token ? { url: String(c.url || ''), token: c.token } : null;
  } catch {
    return null;
  }
}

function apiBase(cfg: ServerConfig): string {
  if (cfg.url.trim()) return `${cfg.url.trim().replace(/\/+$/, '')}/api`;
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}api`;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function api<T>(cfg: ServerConfig, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase(cfg)}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'Brak połączenia z serwerem.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, String(body.error || `Błąd serwera (${res.status})`), body);
  return body as T;
}

function setStatus(state: SyncState, message: string | null = null) {
  useSync.setState({ state, message, ...(state === 'ok' ? { lastSync: new Date().toISOString() } : {}) });
}

function fail(e: unknown) {
  if (e instanceof ApiError && e.status === 401) setStatus('auth', 'Nieprawidłowy kod dostępu do serwera.');
  else if (e instanceof ApiError && e.status === 0)
    setStatus('offline', 'Brak połączenia – projekty zapisują się na tym urządzeniu.');
  else setStatus('error', e instanceof Error ? e.message : 'Błąd synchronizacji.');
}

async function pushProject(cfg: ServerConfig, p: Busbar) {
  try {
    await api(cfg, `/projects/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify(p) });
  } catch (e) {
    // Changed on another device in the meantime: take the newer version from the server.
    if (e instanceof ApiError && e.status === 409 && e.body.project) {
      applyRemoteProjects([e.body.project]);
      return;
    }
    throw e;
  }
}

let running: Promise<void> | null = null;

/** Full exchange with the server. */
export function syncNow(): Promise<void> {
  const cfg = useSync.getState().config;
  if (!cfg) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    setStatus('syncing');
    try {
      const remote = await api<{ projects: Busbar[]; deleted: Tombstone[] }>(cfg, '/projects');
      const deletedHere = getLocalDeleted();
      const plan = planSync(loadProjects(), remote.projects, remote.deleted, deletedHere);
      if (plan.toApply.length) applyRemoteProjects(plan.toApply);
      if (plan.toRemoveLocal.length) removeLocalProjects(plan.toRemoveLocal);
      for (const p of plan.toPush) if (!isPristine(p.id)) await pushProject(cfg, p);
      for (const id of plan.toDeleteRemote) await api(cfg, `/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
      forgetLocalDeleted(deletedHere.map((d) => d.id));
      await syncState(cfg);
      setStatus('ok');
    } catch (e) {
      fail(e);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncState(cfg: ServerConfig) {
  const st = useStore.getState();
  const merged = await api<{ settings: unknown; settingsUpdatedAt: string | null; sections: unknown }>(cfg, '/state', {
    method: 'PUT',
    body: JSON.stringify({ settings: st.settings, settingsUpdatedAt: getSettingsUpdatedAt(), sections: st.customSections }),
  });
  applyRemoteState(merged);
}

// Debounced push of local changes.
let pushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingProjects = new Map<string, Busbar>();
let pendingOther = false;

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    const cfg = useSync.getState().config;
    if (!cfg) return;
    const list = [...pendingProjects.values()];
    const other = pendingOther;
    pendingProjects.clear();
    pendingOther = false;
    setStatus('syncing');
    try {
      for (const p of list) await pushProject(cfg, p);
      if (other) await syncNow();
      else setStatus('ok');
    } catch (e) {
      fail(e);
    }
  }, PUSH_DELAY);
}

/** Save the server address and access code, check them and synchronize. */
export async function connect(cfg: ServerConfig): Promise<{ ok: boolean; message: string }> {
  try {
    await api(cfg, '/projects');
  } catch (e) {
    const msg =
      e instanceof ApiError && e.status === 401
        ? 'Nieprawidłowy kod dostępu.'
        : e instanceof ApiError && e.status === 0
          ? 'Nie można połączyć się z serwerem – sprawdź adres i internet.'
          : e instanceof Error
            ? e.message
            : 'Błąd';
    return { ok: false, message: msg };
  }
  try {
    localStorage.setItem(LS_SERVER, JSON.stringify(cfg));
  } catch {
    /* config only kept for this session */
  }
  useSync.setState({ config: cfg });
  await syncNow();
  return { ok: true, message: 'Połączono. Projekty są zapisywane na serwerze.' };
}

export function disconnect() {
  try {
    localStorage.removeItem(LS_SERVER);
  } catch {
    /* ignore */
  }
  useSync.setState({ config: null, state: 'off', message: null });
  void detectServer();
}

/** Is this app served by a BusBar CAD server (so only the access code is missing)? */
async function detectServer() {
  if (useSync.getState().config) return;
  try {
    const res = await fetch(`${location.origin}${location.pathname.replace(/[^/]*$/, '')}api/health`, { cache: 'no-store' });
    const body = await res.json();
    if (body?.app === 'busbar-cad' && !useSync.getState().config)
      setStatus('detected', 'Serwer dostępny – wpisz kod dostępu w Ustawieniach.');
  } catch {
    /* no server here */
  }
}

let started = false;

export function startSync() {
  if (started) return;
  started = true;
  onLocalChange(({ project, settings }) => {
    if (!useSync.getState().config) return;
    if (project) pendingProjects.set(project.id, project);
    else pendingOther = pendingOther || settings === true || !project;
    schedulePush();
  });
  window.addEventListener('online', () => void syncNow());
  setInterval(() => void syncNow(), SYNC_INTERVAL);
  if (useSync.getState().config) void syncNow();
  else void detectServer();
}
