// Service Worker para Icarus PWA
const CACHE_NAME = 'icarus-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/config.js',
  '/mobile.css'
];

// Instalar service worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Ativar e limpar caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estratégia Network First (sempre busca atualização, fallback para cache)
self.addEventListener('fetch', event => {
  // Ignorar requisições de API (sempre buscar da rede)
  if (event.request.url.includes('/api') || 
      event.request.url.includes('icarus-api') ||
      event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clonar resposta para salvar no cache
        const responseClone = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => {
        // Fallback para cache se offline
        return caches.match(event.request);
      })
  );
});
