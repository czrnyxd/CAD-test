// BusBar CAD server: stores projects and shared machine settings as JSON files and serves the app.
//
// No dependencies (Node 20+). Configuration through environment variables:
//   PORT        port to listen on (default 8080)
//   DATA_DIR    where projects are stored (default ./data)
//   STATIC_DIR  built app to serve (default ./dist; empty = API only)
//   API_TOKEN   access code required for /api (required unless ALLOW_NO_TOKEN=1)
//   CORS_ORIGIN allowed origin for the API when the app is hosted elsewhere (default: none)
//
// Storage layout (DATA_DIR):
//   projects/<id>.json             current version of every project
//   versions/<id>/<time>.json      previous versions (last KEEP_VERSIONS per project)
//   trash/<id>-<time>.json         deleted projects
//   deleted.json                   { id: deletedAt } – lets other devices remove their local copy
//   state.json                     { settings, settingsUpdatedAt, sections }

import { createServer as createHttpServer } from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP_VERSIONS = 30;
const MAX_BODY = 2 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Write a file atomically (temp file + rename), so a crash never leaves half a project. */
async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Minimal shape check; the app sanitizes everything it reads anyway. */
function checkProject(p, id) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new HttpError(400, 'Projekt musi być obiektem.');
  if (p.id !== id) throw new HttpError(400, 'Identyfikator projektu nie zgadza się z adresem.');
  if (typeof p.updatedAt !== 'string' || Number.isNaN(Date.parse(p.updatedAt))) throw new HttpError(400, 'Brak daty zmiany.');
  if (!Array.isArray(p.steps)) throw new HttpError(400, 'Brak listy odcinków.');
  if (!p.section || typeof p.section !== 'object') throw new HttpError(400, 'Brak przekroju.');
}

const newer = (a, b) => Date.parse(a) > Date.parse(b);

