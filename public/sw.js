// Offline support for BusBar CAD.
// - The start page is fetched from the network first (updates arrive as soon as there is a
//   connection); only a successful HTML response for the app's own start page is cached.
// - Hashed build assets are served cache-first.
// - The cache name contains the build id (replaced at build time), so every deployment starts with
//   a fresh cache and old assets are removed.
const BUILD_ID = '__BUILD_ID__';
const CACHE = `busbar-cad-${BUILD_ID}`;
const SHELL = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const START_KEY = './';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('busbar-cad-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStartPage(url) {
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const html = (res.headers.get('content-type') || '').includes('text/html');
          if (res.ok && html && isStartPage(url)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(START_KEY, copy));
          }
          return res;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match(START_KEY)).then((hit) => hit || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === 'basic') c.put(req, res.clone());
            return res;
          }),
      ),
    ),
  );
});
