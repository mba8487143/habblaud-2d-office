// Service worker do Habblaud (PWA). O app sempre vem do servidor, sem cache: assim um build novo vale na hora. Ele só
// guarda a página "Habblaud está desligado" (offline.html) e o ícone, para quando o app abre com o servidor parado
// (ex.: pelo ícone instalado, antes de o servidor subir); ela tenta de novo sozinha e recarrega quando ele volta.
// A API, o stream (SSE) e o resto dos arquivos nem passam por aqui.
const CACHE = 'habblaud-offline-v1';
const OFFLINE_PAGE = '/offline.html';
const OFFLINE_FILES = [OFFLINE_PAGE, '/assets/brand/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(OFFLINE_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_PAGE)));
    return;
  }
  const url = new URL(req.url);
  if (url.origin === self.location.origin && OFFLINE_FILES.includes(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match(url.pathname)));
  }
});
