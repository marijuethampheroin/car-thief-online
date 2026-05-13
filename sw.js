// sw.js — Car Thief Online service worker
// Strategy: network-first with cache fallback.
// Core shell files are pre-cached on install.

const CACHE = 'cto-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/classic.html',
  '/game.html',
  '/styles.css',
  '/styles_v2.css',
  '/game.js',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Delete any old cache versions
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Don't intercept WebSocket upgrades or cross-origin requests
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache a clone of fresh responses
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
