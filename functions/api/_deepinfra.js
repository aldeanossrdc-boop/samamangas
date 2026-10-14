// functions/api/_deepinfra.js — motor DeepInfra (imágenes + chat). Usa la variable DEEPINFRA_API_KEY.
import { IAError } from './_ia.js';

export const DI_BASE = 'https://api.deepinfra.com/v1/openai';
export const diDisponible = env => !!env.DEEPINFRA_API_KEY;

// Nombres de modelos. Si DeepInfra cambia alguno, se corrige desde Cloudflare (sin tocar código):
// DI_MODELO_PERSONAJE / DI_MODELO_QWEN / DI_MODELO_KONTEXT / DI_MODELO_EDIT / DI_MODELO_CHAT
export const diModelo = (env, cual) => ({
  personaje: env.DI_MODELO_PERSONAJE || 'black-forest-labs/FLUX-1-schnell',  // Crear personaje (~US$0,0005)
  qwen:      env.DI_MODELO_QWEN      || 'Qwen/Qwen-Image',                   // SalaMangaS IA (barato)
  kontext:   env.DI_MODELO_KONTEXT   || 'black-forest-labs/FLUX.1-Kontext-dev', // OJO: Kontext es de EDICIÓN (necesita imagen de entrada); no sirve para texto→imagen
  edit:      env.DI_MODELO_EDIT      || 'Qwen/Qwen-Image-Edit',              // Lápiz cuando Leonardo está en 0
  chat:      env.DI_MODELO_CHAT      || 'deepseek-ai/DeepSeek-V4-Flash'      // Asistentes
})[cual];

function errorDI(status, txt) {
  const t = String(txt || '').toLowerCase();
  if (status === 401 || status === 403) return new IAError('La IA no está bien configurada (revisar DEEPINFRA_API_KEY).', 503, 'config');
  if (status === 402 || /insufficient|balance|payment|credit|quota/.test(t)) return new IAError('La IA no está disponible en este momento. Avisale al equipo de SalaMangaS.', 503, 'sin_saldo_ia');
  if (/nsfw|safety|moderat|policy|blocked|prohibit|not allowed/.test(t)) return new IAError('La IA no aceptó este pedido (contenido no permitido). Probá describirlo de otra forma.', 400, 'contenido');
  if (status === 429) return new IAError('Hay mucha gente usando la IA. Probá de nuevo en un minuto.', 429);
  return new IAError('La IA no pudo crear la imagen. Probá de nuevo.', 502);
}

function aDataUrl(b64) {
  const m = b64.startsWith('/9j/') ? 'jpeg' : b64.startsWith('UklG') ? 'webp' : 'png';
  return 'data:image/' + m + ';base64,' + b64;
}
const cab = env => ({ Authorization: 'Bearer ' + env.DEEPINFRA_API_KEY });

async function unaImagen(env, modelo, prompt, w, h) {
  const r = await fetch(DI_BASE + '/images/generations', {
    method: 'POST', headers: { ...cab(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, prompt, size: w + 'x' + h, n: 1, response_format: 'b64_json' })
  });
  const txt = await r.text();
  if (!r.ok) { console.error('DeepInfra imagen', modelo, r.status, txt.slice(0, 400)); throw errorDI(r.status, txt); }
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  const b = j && j.data && j.data[0] && j.data[0].b64_json;
  if (!b) { console.error('DeepInfra sin imagen', modelo, txt.slice(0, 300)); throw new IAError('La IA no devolvió la imagen. Probá de nuevo.', 502); }
  return aDataUrl(b);
}

// n imágenes (pedidos en paralelo). Devuelve un arreglo de "data:image/...;base64,..."
export async function diImagenes(env, { modelo, prompt, w, h, n }) {
  return Promise.all(Array.from({ length: n }, () => unaImagen(env, modelo, prompt, w, h)));
}

// Edita un dibujo (Qwen-Image-Edit). Devuelve 1 imagen "data:image/...".
export async function diEditar(env, { prompt, archivo, w, h }) {
  const armar = () => { const fd = new FormData(); fd.append('image', archivo, 'dibujo.jpg'); fd.append('prompt', prompt); fd.append('model', diModelo(env, 'edit')); fd.append('response_format', 'b64_json'); fd.append('size', w + 'x' + h); fd.append('n', '1'); return fd; };
  let r = await fetch(DI_BASE + '/images/edits', { method: 'POST', headers: cab(env), body: armar() });
  if (r.status === 404) r = await fetch('https://api.deepinfra.com/v1/images/edits', { method: 'POST', headers: cab(env), body: armar() });
  const txt = await r.text();
  if (!r.ok) { console.error('DeepInfra edición', r.status, txt.slice(0, 400)); throw errorDI(r.status, txt); }
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  const b = j && j.data && j.data[0] && j.data[0].b64_json;
  if (!b) { console.error('DeepInfra edición sin imagen', txt.slice(0, 300)); throw new IAError('La IA no devolvió la imagen. Probá de nuevo.', 502); }
  return aDataUrl(b);
}

// Chat (DeepSeek V4 Flash). mensajes = [{role:'user'|'assistant', content}]
export async function diChat(env, { system, mensajes, max_tokens = 600, temperature = 0.7 }) {
  const r = await fetch(DI_BASE + '/chat/completions', {
    method: 'POST', headers: { ...cab(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: diModelo(env, 'chat'), messages: [{ role: 'system', content: system }, ...mensajes], max_tokens, temperature, stream: false })
  });
  const txt = await r.text();
  if (!r.ok) { console.error('DeepInfra chat', r.status, txt.slice(0, 400)); throw errorDI(r.status, txt); }
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!c) throw new IAError('El asistente no pudo responder. Probá de nuevo.', 502);
  return String(c).trim();
}
