/* Agraz Family — service worker
   Network-first for the HTML shell (so updates always show), cache-first for
   fonts/icons, and Firebase/Firestore traffic is never cached (always live). */
const CACHE = 'agraz-v1';
const SHELL = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
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

  // Never intercept live Firebase/Firestore/Auth traffic.
  if (/firestore|firebaseio|identitytoolkit|googleapis|gstatic\.com\/firebasejs/.test(url.href)) return;

  // HTML navigations: network-first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('/index.html', cp)); return r; })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Fonts, icons, images: cache-first.
  if (/fonts\.gstatic\.com|fonts\.googleapis\.com|\.svg(\?|$)|\.png(\?|$)|\.webmanifest$/.test(url.href)) {
    e.respondWith(
      caches.match(req).then((c) => c || fetch(req).then((r) => {
        const cp = r.clone(); caches.open(CACHE).then((ch) => ch.put(req, cp)); return r;
      }).catch(() => c))
    );
  }
});
