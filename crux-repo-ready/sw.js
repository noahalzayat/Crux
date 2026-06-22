const CACHE = 'crux-v5';
const SHELL = ['/', 'index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  if(e.request.url.includes('anthropic') || e.request.url.includes('netlify/functions')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      // Network-first for HTML — always get latest app version
      if(e.request.destination === 'document') {
        return fetch(e.request).then(res => {
          if(res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => cached || caches.match('/index.html'));
      }
      // Cache-first for other assets (fonts, images)
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
