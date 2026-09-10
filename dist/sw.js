const CACHE = 'ai-translator-v0.1.2';
const ROOT = new URL('./', self.location.href);
const ASSETS = ['./', './index.html', './style.css', './config.js', './src/app.js', './src/history.js', './src/realtime.js', './src/language.js', './vendor/opencc/cn2t.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(p => new URL(p, ROOT).href)))); });
// Do not force an update into an ongoing microphone session. New worker waits
// until all tabs using the old version close.
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ai-translator-') && k !== CACHE).map(k => caches.delete(k))))); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  // API requests/credentials are cross-origin POST and are never intercepted.
  if (!ASSETS.some(p => new URL(p, ROOT).pathname === url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    return cached || fetch(event.request);
  }));
});
