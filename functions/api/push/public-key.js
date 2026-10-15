// functions/api/push/public-key.js — GET /api/push/public-key
// Devuelve la clave pública VAPID (la variable VAPID_PUBLIC_KEY de Cloudflare). La clave pública NO es secreta.
import { out } from '../_shared.js';

export async function onRequestGet({ env }) {
  if (!env.VAPID_PUBLIC_KEY) return out(503, { error: 'Falta VAPID_PUBLIC_KEY en Cloudflare.' });
  return new Response(JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
