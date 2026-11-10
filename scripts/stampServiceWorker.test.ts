import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { offlineAssets, stampServiceWorker } from './stampServiceWorker';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('service worker build stamp', () => {
  it('puts the build id and the files needed offline into public/sw.js', () => {
    const out = stampServiceWorker(source, 'build42', ['assets/index-abc.js', 'assets/index-abc.css']);
    expect(out).toContain("const BUILD_ID = 'build42';");
    expect(out).toContain('const ASSETS = ["./assets/index-abc.js","./assets/index-abc.css"];');
    expect(out).not.toContain('__BUILD_ID__');
    expect(out).not.toContain('__ASSETS__');
    // Still a valid script.
    expect(() => new Function(out)).not.toThrow();
  });

  it('fails the build when a placeholder is missing', () => {
    expect(() => stampServiceWorker('const CACHE = 1;', 'x', [])).toThrow();
  });

  it('keeps scripts, styles and woff2 fonts for offline use', () => {
    expect(offlineAssets(['index-a.js', 'index-a.css', 'barlow.woff2', 'barlow.woff', 'logo.png'])).toEqual([
      'barlow.woff2',
      'index-a.css',
      'index-a.js',
    ]);
  });
});
