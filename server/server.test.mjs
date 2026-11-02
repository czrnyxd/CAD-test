import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from './server.mjs';

let dir;
let server;
let base;
const TOKEN = 'kod-testowy-123';
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const project = (id, updatedAt, name = 'Szyna') => ({
  id,
  name,
  updatedAt,
  section: { width: 40, thickness: 10, material: 'Cu' },
  dimensionMode: 'outside',
  steps: [{ id: 's1', kind: 'straight', length: 100 }],
});
const put = (p) => fetch(`${base}/api/projects/${p.id}`, { method: 'PUT', headers: auth, body: JSON.stringify(p) });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'busbar-'));
  const staticDir = path.join(dir, 'static');
  await mkdir(path.join(staticDir, 'assets'), { recursive: true });
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>BusBar</title>');
  await writeFile(path.join(staticDir, 'assets', 'app-123.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'secret.txt'), 'tajne');
  server = createServer({ dataDir: path.join(dir, 'data'), staticDir, token: TOKEN });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

describe('server', () => {
  it('health is public, the API needs the access code', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
    expect((await fetch(`${base}/api/projects`, { headers: { Authorization: 'Bearer zly' } })).status).toBe(401);
    expect((await fetch(`${base}/api/projects`, { headers: auth })).status).toBe(200);
  });

  it('stores and lists projects', async () => {
    expect((await put(project('p1', '2026-11-01T10:00:00.000Z'))).status).toBe(200);
    const res = await (await fetch(`${base}/api/projects`, { headers: auth })).json();
    expect(res.projects.map((p) => p.id)).toEqual(['p1']);
    const one = await (await fetch(`${base}/api/projects/p1`, { headers: auth })).json();
    expect(one.project.name).toBe('Szyna');
  });

  it('rejects an older version with 409 and returns the newer one; keeps previous versions', async () => {
    await put(project('p1', '2026-11-01T12:00:00.000Z', 'Nowsza'));
    const res = await put(project('p1', '2026-11-01T11:00:00.000Z', 'Starsza'));
    expect(res.status).toBe(409);
    expect((await res.json()).project.name).toBe('Nowsza');
    const versions = await readdir(path.join(dir, 'data', 'versions', 'p1'));
    expect(versions.length).toBe(1);
  });

  it('validates input', async () => {
    const bad = { ...project('p2', '2026-11-01T10:00:00.000Z'), id: 'inny' };
    expect((await put({ ...bad, id: 'p2', steps: 'x' })).status).toBe(400);
    expect((await fetch(`${base}/api/projects/p2`, { method: 'PUT', headers: auth, body: JSON.stringify(bad) })).status).toBe(
      400,
    );
    expect((await fetch(`${base}/api/projects/..%2Fx`, { method: 'PUT', headers: auth, body: '{}' })).status).toBe(400);
    expect((await fetch(`${base}/api/projects/p2`, { method: 'PUT', headers: auth, body: '{zle' })).status).toBe(400);
  });

  it('delete moves the project to the trash and reports it to other devices', async () => {
    await put(project('p3', '2026-11-01T10:00:00.000Z'));
    expect((await fetch(`${base}/api/projects/p3`, { method: 'DELETE', headers: auth })).status).toBe(200);
    const res = await (await fetch(`${base}/api/projects`, { headers: auth })).json();
    expect(res.projects.some((p) => p.id === 'p3')).toBe(false);
    expect(res.deleted.some((d) => d.id === 'p3')).toBe(true);
    expect((await readdir(path.join(dir, 'data', 'trash'))).some((f) => f.startsWith('p3-'))).toBe(true);
  });

  it('merges shared settings (newer wins) and custom sections (union)', async () => {
    const s1 = { settings: { k: 0.38 }, settingsUpdatedAt: '2026-11-01T10:00:00.000Z', sections: [{ width: 63, thickness: 8 }] };
    const s2 = { settings: { k: 0.5 }, settingsUpdatedAt: '2026-11-01T09:00:00.000Z', sections: [{ width: 75, thickness: 10 }] };
    await fetch(`${base}/api/state`, { method: 'PUT', headers: auth, body: JSON.stringify(s1) });
    const merged = await (await fetch(`${base}/api/state`, { method: 'PUT', headers: auth, body: JSON.stringify(s2) })).json();
    expect(merged.settings.k).toBe(0.38);
    expect(merged.sections.map((s) => `${s.width}x${s.thickness}`)).toEqual(['63x8', '75x10']);
  });

  it('serves the app, falls back to index.html and never leaves the app folder', async () => {
    const index = await fetch(`${base}/`);
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(await index.text()).toContain('BusBar');
    const asset = await fetch(`${base}/assets/app-123.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(await (await fetch(`${base}/jakas/strona`)).text()).toContain('BusBar');
    const evil = await fetch(`${base}/..%2Fsecret.txt`);
    expect(await evil.text()).not.toContain('tajne');
  });
});
