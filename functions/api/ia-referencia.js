// functions/api/ia-referencia.js  ·  POST /api/ia-referencia  { url }
// Convierte la HOJA de un personaje (varias vistas, a veces con textos) en UNA referencia limpia: una sola figura, de frente, sin textos.
// Con esa referencia limpia SalaMangaS IA ya no copia la hoja entera. La app la pide una sola vez por personaje y la guarda.
import { out } from './_shared.js';
import { IAError, usuarioIA } from './_ia.js';
import { motorActivo, motorEditar } from './_motor.js';

const hostOk = h => h === 'res.cloudinary.com' || h.endsWith('.cloudinary.com') || h === 'leonardo.ai' || h.endsWith('.leonardo.ai');

export async function onRequestPost({ request, env }) {
  try {
    const ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión' });
    if (!motorActivo(env)) return out(503, { error: 'La IA todavía no está disponible.' });
    const b = await request.json().catch(() => ({}));
    let u; try { u = new URL(String(b.url || '')); } catch (e) { return out(400, { error: 'Dirección inválida' }); }
    if (u.protocol !== 'https:' || !hostOk(u.hostname)) return out(400, { error: 'Origen no permitido' });
    const r = await fetch(u.toString());
    if (!r.ok) return out(502, { error: 'No se pudo traer la imagen del personaje.' });
    const buf = await r.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 12 * 1024 * 1024) return out(400, { error: 'La imagen del personaje es muy pesada.' });
    const tipo = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const archivo = new File([buf], 'hoja.jpg', { type: tipo.startsWith('image/') ? tipo : 'image/jpeg' });
    const prompt = 'From this character model sheet, redraw ONLY the main character as ONE single full-body figure, front view, standing, centered, on a plain light-grey background. Keep the exact same face, hair, body proportions, outfit and accessories. NO text, NO labels, NO titles, NO other views, NO other figures, NO panels, NO frames.';
    const { imagen } = await motorEditar(env, { prompt, archivo, w: 832, h: 1248, seguro: !ctx.esCeo, motorLapiz: 'qwen' });
    return out(200, { ok: true, imagen });
  } catch (e) {
    return out(e instanceof IAError ? e.status : 500, { error: e instanceof IAError ? e.message : 'No se pudo preparar la referencia.' });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
