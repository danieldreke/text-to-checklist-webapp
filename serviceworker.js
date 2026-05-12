const CACHE = 'text-to-checklist-v36';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './qrcodegen-nayuki.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(cache => {
      const networkFetch = fetch(e.request).then(response => {
        if (response && response.ok) cache.put(e.request, response.clone());
        return response;
      }).catch(() => null);
      return cache.match(e.request).then(cached => cached ?? networkFetch);
    })
  );
});
