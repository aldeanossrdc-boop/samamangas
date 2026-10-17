// functions/api/_fal.js — motor Fal.ai (imágenes, edición de dibujos y chat). Usa la variable FAL_KEY de Cloudflare.
// Modelos (se pueden cambiar desde Cloudflare sin tocar código):
//   FAL_MODELO_QWEN  = fal-ai/qwen-image        (SalaMangaS IA: texto → imagen)
//   FAL_MODELO_EDIT  = fal-ai/qwen-image-edit   (Lápiz: edita tu dibujo)
//   FAL_MODELO_MULTI = fal-ai/qwen-image-edit-plus (SalaMangaS IA con personajes/lugar/outfit de referencia)
//   FAL_MODELO_CHAT  = google/gemini-2.5-flash  (asistentes, vía fal-ai/any-llm)
import { IAError } from './_ia.js';

export const falKey = env => env.FAL_KEY || env.FAL_API_KEY || '';
export const falDisponible = env => !!falKey(env);

export const falModelo = (env, cual) => ({
  qwen: env.FAL_MODELO_QWEN || 'fal-ai/qwen-image',
  edit: env.FAL_MODELO_EDIT || 'fal-ai/qwen-image-edit',
  multi: env.FAL_MODELO_MULTI || 'fal-ai/qwen-image-edit-plus',
  chat: env.FAL_MODELO_CHAT || 'google/gemini-2.5-flash'
})[cual];

function errorFal(status, txt) {
  const t = String(txt || '').toLowerCase();
  if (status === 401) return new IAError('La IA no está bien configurada (revisar FAL_KEY).', 503, 'config');
  if (status === 402 || /exhausted|balance|locked|insufficient|billing/.test(t)) return new IAError('La IA no está disponible en este momento. Avisale al equipo de SalaMangaS.', 503, 'sin_saldo_ia');
  if (/content_policy|nsfw|safety|moderat|violat/.test(t)) return new IAError('La IA no aceptó este pedido (contenido no permitido). Probá describirlo de otra forma.', 400, 'contenido');
  if (status === 429) return new IAError('Hay mucha gente usando la IA. Probá de nuevo en un minuto.', 429);
  return new IAError('La IA no pudo crear la imagen. Probá de nuevo.', 502);
}

