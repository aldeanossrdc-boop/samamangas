// functions/api/_motor.js — elige el proveedor de IA: Fal.ai (si existe FAL_KEY) y, si no, DeepInfra (DEEPINFRA_API_KEY).
import { falDisponible, falImagenes, falEditar, falEditarMulti, falChat } from './_fal.js';
import { diDisponible, diModelo, diImagenes, diEditar, diChat } from './_deepinfra.js';

export const motorActivo = env => (falDisponible(env) ? 'fal' : diDisponible(env) ? 'deepinfra' : null);

export async function motorImagenes(env, { escena, prompt, w, h, n, colorModo, seguro }) {
  if (falDisponible(env)) return { imagenes: await falImagenes(env, { escena, prompt, w, h, n, colorModo, seguro }), motor: 'fal-' + (escena || 'qwen') };
  return { imagenes: await diImagenes(env, { modelo: diModelo(env, 'qwen'), prompt, w, h, n }), motor: 'deepinfra-qwen' };
}
// Lápiz: edita UN dibujo
export async function motorEditar(env, { prompt, archivo, w, h, seguro, motorLapiz }) {
  if (falDisponible(env)) return { imagen: await falEditar(env, { prompt, archivo, seguro, motor: motorLapiz }), motor: 'fal-edit-' + (motorLapiz || 'qwen') };
  return { imagen: await diEditar(env, { prompt, archivo, w, h }), motor: 'deepinfra-edit' };
}
// Con imágenes de referencia (solo Fal). Si algo falla (que no sea saldo/configuración/contenido), se genera igual sin referencias.
export async function motorConReferencias(env, { escena, prompt, promptSinRef, archivos, w, h, n, colorModo, seguro }) {
  if (!falDisponible(env) || !archivos || !archivos.length) return motorImagenes(env, { escena, prompt: promptSinRef || prompt, w, h, n, colorModo, seguro });
  try { return { imagenes: [await falEditarMulti(env, { escena, prompt, archivos, w, h, seguro })], motor: 'fal-referencias-' + (escena || 'qwen') }; }
  catch (e) {
    if (e && (e.codigo === 'sin_saldo_ia' || e.codigo === 'config' || e.codigo === 'contenido')) throw e;
    console.warn('Con referencias falló, se genera sin ellas:', e && e.message);
    return motorImagenes(env, { escena, prompt: promptSinRef || prompt, w, h, n, colorModo, seguro });
  }
}
export async function motorChat(env, { system, mensajes, max_tokens }) {
  if (falDisponible(env)) return falChat(env, { system, mensajes });
  return diChat(env, { system, mensajes, max_tokens });
}
