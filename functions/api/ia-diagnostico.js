// functions/api/ia-diagnostico.js  ·  GET /api/ia-diagnostico   (SOLO CEO con sesión iniciada)
// Dice qué claves de IA ve el servidor y si DeepInfra acepta la clave. NUNCA muestra los valores de las claves.
import { out } from './_shared.js';
import { usuarioIA } from './_ia.js';
import { falDisponible, falChat } from './_fal.js';

export async function onRequestGet({ request, env }) {
  const ctx = await usuarioIA(request, env);
  if (!ctx || !ctx.esCeo) return out(403, { error: 'Solo el CEO' });
  const parecidas = Object.keys(env).filter(k => /fal|deep|infra|leonardo|dnfra/i.test(k));
  const r = {
    FAL_KEY: falDisponible(env),
    DEEPINFRA_API_KEY: !!env.DEEPINFRA_API_KEY,
    LEONARDO_API_KEY: !!env.LEONARDO_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!env.SUPABASE_SERVICE_ROLE_KEY,
    nombres_parecidos_que_ve_el_servidor: parecidas,
    fal_prueba: 'sin clave',
    deepinfra_prueba: 'sin clave'
  };
  if (falDisponible(env)) {
    try { await falChat(env, { system: 'Respondé solo: ok', mensajes: [{ role: 'user', content: 'ok' }] }); r.fal_prueba = 'OK: Fal acepta la clave y tiene saldo'; }
    catch (e) { r.fal_prueba = 'FALLÓ: ' + (e.message || e); }
  } else { r.ayuda_fal = 'El servidor NO ve FAL_KEY. En Cloudflare: Settings → Variables and Secrets → Production → agregar FAL_KEY y volver a publicar.'; }
  if (env.DEEPINFRA_API_KEY) {
    try {
      const x = await fetch('https://api.deepinfra.com/v1/openai/models', { headers: { Authorization: 'Bearer ' + env.DEEPINFRA_API_KEY } });
      r.deepinfra_prueba = x.ok ? 'OK: DeepInfra acepta la clave' : 'DeepInfra respondió ' + x.status + (x.status === 401 ? ' (clave inválida o con espacios de más)' : '');
    } catch (e) { r.deepinfra_prueba = 'no se pudo conectar: ' + e.message; }
  } else {
    r.deepinfra_prueba = 'no configurado (no hace falta si usás Fal)';
  }
  return out(200, r);
}
