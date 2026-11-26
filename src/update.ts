/**
 * Updating the app without losing anything: projects, settings and the server code live in the
 * browser's local storage, which an update never touches. Only the offline copy of the app (the
 * service worker cache) is replaced and the page is loaded again.
 */
export const APP_BUILD = __APP_BUILD__;
export const APP_BUILT_AT = __APP_BUILT_AT__;

export interface VersionInfo {
  id: string;
  builtAt: string;
}

/** Newer version on the server, or null (same version, offline, development). */
export async function checkForUpdate(): Promise<VersionInfo | null> {
  if (!import.meta.env.PROD) return null;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = (await res.json()) as Partial<VersionInfo>;
    if (typeof v.id !== 'string' || !v.id || v.id === APP_BUILD) return null;
    return { id: v.id, builtAt: typeof v.builtAt === 'string' ? v.builtAt : '' };
  } catch {
    return null;
  }
}

/** Load the new version: fresh service worker and offline copy, then reload (local data stays). */
export async function applyUpdate(id: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* no service worker – a reload is enough */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('busbar-cad-')).map((k) => caches.delete(k)));
  } catch {
    /* no cache storage */
  }
  // A new address skips any copy of the start page the browser may still hold.
  location.replace(`${location.pathname}?v=${encodeURIComponent(id)}${location.hash}`);
}

/** Remove the ?v= left by an update from the address bar. */
export function cleanUpdateParam() {
  const url = new URL(location.href);
  if (!url.searchParams.has('v')) return;
  url.searchParams.delete('v');
  history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
}

export function fmtBuilt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
