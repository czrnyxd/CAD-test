/** Placeholders in public/sw.js that the build replaces. */
export const BUILD_ID_MARK = '__BUILD_ID__';
export const ASSETS_MARK = '/*__ASSETS__*/ []';

/** Files of a build that the app needs to start: scripts, styles and fonts (woff2 only – every browser with a service worker reads it). */
export function offlineAssets(files: string[]): string[] {
  return files.filter((f) => /\.(js|css|woff2)$/.test(f)).sort();
}

/**
 * Put the build id and the list of files to keep for offline use into the service worker source.
 * `assets` are paths relative to the service worker (e.g. "assets/index-abc.js").
 */
export function stampServiceWorker(source: string, buildId: string, assets: string[]): string {
  for (const mark of [BUILD_ID_MARK, ASSETS_MARK]) {
    if (source.split(mark).length !== 2) throw new Error(`sw.js: expected exactly one "${mark}"`);
  }
  const list = JSON.stringify(assets.map((a) => `./${a}`));
  return source.replace(BUILD_ID_MARK, buildId).replace(ASSETS_MARK, list);
}
