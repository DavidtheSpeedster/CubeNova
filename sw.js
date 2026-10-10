// CubeNova service worker — full offline support, like csTimer: after one online visit the app,
// its icons and its fonts all work with no connection at all.
// - The page (index.html) is NETWORK-FIRST with a short timeout, so returning visitors get the newest
//   deployed version when the connection is good, and the saved copy at once when it is offline or very slow.
// - Everything else is stale-while-revalidate. Fonts are saved at install time so the look is identical offline.
// Bump CACHE_NAME on each release to evict old caches.
const CACHE_NAME = 'cubenova-v47';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap';
const APP_SHELL = [
  './',
  './index.html',
  './about.html',
  './privacy.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];
const NAV_TIMEOUT_MS = 3000;

async function precacheFonts(cache) {
  try {
    const cssRes = await fetch(FONT_CSS, { mode: 'cors' });
    if (!cssRes.ok) return;
    const css = await cssRes.clone().text();
    const urls = Array.from(new Set((css.match(/url\((https?:[^)]+)\)/g) || []).map((m) => m.slice(4, -1).replace(/["']/g, ''))));
    await Promise.all(urls.map((u) => fetch(u, { mode: 'cors' }).then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => {})));
    await cache.put(FONT_CSS, cssRes);   // stored last, so a half-finished download is never served as complete
  } catch (e) { /* offline during install, or fonts blocked: the app still works with system fonts */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all([
        // add files one by one so a single missing asset can't abort the whole install; 'reload' skips the HTTP cache
        ...APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
        precacheFonts(cache),
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isPage(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return url.origin === self.location.origin && (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/'));
}
function isFontHost(url) { return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'; }
const cacheable = (r) => r && (r.status === 200 || r.type === 'opaque');

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isPage(request)) {
    const offlineCopy = () => caches.match('./index.html').then((c) => c || caches.match(request));
    const network = fetch(request, { cache: 'no-cache' }).then((response) => {
      if (response && response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy)); }
      return response;
    });
    const slow = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
    event.respondWith(
      Promise.race([network.catch(() => null), slow]).then((res) => res || offlineCopy().then((c) => c || network))
    );
    return;
  }

  if (isFontHost(url)) {   // fonts: saved copy first, fetched and saved the first time they are needed
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (cacheable(response)) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
        return response;
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
