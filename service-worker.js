// Service Worker para SalaMangaS
// Durante la etapa de pruebas:
// - NO cachea HTML, CSS ni JavaScript.
// - NO cachea Supabase ni APIs.
// - Solo cachea imágenes.
// - Las actualizaciones de la app se cargan siempre desde Internet.

const CACHE_NAME = 'salamangas-images-v1';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(key) {
            return key !== CACHE_NAME;
          })
          .map(function(key) {
            return caches.delete(key);
          })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  const request = event.request;

  // Solo nos interesan solicitudes GET.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No tocar Supabase.
  if (url.hostname.includes('supabase')) return;

  // No tocar Netlify Functions.
  if (url.pathname.startsWith('/.netlify/')) return;

  // No tocar APIs.
  if (url.hostname.startsWith('api.')) return;

  // Solo cachear imágenes.
  const isImage =
    request.destination === 'image' ||
    /\.(jpg|jpeg|png|gif|webp|svg|avif|ico)$/i.test(url.pathname);

  if (!isImage) return;

  event.respondWith(
    caches.match(request).then(function(cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then(function(response) {
        if (!response || response.status !== 200) {
          return response;
        }

        const copy = response.clone();

        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, copy).catch(function() {});
        });

        return response;
      });
    })
  );
});
