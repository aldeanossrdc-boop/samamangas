/* SalaMangaS · service worker · actualización automática
   Idea: las PÁGINAS (html) siempre se piden primero a internet, así nadie queda
   con la versión vieja. Solo se usa la copia guardada si no hay conexión.
   Cada vez que este archivo cambia (aunque sea el número de VERSION), el celu
   lo detecta, instala el nuevo, borra los cachés viejos y toma el control. */
const VERSION = '2026-10-07-1'; /* cambiá este número en cada deploy importante */
const CACHE = 'salamangas-' + VERSION;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            /* Supabase, Cloudinary, pagos, fuentes: directo */
  if (url.pathname.startsWith('/api/')) return;               /* pagos / IA / saldo: nunca se guardan */
  if (url.pathname === '/service-worker.js') return;
  if (req.headers.has('range')) return;
  const esPagina = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  e.respondWith(esPagina ? redPrimero(req) : cacheYActualiza(req, e));
});

async function redPrimero(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      const c = await caches.open(CACHE);
      c.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const c = await caches.open(CACHE);
    return (await c.match(req)) || (await c.match('/')) || (await c.match('/index.html')) || Response.error();
  }
}

async function cacheYActualiza(req, e) {
  const c = await caches.open(CACHE);
  const guardado = await c.match(req);
  const red = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') c.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (guardado) { e.waitUntil(red); return guardado; }
  return (await red) || Response.error();
}
