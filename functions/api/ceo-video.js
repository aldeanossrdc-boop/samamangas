// functions/api/ceo-video.js  ·  POST /api/ceo-video   (SOLO CEO)
// Genera videos con Fal.ai para los tutoriales de la app.
//   { accion:'crear',  modelo:'rapido'|'calidad', prompt, duracion:5|10, formato:'9:16'|'16:9'|'1:1', imagen_url? }
//        -> encola el trabajo en Fal y devuelve { status_url, response_url, costo_usd }
//   { accion:'estado', status_url, response_url }
//        -> { estado:'cola'|'generando'|'listo'|'fallo', video_url? }
// Precios de referencia en Fal (por segundo): Kling 2.5 Turbo Pro ~US$0,07 · Kling 3 Pro ~US$0,14.
import { out } from './_shared.js';
import { usuarioIA } from './_ia.js';

const MODELOS = {
  rapido:  { t2v: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', i2v: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', img: 'image_url',       usd: 0.07 },
  calidad: { t2v: 'fal-ai/kling-video/v3/pro/text-to-video',         i2v: 'fal-ai/kling-video/v3/pro/image-to-video',         img: 'start_image_url', usd: 0.14 },
};
const FORMATOS = ['9:16', '16:9', '1:1'];
const NEG = 'blurry, distorted, low quality, deformed hands, extra fingers, watermark, unreadable text';

const hdr = env => ({ Authorization: 'Key ' + env.FAL_KEY, 'Content-Type': 'application/json' });
// Solo se aceptan direcciones de la cola de Fal (la clave nunca se manda a otro sitio)
const urlFalOk = u => typeof u === 'string' && /^https:\/\/queue\.fal\.run\//.test(u);

export async function onRequestPost({ request, env }) {
  try {
    let ctx = null;
    try { ctx = await usuarioIA(request, env); } catch (e) { ctx = null; }
    if (!ctx) return out(401, { error: 'Iniciá sesión' });
    if (!ctx.esCeo) return out(403, { error: 'Solo el CEO puede generar videos' });
    if (!env.FAL_KEY) return out(500, { error: 'Falta FAL_KEY en el servidor' });

    const b = await request.json().catch(() => ({}));

    if (b.accion === 'crear') {
      const m = MODELOS[b.modelo] || MODELOS.rapido;
      const prompt = String(b.prompt || '').trim().slice(0, 2000);
      if (prompt.length < 10) return out(400, { error: 'Describí mejor el video (mínimo 10 letras)' });
      const dur = Number(b.duracion) === 10 ? 10 : 5;
      const formato = FORMATOS.includes(b.formato) ? b.formato : '9:16';
      const img = String(b.imagen_url || '');
      if (img && !/^https:\/\/res\.cloudinary\.com\//.test(img)) return out(400, { error: 'La imagen debe estar subida a la app' });

      const cuerpo = img
        ? { prompt, duration: String(dur), negative_prompt: NEG, [m.img]: img }
        : { prompt, duration: String(dur), aspect_ratio: formato, negative_prompt: NEG };
      const r = await fetch('https://queue.fal.run/' + (img ? m.i2v : m.t2v), { method: 'POST', headers: hdr(env), body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.status_url) return out(502, { error: 'Fal no aceptó el pedido: ' + (j.detail ? JSON.stringify(j.detail).slice(0, 200) : r.status) });
      return out(200, { ok: true, status_url: j.status_url, response_url: j.response_url, costo_usd: +(m.usd * dur).toFixed(2) });
    }

    if (b.accion === 'estado') {
      if (!urlFalOk(b.status_url) || !urlFalOk(b.response_url)) return out(400, { error: 'Dirección inválida' });
      const r = await fetch(b.status_url, { headers: hdr(env) });
      const s = await r.json().catch(() => ({}));
      if (!r.ok) return out(200, { estado: 'fallo', error: 'Fal respondió ' + r.status });
      if (s.status === 'IN_QUEUE') return out(200, { estado: 'cola', posicion: s.queue_position ?? null });
      if (s.status !== 'COMPLETED') return out(200, { estado: 'generando' });
      const rr = await fetch(b.response_url, { headers: hdr(env) });
      const d = await rr.json().catch(() => ({}));
      const url = d && d.video && d.video.url;
      if (!rr.ok || !url) return out(200, { estado: 'fallo', error: (d && d.detail ? JSON.stringify(d.detail).slice(0, 200) : 'Fal no devolvió el video') });
      return out(200, { estado: 'listo', video_url: url });
    }
    return out(400, { error: 'Acción inválida' });
  } catch (e) {
    return out(500, { error: (e && e.message) || 'Error del servidor' });
  }
}