async function llamar(env, modelo, input) {
  const r = await fetch('https://fal.run/' + modelo, {
    method: 'POST',
    headers: { Authorization: 'Key ' + falKey(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { ok: r.ok, status: r.status, txt, j };
}

function aBase64(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

// Devuelve "data:image/...;base64,..." (con sync_mode Fal ya la manda así; si manda un link, se descarga acá)
async function aDataUrl(url) {
  if (String(url).startsWith('data:')) return url;
  const r = await fetch(url);
  if (!r.ok) throw new IAError('No se pudo descargar la imagen generada. Probá de nuevo.', 502);
  const tipo = (r.headers.get('content-type') || 'image/png').split(';')[0];
  return 'data:' + tipo + ';base64,' + aBase64(await r.arrayBuffer());
}

async function imagenDe(res, etiqueta) {
  const u = res.j && res.j.images && res.j.images[0] && (res.j.images[0].url || res.j.images[0]);
  if (!u || typeof u !== 'string') { console.error('Fal sin imagen', etiqueta, res.txt.slice(0, 300)); throw new IAError('La IA no devolvió la imagen. Probá de nuevo.', 502); }
  return aDataUrl(u);
}

// Texto → imagen. seguro=false apaga el filtro de imágenes de Fal (solo se usa para el CEO).
export async function falImagenes(env, { prompt, w, h, n = 1, colorModo = '', seguro = true }) {
  const modelo = falModelo(env, 'qwen');
  const input = { prompt, image_size: { width: w, height: h }, num_images: 1, output_format: 'jpeg', sync_mode: true, enable_safety_checker: !!seguro };
  if (colorModo === 'B/N') input.negative_prompt = 'color, colorful, colored, saturated';
  if (colorModo === 'Color') input.negative_prompt = 'monochrome, grayscale, black and white';
  const pedidos = Array.from({ length: Math.max(1, n) }, async () => {
    const res = await llamar(env, modelo, input);
    if (!res.ok) { console.error('Fal imagen', modelo, res.status, res.txt.slice(0, 500)); throw errorFal(res.status, res.txt); }
    return imagenDe(res, modelo);
  });
  return Promise.all(pedidos);
}

// Edita el dibujo (archivo = File/Blob de la imagen a lápiz) siguiendo la instrucción.
export async function falEditar(env, { prompt, archivo, seguro = true }) {
  const modelo = falModelo(env, 'edit');
  const tipo = archivo.type && archivo.type.startsWith('image/') ? archivo.type : 'image/jpeg';
  const input = { prompt, image_url: 'data:' + tipo + ';base64,' + aBase64(await archivo.arrayBuffer()), num_images: 1, output_format: 'jpeg', sync_mode: true, enable_safety_checker: !!seguro };
  const res = await llamar(env, modelo, input);
  if (!res.ok) { console.error('Fal edición', modelo, res.status, res.txt.slice(0, 500)); throw errorFal(res.status, res.txt); }
  return imagenDe(res, modelo);
}

// Chat (asistentes). Fal usa "any-llm": un solo texto + instrucción de sistema.
export async function falChat(env, { system, mensajes }) {
  const prompt = mensajes.map(m => (m.role === 'assistant' ? 'Asistente: ' : 'Usuario: ') + m.content).join('\n') + '\nAsistente:';
  const candidatos = [...new Set([falModelo(env, 'chat'), 'google/gemini-2.5-flash', 'google/gemini-flash-1.5', 'openai/gpt-4o-mini', 'meta-llama/llama-3.2-3b-instruct'])];
  let ultimo = null;
  for (const model of candidatos.slice(0, 4)) {
    const res = await llamar(env, 'fal-ai/any-llm', { model, prompt, system_prompt: system });
    if (res.ok && res.j && typeof res.j.output === 'string' && res.j.output.trim()) return res.j.output.trim();
    console.error('Fal chat', model, res.status, res.txt.slice(0, 300));
    ultimo = res;
    if (res.status !== 422 && res.status !== 404) break;   // 422/404 = ese modelo no está disponible: se prueba el siguiente
  }
  throw ultimo && !ultimo.ok ? errorFal(ultimo.status, ultimo.txt) : new IAError('El asistente no pudo responder. Probá de nuevo.', 502);
}

// Crea una imagen NUEVA usando varias imágenes de referencia (personajes, lugar, outfit...).
// Si el modelo rechaza tantas imágenes, reintenta con menos (3, 2, 1).
export async function falEditarMulti(env, { prompt, archivos, w, h, seguro = true }) {
  const modelo = falModelo(env, 'multi');
  const urls = [];
  for (const a of archivos) {
    const tipo = a.type && a.type.startsWith('image/') ? a.type : 'image/jpeg';
    urls.push('data:' + tipo + ';base64,' + aBase64(await a.arrayBuffer()));
  }
  const intentos = [...new Set([urls.length, 3, 2, 1].filter(n => n <= urls.length && n > 0))];
  let ultimo = null;
  for (const n of intentos) {
    for (const conTamano of [true, false]) {
      const input = { prompt, image_urls: urls.slice(0, n), num_images: 1, output_format: 'jpeg', sync_mode: true, enable_safety_checker: !!seguro };
      if (conTamano) input.image_size = { width: w, height: h };
      const res = await llamar(env, modelo, input);
      if (res.ok) return imagenDe(res, modelo);
      console.error('Fal multi', modelo, 'imgs=' + n, 'tam=' + conTamano, res.status, res.txt.slice(0, 400));
      ultimo = res;
      if (res.status !== 422) throw errorFal(res.status, res.txt);   // solo se reintenta si es un problema de datos (422)
    }
  }
  throw errorFal(ultimo ? ultimo.status : 502, ultimo ? ultimo.txt : '');
}
