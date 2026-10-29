const CACHE_NAME = 'voice-studio-v5';
const APP_SHELL = ['/', '/script.js', '/text.js', '/line-voices.js', '/style.css', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('voice-studio-') && key !== CACHE_NAME)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

// Prefer current assets; use the app shell only when the network is unavailable.
// Never cache synthesis responses or resources from third-party origins.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && (APP_SHELL.includes(url.pathname) || request.mode === 'navigate')) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(request)) ||
        (request.mode === 'navigate' && await caches.match('/')) ||
        new Response('Offline', { status: 503 });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('voice-studio-')).map(key => caches.delete(key))
    )));
  }
});
