import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Id of this build: stamped into the service worker, the app and version.json (update check). */
const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const BUILT_AT = new Date().toISOString();

/**
 * Stamp the service worker with the build id so each deployment gets a fresh offline cache, and
 * write version.json, which the app reads to offer an update.
 */
function stampServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      writeFileSync(resolve(outDir, 'version.json'), JSON.stringify({ id: BUILD_ID, builtAt: BUILT_AT }));
      const file = resolve(outDir, 'sw.js');
      if (!existsSync(file)) return;
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_ID__', BUILD_ID));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), stampServiceWorker()],
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID), __APP_BUILT_AT__: JSON.stringify(BUILT_AT) },
  test: { environment: 'node' },
} as any);
