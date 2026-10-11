// functions/api/ia-personaje.js — POST /api/ia-personaje  { nombre, descripcion, estilo }
// Genera la imagen de un personaje con FLUX Schnell (DeepInfra, ~US$0,0005). NO guarda nada ni descuenta el
// cupo: el cupo se descuenta recién cuando el usuario ACEPTA el personaje (así puede regenerar sin gastar).
import { out } from './_shared.js';
import { IAError, usuarioIA, rpcUsuario } from './_ia.js';
import { diDisponible, diModelo, diImagenes } from './_deepinfra.js';
import { filtrar } from './_filtro.js';

export async function onRequestPost({ request, env }) {
  try {
    const ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para crear personajes' });
    if (!diDisponible(env)) return out(503, { error: 'Crear personajes con IA todavía no está disponible.' });
    const b = await request.json().catch(() => ({}));
    const nombre = String(b.nombre || '').trim().slice(0, 60);
    const desc = String(b.descripcion || '').trim().slice(0, 600);
    const estilo = String(b.estilo || 'manga').trim().slice(0, 60);
    if (nombre.length < 2 || desc.length < 5) return out(400, { error: 'Poné un nombre y una descripción del personaje.' });
    const bloqueo = await filtrar(env, ctx, nombre, desc, estilo);
    if (bloqueo) return out(400, { error: bloqueo, codigo: 'filtro' });
    if (!ctx.esCeo) {
      const r = await rpcUsuario(env, ctx.token, 'puede_generar_personaje', {});
      if (r === 'sin_credito') return out(402, { error: 'Ya usaste los personajes de tu plan. Cada personaje extra cuesta 2 Sakuras IA.', codigo: 'sin_credito' });
      if (r === 'limite_dia') return out(429, { error: 'Llegaste al máximo de intentos de hoy. Probá mañana.', codigo: 'limite_dia' });
    }
    const prompt = 'Character design, single character, full body, standing pose, centered, plain white background, no text, no watermark. Style: ' + estilo + '. Character: ' + nombre + '. ' + desc;
    const [imagen] = await diImagenes(env, { modelo: diModelo(env, 'personaje'), prompt, w: 832, h: 1248, n: 1 });
    return out(200, { ok: true, imagen });
  } catch (e) {
    return out(e instanceof IAError ? e.status : 500, { error: e instanceof IAError ? e.message : 'No se pudo crear el personaje. Probá de nuevo.', codigo: e.codigo || '' });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
