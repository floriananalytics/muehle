// Bei jeder Änderung an der App diese Versionsnummer hochzählen,
// sonst behalten installierte Geräte die alte Version im Cache.
const CACHE = 'muehle-v5';
const FILES = ['./', './index.html', './games/muehle.js', './games/vier-gewinnt.js', './manifest.json', './icon-192.png', './icon-512.png', './icon-512-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(r => {
      // Ein bereits abgelöster Worker schreibt nicht mehr in den Cache, sonst bleibt sein alter Cache neben dem neuen liegen.
      if (!(self.serviceWorker && self.serviceWorker.state === 'redundant')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