export function createServer({ dataDir, staticDir = '', token = '', corsOrigin = '' }) {
  const dirs = {
    projects: path.join(dataDir, 'projects'),
    versions: path.join(dataDir, 'versions'),
    trash: path.join(dataDir, 'trash'),
  };
  const deletedFile = path.join(dataDir, 'deleted.json');
  const stateFile = path.join(dataDir, 'state.json');
  const ready = Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));
  // Serialize writes: one tablet saving while another syncs must not interleave.
  let queue = Promise.resolve();
  const exclusive = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  const tokenBuf = Buffer.from(token);
  function authorized(req) {
    if (!token) return true;
    const h = req.headers.authorization || '';
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
  }

  async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Za duże dane.');
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    } catch {
      throw new HttpError(400, 'Nieprawidłowy JSON.');
    }
  }

  async function listProjects() {
    const files = (await readdir(dirs.projects)).filter((f) => f.endsWith('.json'));
    const projects = [];
    for (const f of files) {
      const p = await readJson(path.join(dirs.projects, f), null);
      if (p) projects.push(p);
    }
    const deleted = Object.entries(await readJson(deletedFile, {})).map(([id, deletedAt]) => ({ id, deletedAt }));
    return { projects, deleted };
  }

  async function putProject(id, p) {
    checkProject(p, id);
    const file = path.join(dirs.projects, `${id}.json`);
    const current = await readJson(file, null);
    if (current && newer(current.updatedAt, p.updatedAt)) {
      throw new HttpError(409, 'Na serwerze jest nowsza wersja projektu.', { project: current });
    }
    if (current && current.updatedAt === p.updatedAt) return { project: current };
    if (current) {
      const vdir = path.join(dirs.versions, id);
      await mkdir(vdir, { recursive: true });
      await writeAtomic(path.join(vdir, `${stamp()}.json`), JSON.stringify(current));
      const versions = (await readdir(vdir)).sort();
      for (const old of versions.slice(0, Math.max(0, versions.length - KEEP_VERSIONS))) await rm(path.join(vdir, old));
    }
    await writeAtomic(file, JSON.stringify(p));
    const deleted = await readJson(deletedFile, {});
    if (deleted[id]) {
      delete deleted[id];
      await writeAtomic(deletedFile, JSON.stringify(deleted));
    }
    return { project: p };
  }

  async function deleteProject(id) {
    const file = path.join(dirs.projects, `${id}.json`);
    const deletedAt = new Date().toISOString();
    try {
      await rename(file, path.join(dirs.trash, `${id}-${stamp()}.json`));
    } catch {
      /* already gone – still record the deletion */
    }
    const deleted = await readJson(deletedFile, {});
    deleted[id] = deletedAt;
    await writeAtomic(deletedFile, JSON.stringify(deleted));
    return { id, deletedAt };
  }

  async function putState(incoming) {
    if (!incoming || typeof incoming !== 'object') throw new HttpError(400, 'Nieprawidłowe dane.');
    const state = await readJson(stateFile, { settings: null, settingsUpdatedAt: '1970-01-01T00:00:00.000Z', sections: [] });
    if (incoming.settings && typeof incoming.settings === 'object' && typeof incoming.settingsUpdatedAt === 'string') {
      if (!state.settings || newer(incoming.settingsUpdatedAt, state.settingsUpdatedAt)) {
        state.settings = incoming.settings;
        state.settingsUpdatedAt = incoming.settingsUpdatedAt;
      }
    }
    if (Array.isArray(incoming.sections)) {
      const key = (s) => `${s.width}x${s.thickness}`;
      const known = new Set(state.sections.map(key));
      for (const s of incoming.sections) {
        if (s && Number(s.width) > 0 && Number(s.thickness) > 0 && !known.has(key(s))) {
          state.sections.push({ width: Number(s.width), thickness: Number(s.thickness), material: 'Cu' });
          known.add(key(s));
        }
      }
    }
    await writeAtomic(stateFile, JSON.stringify(state));
    return state;
  }

  async function serveStatic(req, res, url) {
    if (!staticDir) throw new HttpError(404, 'Nie znaleziono.');
    const root = path.resolve(staticDir);
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'Nieprawidłowy adres.');
    }
    let file = path.resolve(root, `.${decoded}`);
    if (!file.startsWith(root + path.sep) && file !== root) throw new HttpError(404, 'Nie znaleziono.');
    let st = await stat(file).catch(() => null);
    // A missing file (e.g. a script of the previous version) is an error: answering with the start
    // page would hand HTML to a browser that asked for a script. Only addresses without a file
    // extension fall back to the app.
    if (!st && path.extname(file)) throw new HttpError(404, 'Nie znaleziono.');
    if (!st || st.isDirectory()) {
      file = path.join(root, 'index.html');
      st = await stat(file).catch(() => null);
      if (!st) throw new HttpError(404, 'Nie znaleziono.');
    }
    const ext = path.extname(file);
    const base = path.basename(file);
    // The start page and the service worker must always be fresh; hashed assets never change.
    const cache =
      base === 'index.html' || base === 'sw.js' || ext === '.webmanifest'
        ? 'no-cache'
        : file.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(file));
  }

  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  async function handle(req, res) {
    await ready;
    const url = new URL(req.url, 'http://localhost');
    const api = url.pathname.startsWith('/api/');
    if (api && corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (api && req.method === 'OPTIONS') return res.writeHead(204).end();
    if (!api) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Niedozwolone.');
      return serveStatic(req, res, url);
    }
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, app: 'busbar-cad' });
    if (!authorized(req)) throw new HttpError(401, 'Nieprawidłowy kod dostępu.');

    if (url.pathname === '/api/projects' && req.method === 'GET') return send(res, 200, await listProjects());
    const m = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!ID_RE.test(id)) throw new HttpError(400, 'Nieprawidłowy identyfikator.');
      if (req.method === 'GET') {
        const p = await readJson(path.join(dirs.projects, `${id}.json`), null);
        if (!p) throw new HttpError(404, 'Nie ma takiego projektu.');
        return send(res, 200, { project: p });
      }
      if (req.method === 'PUT') {
        const p = await body(req);
        return send(res, 200, await exclusive(() => putProject(id, p)));
      }
      if (req.method === 'DELETE') return send(res, 200, await exclusive(() => deleteProject(id)));
    }
    if (url.pathname === '/api/state') {
      if (req.method === 'GET') {
        return send(res, 200, await readJson(stateFile, { settings: null, settingsUpdatedAt: null, sections: [] }));
      }
      if (req.method === 'PUT') {
        const s = await body(req);
        return send(res, 200, await exclusive(() => putState(s)));
      }
    }
    throw new HttpError(404, 'Nie znaleziono.');
  }

  return createHttpServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: e.message || 'Błąd serwera', ...(e.body || {}) });
      else res.end();
    });
  });
}

// Run directly: node server/server.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.API_TOKEN || '';
  if (!token && process.env.ALLOW_NO_TOKEN !== '1') {
    console.error('Ustaw API_TOKEN (kod dostępu) albo ALLOW_NO_TOKEN=1 do testów.');
    process.exit(1);
  }
  const port = Number(process.env.PORT || 8080);
  const server = createServer({
    dataDir: process.env.DATA_DIR || './data',
    staticDir: process.env.STATIC_DIR ?? './dist',
    token,
    corsOrigin: process.env.CORS_ORIGIN || '',
  });
  server.listen(port, () => console.log(`BusBar CAD: http://localhost:${port}`));
}
