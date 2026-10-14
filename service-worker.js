/* SalaMangaS Service Worker — versión 2026.10.14.3
 * Sin caché de HTML, autenticación, Supabase ni endpoints API para evitar sesiones viejas.
 * Para publicar cambios, incrementá CACHE_VERSION. El navegador revisa el archivo al visitar la app.
 */
'use strict';
const CACHE_VERSION = 'salamangas-2026.10.14.3';

self.addEventListener('install', (event) => {
  // Activar la versión nueva sin obligar al usuario a desinstalar la PWA.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('salamangas-') && key !== CACHE_VERSION)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// No interceptamos fetch: HTML, OAuth, Supabase y APIs siempre van por la red.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'SalaMangaS';
  const options = {
    body: payload.body || payload.text || 'Tenés una nueva notificación.',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || 'salamangas-notificacion',
    renotify: Boolean(payload.renotify),
    data: { url: payload.url || payload.href || '/', notificationId: payload.id || null },
    // El servidor puede enviar actions si la plataforma los admite.
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : []
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification && event.notification.data && event.notification.data.url;
  let target;
  try { target = new URL(raw || '/', self.location.origin); }
  catch (_) { target = new URL('/', self.location.origin); }
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if ('focus' in client) {
        if ('navigate' in client && client.url !== target.href) await client.navigate(target.href);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target.href);
  })());
});

self.addEventListener('notificationclose', () => {});
