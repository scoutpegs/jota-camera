// Service worker: keeps the app opening with no internet, and remembers map pictures you have looked at.
// Photos, videos and the upload queue are NOT handled here; they live in IndexedDB (see db.js).
const VERSION = 'v10-platform-finish';
const SHELL_CACHE = 'jota-shell-' + VERSION;
const TILE_CACHE = 'jota-tiles-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'app.css',
  'main.js', 'util.js', 'db.js', 'debug.js', 'identity.js', 'api.js', 'supa.js', 'backend.js', 'config.js', 'location.js',
  'submissions.js', 'uploader.js', 'backup.js', 'audio.js', 'camera.js', 'camera-ui.js', 'tilemap.js', 'data.js',
  'challenges.js', 'sounds.js', 'sheet-config.js', 'install.js', 'onboard.js', 'review.js', 'posts.js', 'map-view.js', 'settings.js',
  'logo.png', 'icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('jota-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.endsWith('.supabase.co')) return; // live data: never cached here

  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/admin/') || url.pathname.endsWith('/admin') || url.pathname.endsWith('/admin.html')) return; // live data / admin: never cached here
    if (req.mode === 'navigate') {
      // open instantly from the saved shell, refresh it quietly in the background
      e.respondWith(caches.open(SHELL_CACHE).then(async (c) => {
        const hit = (await c.match('index.html')) || (await c.match('./'));
        const net = fetch(req).then((r) => { if (r.ok) c.put('index.html', r.clone()); return r; }).catch(() => null);
        return hit || (await net) || new Response('Offline', { status: 503 });
      }));
      return;
    }
    e.respondWith(caches.open(SHELL_CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || new Response('', { status: 504 });
    }));
    return;
  }

  // map tiles and web fonts from other sites: remember them once seen
  if (/\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)$/.test(url.pathname) || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok && (r.type === 'cors' || r.type === 'basic')) { c.put(req, r.clone()); trim(c, 500); }
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
  }
});
