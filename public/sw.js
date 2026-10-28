/* Only the built interface is cached. API replies and personal memory never enter this cache. */
const CACHE = 'mother-shell-v2';
// A new build waits while you work. Only the explicit update button activates it.
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('mother-shell-') && key !== CACHE).map(key => caches.delete(key))))]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('/index.html',copy)); }
      return response;
    }).catch(async () => (await caches.match('/index.html')) || Response.error()));
  } else if (/\.(js|mjs|wasm|css|svg|png|webmanifest)$/.test(url.pathname) || /^\/voices\/(?:af_heart|af_bella|bf_emma)\.bin$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if(response.ok) {const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}
      return response;
    })));
  }
});
