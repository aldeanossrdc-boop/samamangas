
/* service-worker.js — SalaMangaS
   Versión 3: caché limitada y actualizaciones prudentes
*/

const CACHE_NAME = 'salamangas-v3';
const PREFIJO_CACHE = 'salamangas-';

// Solo archivos estáticos que está permitido guardar.
const ARCHIVOS_CACHEABLES = [
  '/manifest.json',
  '/logo.png',
  '/logo.jpg'
];

// INSTALACIÓN
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cada archivo se intenta guardar por separado.
      // Si uno no existe, no impide guardar los demás.
      for (const ruta of ARCHIVOS_CACHEABLES) {
        try {
          const respuesta = await fetch(ruta);

          if (respuesta.ok && respuesta.type === 'basic') {
            await cache.put(ruta, respuesta);
          }
        } catch (error) {
          // El archivo podrá descargarse cuando haya conexión.
        }
      }
    })
  );

  // No forzamos la activación inmediata.
});

// ACTIVACIÓN
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres.map((nombre) => {
          // Borrar únicamente cachés antiguas de SalaMangaS.
          if (
            nombre.startsWith(PREFIJO_CACHE) &&
            nombre !== CACHE_NAME
          ) {
            return caches.delete(nombre);
          }
        })
      )
    )
  );

  // No forzamos el control inmediato de pestañas abiertas.
});

// PETICIONES
self.addEventListener('fetch', (event) => {
  const solicitud = event.request;
  const url = new URL(solicitud.url);

  // No interceptar formularios ni otras peticiones que no sean GET.
  if (solicitud.method !== 'GET') return;

  // No interceptar peticiones a otros dominios.
  if (url.origin !== self.location.origin) return;

  // Las páginas HTML siempre se solicitan normalmente al servidor.
  if (solicitud.mode === 'navigate') return;

  // Solo gestionar los archivos estáticos expresamente autorizados.
  if (!ARCHIVOS_CACHEABLES.includes(url.pathname)) return;

  event.respondWith(
    fetch(solicitud)
      .then(async (respuesta) => {
        // No guardar respuestas de error ni respuestas opacas.
        if (respuesta.ok && respuesta.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(solicitud, respuesta.clone());
        }

        return respuesta;
      })
      .catch(async () => {
        // Usar la copia guardada únicamente si falla la conexión.
        const copia = await caches.match(solicitud);
        if (copia) return copia;

        // Si no hay copia, informar que no se pudo cargar el archivo.
        return new Response('Archivo no disponible sin conexión', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
   
