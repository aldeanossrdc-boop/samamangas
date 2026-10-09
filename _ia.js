// functions/api/_ia.js — helpers de la IA (el "_" lo hace NO público)
// Usa SIEMPRE la variable LEONARDO_API_KEY de Cloudflare.
import { verifyUser } from './_shared.js';
import { CEO_EMAILS } from './_leonardo.js';

export const LEO_V1 = 'https://cloud.leonardo.ai/api/rest/v1';
export const LEO_V2 = 'https://cloud.leonardo.ai/api/rest/v2';

const SB_URL = env => env.SUPABASE_URL || 'https://zalfaldrmccncjsahdmi.supabase.co';
const SB_ANON = env => env.SUPABASE_KEY || 'sb_publishable_ghOA30jYrCYcWrwvA1pd2g_8VsjZoVV';

// Error con mensaje apto para mostrarle al usuario
export class IAError extends Error {
  constructor(msg, status = 500, codigo = '') { super(msg); this.status = status; this.codigo = codigo; }
}

// Quién es el usuario + si es CEO (el CEO genera sin gastar)
export async function usuarioIA(request, env) {
  const user = await verifyUser(request, env);
  if (!user) return null;
  const email = String(user.email || '').trim().toLowerCase();
  const esCeo = !!(user.email_confirmed_at || user.confirmed_at) && CEO_EMAILS.includes(email);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return { user, token, esCeo };
}

// ¿El CEO prendió la IA en el panel? (config.ia_activa = '1')
export async function iaActiva(env) {
  try {
    const r = await fetch(SB_URL(env) + '/rest/v1/config?clave=eq.ia_activa', {
      headers: { apikey: SB_ANON(env), Authorization: 'Bearer ' + SB_ANON(env) }
    });
    const j = await r.json();
    return Array.isArray(j) && !!j[0] && String(j[0].valor) === '1';
  } catch (e) { return false; }
}

