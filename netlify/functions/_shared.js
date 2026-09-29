// _shared.js — helpers comunes para las funciones de netlify/functions.
// No es un endpoint público: no exporta "handler", así que Netlify no lo
// expone como función, pero sí lo empaqueta cuando otro archivo hace
// require('./_shared').

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zalfaldrmccncjsahdmi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY || 'sb_publishable_ghOA30jYrCYcWrwvA1pd2g_8VsjZoVV';
const SITE_URL = (process.env.SITE_URL || 'https://salamangas.netlify.app').replace(/\/$/, '');

function out(c, o) {
  return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o || {}) };
}

// Verifica el token de sesión de Supabase que manda el navegador
// (Authorization: Bearer ...). Nunca confiar en un user_id que venga
// suelto en el body: siempre hay que sacarlo de acá.
async function verifyUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) return null;
  return r.json();
}

// Cliente de Supabase con la service_role key: salta RLS. Solo se usa en
// los webhooks (nunca en funciones que reciben pedidos directos del navegador).
function getServiceClient() {
  const { createClient } = require('@supabase/supabase-js');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en Netlify');
  return createClient(SUPABASE_URL, key);
}

// Lee un precio en USD desde la tabla "config" (por si el CEO lo ajustó
// a mano por el dólar del día); si no existe, usa el default.
async function precioUSD(clave, def) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/config?clave=eq.' + encodeURIComponent(clave), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    });
    const j = await r.json();
    if (Array.isArray(j) && j[0] && j[0].valor) return j[0].valor;
  } catch (e) {}
  return def;
}

// ---------------- Precios (Tanda D) ----------------
const NOMBRE_PLAN = { basico: 'Mangakar', pro: 'Mangakar Pro', superpro: 'Súper Mangakar' };
const PRECIOS_PLANES_ARS = { basico: 3000, pro: 5000, superpro: 12000 };
const PRECIOS_PLANES_USD = { basico: '3.00', pro: '5.00', superpro: '12.00' };

const CANT_SAKURAS = { '250': 250, '700': 700, '1500': 1500, '3000': 3000 };
const PRECIOS_SAKURAS_ARS = { '250': 1000, '700': 2000, '1500': 3000, '3000': 5000 };
const PRECIOS_SAKURAS_USD = { '250': '1.00', '700': '2.00', '1500': '2.50', '3000': '5.00' };

const MANGA_EXTRA_ARS = 10000;
const MANGA_EXTRA_USD = '10.00';

const SAKURAS_MENSUALES_PLAN = 200; // se acredita en cada pago/renovación de un plan pago

// ---------------- PayPal ----------------
const PAYPAL_BASE = (process.env.PAYPAL_MODE === 'sandbox')
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

async function getPaypalToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error('Faltan PAYPAL_CLIENT_ID / PAYPAL_SECRET en Netlify');
  const r = await fetch(PAYPAL_BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'No se pudo autenticar con PayPal');
  return j.access_token;
}

module.exports = {
  SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL,
  out, verifyUser, getServiceClient, precioUSD,
  NOMBRE_PLAN, PRECIOS_PLANES_ARS, PRECIOS_PLANES_USD,
  CANT_SAKURAS, PRECIOS_SAKURAS_ARS, PRECIOS_SAKURAS_USD,
  MANGA_EXTRA_ARS, MANGA_EXTRA_USD, SAKURAS_MENSUALES_PLAN,
  PAYPAL_BASE, getPaypalToken
};
