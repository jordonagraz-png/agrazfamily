/* Agraz Family — service worker
   Same-origin files: network-first (updates always show), cached copy when offline.
   Google Fonts: cache-first. Everything else (Firebase, Firestore, photos) goes
   straight to the network untouched — private data is never cached here. */
const CACHE = 'agraz-202610041338';
const SHELL = [
  '/', '/family/', '/404.html',
  '/assets/css/base.css', '/assets/css/public.css', '/assets/css/portal.css', '/assets/css/signature.css', '/assets/css/seasons.css',
  '/assets/js/public.js', '/assets/js/portal.js', '/assets/js/globe.js', '/assets/js/tree.js', '/assets/js/livephoto.js', '/assets/js/signature.js', '/assets/js/seasons.js', '/assets/js/games/gull.js', '/assets/js/games/neveria.js', '/assets/data/land.bin', '/assets/icons.svg',
  '/favicon.svg', '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname === '/assets/data/tree-import.bin') return; // the locked tree is never cached
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match(url.pathname.startsWith('/family') ? '/family/' : '/') : undefined))
          .then((hit) => hit || Response.error()))
    );
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
