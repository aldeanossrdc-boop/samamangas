// functions/api/ia-imagen.js — GET /api/ia-imagen?u=<url de la imagen en Leonardo>
// Hace de "puente" para que el navegador pueda mostrar/descargar la imagen sin problemas de CORS.
// Va SIN login (un <img src> no puede mandar Authorization), por eso solo acepta imágenes de Leonardo (https).
const HOST_OK = h => h === 'cdn.leonardo.ai' || h.endsWith('.leonardo.ai');
const MAX = 15 * 1024 * 1024;

export async function onRequestGet({ request }) {
  let u;
  try { u = new URL(new URL(request.url).searchParams.get('u') || ''); } catch (e) { return new Response('URL inválida', { status: 400 }); }
  if (u.protocol !== 'https:' || !HOST_OK(u.hostname) || u.username || u.password) return new Response('Origen no permitido', { status: 400 });
  let r;
  try { r = await fetch(u.href, { redirect: 'error' }); } catch (e) { return new Response('No se pudo traer la imagen', { status: 502 }); }
  if (!r.ok) return new Response('No se pudo traer la imagen', { status: 502 });
  const tipo = r.headers.get('content-type') || '';
  if (!/^image\//i.test(tipo)) return new Response('No es una imagen', { status: 415 });
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX) return new Response('Imagen demasiado pesada', { status: 413 });
  return new Response(r.body, { status: 200, headers: { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
