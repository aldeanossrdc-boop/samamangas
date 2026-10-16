// functions/api/_motor.js — elige el proveedor de IA: Fal.ai (si existe FAL_KEY) y, si no, DeepInfra (DEEPINFRA_API_KEY).
import { falDisponible, falImagenes, falEditar, falChat } from './_fal.js';
import { diDisponible, diModelo, diImagenes, diEditar, diChat } from './_deepinfra.js';

export const motorActivo = env => (falDisponible(env) ? 'fal' : diDisponible(env) ? 'deepinfra' : null);

export async function motorImagenes(env, { escena, prompt, w, h, n, colorModo, seguro }) {
  if (falDisponible(env)) return { imagenes: await falImagenes(env, { prompt, w, h, n, colorModo, seguro }), motor: 'fal-qwen' };
  return { imagenes: await diImagenes(env, { modelo: diModelo(env, escena), prompt, w, h, n }), motor: 'deepinfra-' + escena };
}
export async function motorEditar(env, { prompt, archivo, w, h, seguro }) {
  if (falDisponible(env)) return { imagen: await falEditar(env, { prompt, archivo, seguro }), motor: 'fal-edit' };
  return { imagen: await diEditar(env, { prompt, archivo, w, h }), motor: 'deepinfra-edit' };
}
export async function motorChat(env, { system, mensajes, max_tokens }) {
  if (falDisponible(env)) return falChat(env, { system, mensajes });
  return diChat(env, { system, mensajes, max_tokens });
}