// Llama una función de Supabase COMO el usuario (así auth.uid() es él, no se puede falsear)
export async function rpcUsuario(env, token, fn, body) {
  const r = await fetch(SB_URL(env) + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SB_ANON(env), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const txt = await r.text();
  let data = txt; try { data = JSON.parse(txt); } catch (e) {}
  if (!r.ok) throw new IAError((data && data.message) || 'Error al descontar la generación', 500);
  return data;
}

const cab = env => ({ Authorization: 'Bearer ' + env.LEONARDO_API_KEY, accept: 'application/json', 'content-type': 'application/json' });

// Sube una imagen de referencia a Leonardo (devuelve su id)
export async function subirReferencia(env, file) {
  const r = await fetch(LEO_V1 + '/init-image', { method: 'POST', headers: cab(env), body: JSON.stringify({ extension: 'jpg' }) });
  if (!r.ok) { console.error('init-image', r.status, await r.text().catch(() => '')); throw new IAError('No se pudo preparar la imagen de referencia', 502); }
  const j = await r.json();
  const u = j.uploadInitImage;
  if (!u || !u.url || !u.id) throw new IAError('Leonardo no aceptó la imagen de referencia', 502);
  const fields = typeof u.fields === 'string' ? JSON.parse(u.fields) : (u.fields || {});
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', file, 'referencia.jpg');
  const up = await fetch(u.url, { method: 'POST', body: fd });
  if (!up.ok) { console.error('subida S3', up.status); throw new IAError('No se pudo subir la imagen de referencia', 502); }
  return u.id;
}

// ---------- Modelos ----------
const ANIME_XL = 'e71a1c2f-4f80-4800-934f-2c68979d8cc8'; // Leonardo Anime XL (solo para el estilo "Anime")
const NEG = 'text, letters, words, watermark, logo, signature, deformed hands, extra fingers, extra limbs, low quality, blurry';
const ILUSTRACION = '645e4195-f63d-4715-a3f2-3fb1e6eb8c70';
const ESTILO_PHOENIX = {
  clasico: ILUSTRACION,
  chibi: ILUSTRACION,
  screentone: ILUSTRACION,
  dark: '33abbb99-03b9-4dd7-9761-ee98650b2c88',   // Cinematic Concept
  realista: 'a5632c7c-ddbb-4e2f-ba34-8456ab3ac436', // Cinematic
  noir: '621e1c9a-6319-4bee-a12d-ae40659162fa'      // Moody
};
const ANCHO = 832, ALTO = 1216; // vertical, tipo página de manga
// Imágenes por generación: Lápiz = 1 (ya hay un dibujo hecho) · SalaMangaS IA = 2 (el usuario elige)
export const cantidadPorModo = modo => (modo === 'lapiz' ? 1 : 2);

function extraerError(j, status) {
  const m = Array.isArray(j) ? (j[0] && (j[0].message || j[0].error)) : (j && (j.error || j.message || (j.errors && j.errors[0] && j.errors[0].message)));
  const t = String(m || '').toLowerCase();
  if (/nsfw|moderat|content|safety|blocked|policy/.test(t)) return new IAError('La IA no aceptó este pedido (contenido no permitido). Probá describirlo de otra forma.', 400, 'contenido');
  if (/credit|balance|insufficient|payment|quota|limit/.test(t) || status === 402 || status === 403) return new IAError('La IA no está disponible en este momento. Avisale al equipo de SalaMangaS.', 503, 'sin_saldo_ia');
  if (status === 429) return new IAError('Hay mucha gente usando la IA. Probá de nuevo en un minuto.', 429);
  return new IAError('La IA no pudo crear las imágenes. Probá de nuevo.', 502);
}

function extraerId(j) {
  return (j && ((j.generate && j.generate.generationId) || (j.sdGenerationJob && j.sdGenerationJob.generationId) || j.generationId || (j.data && j.data.generationId))) || null;
}

// Crea la generación. Devuelve { id, motor }
//  • Borrador            -> FLUX Schnell (rápido y barato)
//  • Estilo "Anime"      -> Leonardo Anime XL
//  • Todo lo demás       -> Phoenix 1.0 (principal)
export async function crearGeneracion(env, { prompt, estilo, borrador, dibujoId, personajeId, cantidad }) {
  let url, body, motor;
  if (borrador) {
    motor = 'flux-schnell'; url = LEO_V2 + '/generations';
    const p = { width: 768, height: 1024, prompt, quantity: cantidad, style_ids: [estilo === 'anime' ? 'b2a54a51-230b-4d4f-ad4e-8409bf58645f' : ILUSTRACION] };
    if (dibujoId) p.guidances = { content: [{ image: { id: dibujoId, type: 'UPLOADED' }, strength: 'HIGH' }] };
    body = { model: 'flux-schnell', parameters: p, public: false };
  } else if (estilo === 'anime') {
    motor = 'anime-xl'; url = LEO_V1 + '/generations';
    body = { prompt, modelId: ANIME_XL, num_images: cantidad, width: ANCHO, height: ALTO, negative_prompt: NEG, public: false };
    if (dibujoId) { body.init_image_id = dibujoId; body.init_strength = 0.5; }
  } else {
    motor = 'phoenix-1.0'; url = LEO_V2 + '/generations';
    const p = { mode: 'FAST', contrast: 'MEDIUM', width: ANCHO, height: ALTO, prompt, quantity: cantidad, negative_prompt: NEG, style_ids: [ESTILO_PHOENIX[estilo] || ILUSTRACION] };
    const g = {};
    if (dibujoId) g.image_to_image = [{ image: { id: dibujoId, type: 'UPLOADED' }, strength: 'HIGH' }];
    if (personajeId) g.character = [{ image: { id: personajeId, type: 'UPLOADED' }, strength: 'MID' }];
    if (Object.keys(g).length) p.guidances = g;
    body = { model: 'phoenix-v1.0', parameters: p, public: false };
  }
  const r = await fetch(url, { method: 'POST', headers: cab(env), body: JSON.stringify(body) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok) { console.error('Leonardo crear', motor, r.status, txt.slice(0, 500)); throw extraerError(j, r.status); }
  const id = extraerId(j);
  if (!id) { console.error('Leonardo sin id', motor, txt.slice(0, 500)); throw new IAError('La IA no devolvió el número de trabajo. Probá de nuevo.', 502); }
  return { id, motor };
}

export async function consultarGeneracion(env, id) {
  const r = await fetch(LEO_V1 + '/generations/' + encodeURIComponent(id), { headers: cab(env) });
  if (r.status === 404) return { status: 'PENDING', imagenes: [] };
  if (!r.ok) throw new IAError('No se pudo consultar la IA', 502);
  const j = await r.json();
  const g = j && j.generations_by_pk;
  if (!g) return { status: 'PENDING', imagenes: [] };
  return { status: g.status, imagenes: Array.isArray(g.generated_images) ? g.generated_images : [] };
}
