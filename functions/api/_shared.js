//v2
// functions/api/_shared.js — helpers comunes (Cloudflare Pages Functions)
// Archivo con "_" al inicio: Cloudflare NO lo expone como ruta pública,
// pero sí lo pueden importar los demás archivos de /functions/api con
// import ... from './_shared.js'.

import { createClient } from '@supabase/supabase-js';

export function out(c, o) {
  return new Response(JSON.stringify(o || {}), {
    status: c,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Verifica el token de sesión de Supabase que manda el navegador
// (Authorization: Bearer ...). Nunca confiar en un user_id que venga
// suelto en el body: siempre hay que sacarlo de acá.
export async function verifyUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const SUPABASE_URL = env.SUPABASE_URL || 'https://zalfaldrmccncjsahdmi.supabase.co';
  const SUPABASE_ANON_KEY = env.SUPABASE_KEY || 'sb_publishable_ghOA30jYrCYcWrwvA1pd2g_8VsjZoVV';
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) return null;
  return r.json();
}

// Cliente de Supabase con la service_role key: salta RLS. Solo se usa en
// los webhooks (nunca en funciones que reciben pedidos directos del navegador).
export function getServiceClient(env) {
  const SUPABASE_URL = env.SUPABASE_URL || 'https://zalfaldrmccncjsahdmi.supabase.co';
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en Cloudflare');
  return createClient(SUPABASE_URL, key);
}

// Lee un precio en USD desde la tabla "config" (por si el CEO lo ajustó
// a mano por el dólar del día); si no existe, usa el default.
export async function precioUSD(env, clave, def) {
  const SUPABASE_URL = env.SUPABASE_URL || 'https://zalfaldrmccncjsahdmi.supabase.co';
  const SUPABASE_ANON_KEY = env.SUPABASE_KEY || 'sb_publishable_ghOA30jYrCYcWrwvA1pd2g_8VsjZoVV';
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/config?clave=eq.' + encodeURIComponent(clave), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    });
    const j = await r.json();
    if (Array.isArray(j) && j[0] && j[0].valor) return j[0].valor;
  } catch (e) {}
  return def;
}

// URL del sitio (para back_urls / return_url de MP y PayPal).
export function siteUrl(env) {
  return (env.PUBLIC_SITE_URL || env.SITE_URL || 'https://salamangakers.pages.dev').replace(/\/$/, '');
}

// ---------------- Precios (definitivos 04/10/2026) ----------------
export const NOMBRE_PLAN = {
  pro: 'Mangakars Pro',
  superpro: 'Súper Mangakars Pro',
  semidios: 'Semi Dios Mangakars',
  dios: 'Mangakars Dios'
};
export const PRECIOS_PLANES_ARS = {
  pro: 3000,
  superpro: 5000,
  semidios: 12000,
  dios: 30000
};
export const PRECIOS_PLANES_USD = {
  pro: '3.00',
  superpro: '5.00',
  semidios: '12.00',
  dios: '30.00'
};

export const CANT_SAKURAS = { '250': 250, '700': 700, '1500': 1500, '3000': 3000 };
export const PRECIOS_SAKURAS_ARS = { '250': 1000, '700': 2000, '1500': 3000, '3000': 5000 };
export const PRECIOS_SAKURAS_USD = { '250': '1.00', '700': '2.00', '1500': '3.00', '3000': '5.00' };

// Sakuras IA (segunda moneda: solo para generar con IA). Se acumulan y no vencen.
export const CANT_SAKURAS_IA = { '5': 5, '15': 15, '30': 30, '80': 80 };
export const PRECIOS_SAKURAS_IA_ARS = { '5': 1000, '15': 2000, '30': 3000, '80': 5000 };
export const PRECIOS_SAKURAS_IA_USD = { '5': '1.00', '15': '2.00', '30': '3.00', '80': '5.00' };

export const MANGA_EXTRA_ARS = 10000;
export const MANGA_EXTRA_USD = '10.00';

export const SAKURAS_MENSUALES_PLAN = 200; // se acredita en cada pago/renovación de un plan pago

// ---------------- PayPal ----------------
export function paypalBase(env) {
  return (env.PAYPAL_MODE === 'sandbox')
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

export async function getPaypalToken(env) {
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error('Faltan PAYPAL_CLIENT_ID / PAYPAL_SECRET en Cloudflare');
  // Nota: en Cloudflare Workers no existe Buffer, se usa btoa() para base64.
  const r = await fetch(paypalBase(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(id + ':' + secret)
    },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'No se pudo autenticar con PayPal');
  return j.access_token;
}
