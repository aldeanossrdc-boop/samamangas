// functions/api/push/suscribir.js — POST /api/push/suscribir  { subscription }
// Guarda la suscripción push del dispositivo en la tabla public.push_subscriptions (ver sql/push_subscriptions.sql).
// Se escribe COMO el usuario (su token), así la regla RLS impide guardar a nombre de otro.
import { out, verifyUser } from '../_shared.js';

const SB_URL = env => env.SUPABASE_URL || 'https://zalfaldrmccncjsahdmi.supabase.co';
const SB_ANON = env => env.SUPABASE_KEY || 'sb_publishable_ghOA30jYrCYcWrwvA1pd2g_8VsjZoVV';

export async function onRequestPost({ request, env }) {
  try {
    const user = await verifyUser(request, env);
    if (!user) return out(401, { error: 'Iniciá sesión para activar las notificaciones.' });
    const b = await request.json().catch(() => ({}));
    const s = b && b.subscription;
    const ok = s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://') && s.endpoint.length < 2000
      && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
    if (!ok) return out(400, { error: 'Suscripción push inválida.' });
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const r = await fetch(SB_URL(env) + '/rest/v1/push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      headers: { apikey: SB_ANON(env), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: String(request.headers.get('user-agent') || '').slice(0, 300) })
    });
    if (!r.ok) { console.error('push_subscriptions', r.status, (await r.text()).slice(0, 300)); return out(500, { error: 'No se pudo guardar la suscripción (¿corriste el SQL de push_subscriptions?).' }); }
    return out(200, { ok: true });
  } catch (e) {
    return out(500, { error: 'No se pudo guardar la suscripción push.' });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
