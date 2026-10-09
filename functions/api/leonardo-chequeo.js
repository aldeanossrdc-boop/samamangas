// functions/api/leonardo-chequeo.js — chequeo AUTOMÁTICO (lo llama Supabase cada hora)
// Protegido con la clave secreta CRON_SECRET (header "x-cron-secret"). Nadie más puede usarlo.
import { out } from './_shared.js';
import { consultarSaldoLeonardo, umbralLeonardo, avisarSiBajo } from './_leonardo.js';

export async function onRequest({ request, env }) {
  const secret = env.CRON_SECRET;
  if (!secret || (request.headers.get('x-cron-secret') || '') !== secret) return out(401, { error: 'No autorizado' });
  try {
    const s = await consultarSaldoLeonardo(env);
    const umbral = umbralLeonardo(env);
    const mail = await avisarSiBajo(env, s.saldo, umbral);
    return out(200, { ok: true, saldo: s.saldo, umbral, mail });
  } catch (e) {
    console.error('leonardo-chequeo:', e.message);
    return out(500, { error: e.message });
  }
}
