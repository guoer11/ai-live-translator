const CACHE = 'ai-translator-v0.2.2';
const ROOT = new URL('./', self.location.href);
const ASSETS = ['./', './index.html', './style.css', './config.js', './src/app.js', './src/auth.js', './vendor/supabase/supabase.js', './src/history.js', './src/realtime.js', './src/language.js', './vendor/opencc/cn2t.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(ASSETS.map(path => new Request(new URL(path, ROOT).href, { cache: 'reload' })));
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('ai-translator-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (!ASSETS.some(path => new URL(path, ROOT).pathname === url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(new Request(event.request, { cache: 'no-store' }));
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});
