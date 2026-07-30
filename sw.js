const CACHE_NAME = 'bingo-scan-v10';
const ASSETS = [
  'index.html',
  'styles.css',
  'db.js',
  'audio.js',
  'ocr.js',
  'voice.js',
  'game.js',
  'app_v2.js',
  'manifest.json',
  'LOGO.png'
];

// Install Event - Caching Assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Cleaning Old Caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network First with Cache Fallback (Ideal for PWA updates)
self.addEventListener('fetch', (e) => {
  // Solo interceptar peticiones del mismo origen o CDNs de JS
  if (e.request.url.startsWith(self.location.origin) || e.request.url.includes('cdn.jsdelivr.net')) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          // Si la respuesta es válida, clonarla y actualizar la caché
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Si falla la red (offline), servir desde la caché
          return caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Si tampoco está en caché
            return new Response('Offline. Recurso no disponible en caché.', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
        })
    );
  } else {
    // Para otras peticiones externas (por ejemplo, Google Fonts), usar comportamiento por defecto
    e.respondWith(fetch(e.request));
  }
});
