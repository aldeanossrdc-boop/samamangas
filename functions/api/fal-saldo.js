// functions/api/fal-saldo.js  ·  POST o GET /api/fal-saldo   (SOLO CEO con sesión iniciada)
// Devuelve el saldo de la cuenta de Fal.ai para el contador del panel.
import { out } from './_shared.js';
import { usuarioIA } from './_ia.js';
import { falSaldo } from './_fal.js';

async function responder({ request, env }) {
  const ctx = await usuarioIA(request, env);
  if (!ctx || !ctx.esCeo) return out(403, { error: 'Solo el CEO' });
  const r = await falSaldo(env);
  return out(200, r);
}
export const onRequestGet = responder;
export const onRequestPost = responder;
