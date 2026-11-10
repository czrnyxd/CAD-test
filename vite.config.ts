import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { offlineAssets, stampServiceWorker } from './scripts/stampServiceWorker';

/**
 * Stamp the service worker with a unique build id (each deployment gets a fresh offline cache) and
 * with the list of built files, so the whole app is stored for offline use at the first visit.
 */
function serviceWorkerStamp(): Plugin {
  let outDir = 'dist';
  let assetsDir = 'assets';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
      assetsDir = cfg.build.assetsDir;
    },
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      if (!existsSync(file)) return;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const dir = resolve(outDir, assetsDir);
      const assets = offlineAssets(existsSync(dir) ? readdirSync(dir) : []).map((f) => `${assetsDir}/${f}`);
      writeFileSync(file, stampServiceWorker(readFileSync(file, 'utf8'), id, assets));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorkerStamp()],
  test: { environment: 'node' },
} as any);
