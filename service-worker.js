// Service Worker básico para SalaMangaS
const CACHE_NAME = 'salamangas-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/logo.jpg'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(ASSETS).catch(function(){});
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  // Solo cachea GET
  if(event.request.method !== 'GET') return;
  // No cachea llamadas a Supabase ni a Netlify functions
  const url = event.request.url;
  if(url.indexOf('supabase') !== -1) return;
  if(url.indexOf('/.netlify/') !== -1) return;
  if(url.indexOf('api.') !== -1) return;

  event.respondWith(
    caches.match(event.request).then(function(cached){
      return cached || fetch(event.request).then(function(response){
        // Cachea solo respuestas válidas
        if(!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache){
          cache.put(event.request, copy).catch(function(){});
        });
        return response;
      }).catch(function(){
        return caches.match('/index.html');
      });
    })
  );
});