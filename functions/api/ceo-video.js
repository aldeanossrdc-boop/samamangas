// functions/api/ceo-video.js  ·  POST /api/ceo-video   (SOLO CEO)
// Genera videos con Fal.ai para los tutoriales de la app.
//   { accion:'crear',  modelo:'rapido'|'calidad', objetivo, pasos:[{texto, imagen_url?}], duracion:5|10, formato:'9:16'|'16:9'|'1:1' }
//        -> traduce del español, encola UN video por paso (cada captura = una escena) y devuelve { trabajos:[{status_url,response_url}], costo_usd }
//   { accion:'unir', video_urls:[...] }  -> une los videos en uno solo (Fal ffmpeg) y devuelve un trabajo para consultar con 'estado'
//   { accion:'estado', status_url, response_url }
//        -> { estado:'cola'|'generando'|'listo'|'fallo', video_url? }
// Precios de referencia en Fal (por segundo): Kling 2.5 Turbo Pro ~US$0,07 · Kling 3 Pro ~US$0,14.
import { out } from './_shared.js';
import { usuarioIA } from './_ia.js';
import { motorChat } from './_motor.js';

const MODELOS = {
  rapido:  { t2v: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', i2v: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', img: 'image_url',       usd: 0.07 },
  calidad: { t2v: 'fal-ai/kling-video/v3/pro/text-to-video',         i2v: 'fal-ai/kling-video/v3/pro/image-to-video',         img: 'start_image_url', usd: 0.14 },
};
const FORMATOS = ['9:16', '16:9', '1:1'];
const NEG = 'blurry, distorted, low quality, deformed hands, extra fingers, watermark, unreadable text';

const hdr = env => ({ Authorization: 'Key ' + env.FAL_KEY, 'Content-Type': 'application/json' });
// Solo se aceptan direcciones de la cola de Fal (la clave nunca se manda a otro sitio)
const urlFalOk = u => typeof u === 'string' && /^https:\/\/queue\.fal\.run\//.test(u);

// Traduce al inglés una lista de textos (vacíos quedan vacíos). Si falla, se usa el texto original.
async function traducir(env, textos) {
  const idx = textos.map((t, i) => (t ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return textos.map(() => '');
  try {
    const r = await motorChat(env, {
      system: 'You translate Spanish into English for an AI video generator. Keep it short, literal and visual (what the screen shows and what the finger does). Return ONLY a JSON array of strings, same length and order as the input, no extra text.',
      mensajes: [{ role: 'user', content: JSON.stringify(idx.map(i => textos[i])) }],
      max_tokens: 900,
    });
    const txt = typeof r === 'string' ? r : (r && (r.texto || r.text || r.content)) || '';
    const arr = JSON.parse(String(txt).replace(/```json|```/g, '').trim());
    if (!Array.isArray(arr) || arr.length !== idx.length) throw new Error('formato');
    const res = textos.map(() => '');
    idx.forEach((i, k) => { res[i] = String(arr[k] || textos[i]).slice(0, 600); });
    return res;
  } catch (e) {
    console.warn('Traducción falló, se usa el español:', e && e.message);
    return textos.map(t => t || '');
  }
}

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
      const dur = Number(b.duracion) === 10 ? 10 : 5;
      const formato = FORMATOS.includes(b.formato) ? b.formato : '9:16';
      const objetivo = String(b.objetivo || '').trim().slice(0, 1500);
      let pasos = (Array.isArray(b.pasos) ? b.pasos : []).slice(0, 8).map(p => ({
        texto: String((p && p.texto) || '').trim().slice(0, 500),
        imagen_url: String((p && p.imagen_url) || ''),
      })).filter(p => p.texto || p.imagen_url);
      for (const p of pasos) if (p.imagen_url && !/^https:\/\/res\.cloudinary\.com\//.test(p.imagen_url)) return out(400, { error: 'Las capturas deben estar subidas a la app' });
      if (!pasos.length) {
        if (objetivo.length < 10) return out(400, { error: 'Describí mejor el video o agregá pasos con capturas' });
        pasos = [{ texto: '', imagen_url: '' }];
      }
      // El español se traduce al inglés (los modelos de video entienden mejor el inglés)
      const [objEn, ...pasosEn] = await traducir(env, [objetivo, ...pasos.map(p => p.texto)]);
      const n = pasos.length;
      const trabajos = [];
      for (let i = 0; i < n; i++) {
        const p = pasos[i];
        const conImg = !!p.imagen_url;
        const prompt = [
          'Smartphone app tutorial video' + (n > 1 ? ', step ' + (i + 1) + ' of ' + n : '') + '.',
          objEn ? 'Goal of the tutorial: ' + objEn + '.' : '',
          pasosEn[i] ? 'In this step: ' + pasosEn[i] + '.' : '',
          conImg ? 'Start exactly from the provided screenshot: keep the app interface, colors, layout and texts unchanged, and show a finger tapping or swiping on the screen with smooth realistic motion.' : 'Show a clean modern phone app interface in purple and gold with a finger tapping the screen.',
          'No new text, no logos, no watermarks.',
        ].filter(Boolean).join(' ').slice(0, 2000);
        const cuerpo = conImg
          ? { prompt, duration: String(dur), negative_prompt: NEG, [m.img]: p.imagen_url }
          : { prompt, duration: String(dur), aspect_ratio: formato, negative_prompt: NEG };
        const r = await fetch('https://queue.fal.run/' + (conImg ? m.i2v : m.t2v), { method: 'POST', headers: hdr(env), body: JSON.stringify(cuerpo) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.status_url) return out(502, { error: 'Fal no aceptó el paso ' + (i + 1) + ': ' + (j.detail ? JSON.stringify(j.detail).slice(0, 200) : r.status) });
        trabajos.push({ status_url: j.status_url, response_url: j.response_url });
      }
      return out(200, { ok: true, trabajos, costo_usd: +(m.usd * dur * n).toFixed(2) });
    }

    if (b.accion === 'unir') {
      const urls = (Array.isArray(b.video_urls) ? b.video_urls : []).filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 8);
      if (urls.length < 2) return out(400, { error: 'Hacen falta al menos 2 videos' });
      const r = await fetch('https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos', { method: 'POST', headers: hdr(env), body: JSON.stringify({ video_urls: urls }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.status_url) return out(502, { error: 'No se pudo unir los videos: ' + (j.detail ? JSON.stringify(j.detail).slice(0, 200) : r.status) });
      return out(200, { ok: true, status_url: j.status_url, response_url: j.response_url });
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
