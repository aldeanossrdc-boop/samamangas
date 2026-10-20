// functions/api/_fal.js — motor Fal.ai (imágenes, edición de dibujos, referencias y chat). Usa la variable FAL_KEY de Cloudflare.
// Modelos (el CEO los elige en el panel; también se pueden cambiar con variables de Cloudflare):
//   SalaMangaS IA / personajes:  qwen (por defecto) · flux2-flash · flux2-dev · flux2-flex (hasta 10 referencias) · flux2-pro
//   Lápiz:                       qwen (Qwen Image Edit, por defecto) · flux-kontext
import { IAError } from './_ia.js';

export const falKey = env => env.FAL_KEY || env.FAL_API_KEY || '';
export const falDisponible = env => !!falKey(env);

export const ESCENAS_FAL = ['qwen', 'flux2-flash', 'flux2-dev', 'flux2-flex', 'flux2-pro'];
const T2I = env => ({
  qwen: env.FAL_MODELO_QWEN || 'fal-ai/qwen-image',
  'flux2-flash': env.FAL_MODELO_FLUX2_FLASH || 'fal-ai/flux-2/flash',
  'flux2-dev': env.FAL_MODELO_FLUX2_DEV || 'fal-ai/flux-2',
  'flux2-flex': env.FAL_MODELO_FLUX2_FLEX || 'fal-ai/flux-2-flex',
  'flux2-pro': env.FAL_MODELO_FLUX2_PRO || 'fal-ai/flux-2-pro'
});
const EDIT_MULTI = env => ({
  qwen: env.FAL_MODELO_MULTI || 'fal-ai/qwen-image-edit-plus',
  'flux2-flash': env.FAL_MODELO_FLUX2_FLASH_EDIT || 'fal-ai/flux-2/flash/edit',
  'flux2-dev': env.FAL_MODELO_FLUX2_DEV_EDIT || 'fal-ai/flux-2/edit',
  'flux2-flex': env.FAL_MODELO_FLUX2_FLEX_EDIT || 'fal-ai/flux-2-flex/edit',
  'flux2-pro': env.FAL_MODELO_FLUX2_PRO_EDIT || 'fal-ai/flux-2-pro/edit'
});
const MAX_REFS = { qwen: 3, 'flux2-flash': 4, 'flux2-dev': 4, 'flux2-flex': 10, 'flux2-pro': 9 };
const esFlux = e => String(e || '').startsWith('flux2');

