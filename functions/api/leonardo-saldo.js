// functions/api/leonardo-saldo.js — POST /api/leonardo-saldo
// Lo usa el panel CEO: devuelve el saldo de Leonardo y, si está bajo, manda el mail de aviso.
// Variable secreta en Cloudflare: LEONARDO_API_KEY (y opcionales, ver instrucciones).
import { out, verifyUser } from './_shared.js';
import { CEO_EMAILS, consultarSaldoLeonardo, umbralLeonardo, avisarSiBajo } from './_leonardo.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await verifyUser(request, env);
    if (!user) return out(401, { error: 'Sesión inválida' });
    const email = String(user.email || '').trim().toLowerCase();
    if (!(user.email_confirmed_at || user.confirmed_at) || !CEO_EMAILS.includes(email)) {
      return out(403, { error: 'Solo el CEO puede ver esto' });
    }
    const s = await consultarSaldoLeonardo(env);
    const umbral = umbralLeonardo(env);
    const mail = await avisarSiBajo(env, s.saldo, umbral);
    return out(200, { ok: true, ...s, umbral, mail });
  } catch (e) {
    return out(500, { error: e.message || 'Error consultando Leonardo' });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
