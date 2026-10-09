// functions/api/ia-imagen.js — GET /api/ia-imagen?u=<url de Leonardo>
// Muestra las imágenes de Leonardo desde tu propio sitio (así el celu puede
// guardarlas como portada o página sin problemas de seguridad del navegador).
// Solo acepta direcciones de leonardo.ai: no sirve de proxy para otra cosa.
export async function onRequestGet({ request }) {
  const u = new URL(request.url).searchParams.get('u') || '';
  let t; try { t = new URL(u); } catch (e) { return new Response('Pedido inválido', { status: 400 }); }
  if (t.protocol !== 'https:' || !(t.hostname === 'leonardo.ai' || t.hostname.endsWith('.leonardo.ai'))) return new Response('Origen no permitido', { status: 400 });
  const r = await fetch(t.toString());
  if (!r.ok) return new Response('No encontrada', { status: 404 });
  return new Response(r.body, { headers: { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
}