export const falModelo = (env, cual) => ({
  qwen: env.FAL_MODELO_QWEN || 'fal-ai/qwen-image',
  edit: env.FAL_MODELO_EDIT || 'fal-ai/qwen-image-edit',
  kontext: env.FAL_MODELO_KONTEXT || 'fal-ai/flux-kontext/dev',
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
// Algunos modelos no aceptan todos los parámetros: si da 422 se reintenta sin los opcionales.
async function llamarFlexible(env, modelo, input, opcionales) {
  let res = await llamar(env, modelo, input);
  if (!res.ok && res.status === 422 && opcionales && opcionales.length) {
    const limpio = { ...input }; opcionales.forEach(k => delete limpio[k]);
    res = await llamar(env, modelo, limpio);
  }
  return res;
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
const dataUri = async a => 'data:' + (a.type && a.type.startsWith('image/') ? a.type : 'image/jpeg') + ';base64,' + aBase64(await a.arrayBuffer());

// Texto → imagen. seguro=false apaga el filtro de imágenes de Fal (solo el CEO).
export async function falImagenes(env, { escena = 'qwen', prompt, w, h, n = 1, colorModo = '', seguro = true }) {
  const e = ESCENAS_FAL.includes(escena) ? escena : 'qwen';
  const modelo = T2I(env)[e];
  const input = { prompt, image_size: { width: w, height: h }, num_images: 1, output_format: 'jpeg', sync_mode: true, enable_safety_checker: !!seguro };
  if (esFlux(e) && !seguro) input.safety_tolerance = '5';
  if (!esFlux(e)) {   // Qwen entiende "negative_prompt"; FLUX no
    const sinDesnudos = seguro ? 'nudity, nude, naked, bare nipples, exposed genitals, explicit sexual acts' : '';
    const negColor = colorModo === 'B/N' ? 'color, colorful, colored, saturated' : colorModo === 'Color' ? 'monochrome, grayscale, black and white' : '';
    const neg = [negColor, sinDesnudos, 'text, letters, labels, watermark'].filter(Boolean).join(', ');
    if (neg) input.negative_prompt = neg;
  }
  const pedidos = Array.from({ length: Math.max(1, n) }, async () => {
    const res = await llamarFlexible(env, modelo, input, ['safety_tolerance', 'sync_mode', 'negative_prompt']);
    if (!res.ok) { console.error('Fal imagen', modelo, res.status, res.txt.slice(0, 500)); throw errorFal(res.status, res.txt); }
    return imagenDe(res, modelo);
  });
  return Promise.all(pedidos);
}

// Edita UN dibujo (Lápiz) o limpia una referencia. motor: 'qwen' (Qwen Image Edit) o 'flux-kontext'
export async function falEditar(env, { prompt, archivo, seguro = true, motor = 'qwen' }) {
  const modelo = motor === 'flux-kontext' ? falModelo(env, 'kontext') : falModelo(env, 'edit');
  const input = { prompt, image_url: await dataUri(archivo), num_images: 1, output_format: 'jpeg', sync_mode: true, enable_safety_checker: !!seguro };
  const res = await llamarFlexible(env, modelo, input, ['sync_mode']);
  if (!res.ok) { console.error('Fal edición', modelo, res.status, res.txt.slice(0, 500)); throw errorFal(res.status, res.txt); }
  return imagenDe(res, modelo);
}

// Imagen NUEVA usando varias referencias (personajes, lugar, outfit...). Si el modelo rechaza tantas, reintenta con menos.
export async function falEditarMulti(env, { escena = 'qwen', prompt, archivos, w, h, seguro = true }) {
  const e = ESCENAS_FAL.includes(escena) ? escena : 'qwen';
  const modelo = EDIT_MULTI(env)[e];
  const urls = [];
  for (const a of archivos.slice(0, MAX_REFS[e])) urls.push(await dataUri(a));
  const intentos = [...new Set([urls.length, 3, 2, 1].filter(k => k <= urls.length && k > 0))];
  let ultimo = null;
  for (const k of intentos) {
    for (const conTamano of [true, false]) {
      const input = { prompt, image_urls: urls.slice(0, k), num_images: 1, output_format: 'jpeg', sync_mode: true, enable_safety_checker: !!seguro };
      if (esFlux(e) && !seguro) input.safety_tolerance = '5';
      if (conTamano) input.image_size = { width: w, height: h };
      const res = await llamar(env, modelo, input);
      if (res.ok) return imagenDe(res, modelo);
      console.error('Fal multi', modelo, 'imgs=' + k, 'tam=' + conTamano, res.status, res.txt.slice(0, 400));
      ultimo = res;
      if (res.status !== 422) throw errorFal(res.status, res.txt);
    }
  }
  throw errorFal(ultimo ? ultimo.status : 502, ultimo ? ultimo.txt : '');
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
    if (res.status !== 422 && res.status !== 404) break;
  }
  throw ultimo && !ultimo.ok ? errorFal(ultimo.status, ultimo.txt) : new IAError('El asistente no pudo responder. Probá de nuevo.', 502);
}

// Saldo de la cuenta de Fal. La API de facturación pide una clave de tipo ADMIN (variable FAL_ADMIN_KEY); si no está, se prueba con FAL_KEY.
export async function falSaldo(env) {
  const key = env.FAL_ADMIN_KEY || falKey(env);
  if (!key) return { ok: false, error: 'Falta FAL_KEY en Cloudflare.' };
  try {
    const r = await fetch('https://api.fal.ai/v1/account/billing?expand=credits', { headers: { Authorization: 'Key ' + key, Accept: 'application/json' } });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok) {
      const msg = (j && ((j.error && (j.error.message || j.error)) || j.message || j.detail)) || t.slice(0, 160);
      const admin = (r.status === 401 || r.status === 403) ? ' Para leer el saldo Fal pide una clave ADMIN: creala en fal.ai (API Keys, rol Admin) y cargala en Cloudflare como FAL_ADMIN_KEY.' : '';
      return { ok: false, status: r.status, error: 'Fal respondió ' + r.status + ': ' + String(msg) + admin };
    }
    const c = j && j.credits;
    if (!c || c.current_balance == null) return { ok: false, error: 'Fal no devolvió el saldo.' };
    return { ok: true, saldo: Number(c.current_balance), moneda: c.currency || 'USD', cuenta: (j && j.username) || '' };
  } catch (e) { return { ok: false, error: 'No se pudo consultar a Fal: ' + e.message }; }
}
