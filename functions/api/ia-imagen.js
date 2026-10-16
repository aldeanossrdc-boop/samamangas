// functions/api/ia-imagen.js — GET /api/ia-imagen?u=<url de la imagen en Leonardo>
// Muestra/descarga las imágenes de Leonardo desde tu propio sitio (sin problemas de CORS en el navegador).
// Solo acepta direcciones https de leonardo.ai: no sirve de proxy para otra cosa.
// v2: vuelve a ser tolerante como la tuya original (sigue redirecciones, no rechaza por tipo de archivo) y,
// si algo falla, dice QUÉ respondió Leonardo en vez de un error genérico.
const hostOk = h => h === 'leonardo.ai' || h.endsWith('.leonardo.ai');

// Si el servidor de origen no manda un tipo de imagen válido, se detecta mirando los primeros bytes.
function tipoPorBytes(b) {
  if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return null;
}

export async function onRequestGet({ request }) {
  let t;
  try { t = new URL(new URL(request.url).searchParams.get('u') || ''); } catch (e) { return new Response('Pedido inválido', { status: 400 }); }
  if (t.protocol !== 'https:' || !hostOk(t.hostname)) return new Response('Origen no permitido', { status: 400 });

  let r;
  try {
    r = await fetch(t.toString(), { headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 (compatible; SalaMangaS/1.0)' } });
  } catch (e) {
    console.error('ia-imagen: no se pudo conectar con Leonardo:', e.message);
    return new Response('No se pudo conectar con el servidor de imágenes: ' + e.message, { status: 502 });
  }
  if (!r.ok) {
    console.error('ia-imagen: Leonardo respondió', r.status, 'para', t.hostname + t.pathname);
    return new Response('El servidor de imágenes respondió ' + r.status, { status: r.status === 404 ? 404 : 502, headers: { 'X-Upstream-Status': String(r.status) } });
  }

  const buf = await r.arrayBuffer();
  if (!buf.byteLength) return new Response('La imagen llegó vacía', { status: 502 });
  let tipo = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\//.test(tipo)) tipo = tipoPorBytes(new Uint8Array(buf.slice(0, 12))) || 'image/jpeg';

  return new Response(buf, { status: 200, headers: { 'Content-Type': tipo, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' } });
}
