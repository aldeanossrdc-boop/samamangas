// functions/api/_leonardo.js — helper compartido (el "_" lo hace NO público)
// Consulta el saldo de Leonardo AI y manda el mail de aviso cuando baja del umbral.
import { getServiceClient } from './_shared.js';

export const CEO_EMAILS = ['aldeanossrdc@gmail.com', 'srdcceo1992@gmail.com', 'salamangas.oficial.92@gmail.com'];
const MAIL_CEO_DEFAULT = 'aldeanossrdc@gmail.com';

// Saldo de la API de Leonardo (créditos). Leonardo devuelve créditos, no dólares.
export async function consultarSaldoLeonardo(env) {
  const key = env.LEONARDO_API_KEY;
  if (!key) throw new Error('Falta cargar LEONARDO_API_KEY en Cloudflare');
  const r = await fetch('https://cloud.leonardo.ai/api/rest/v1/me', {
    headers: { Authorization: 'Bearer ' + key, accept: 'application/json' }
  });
  if (!r.ok) throw new Error('Leonardo respondió ' + r.status);
  const j = await r.json();
  const d = (j.user_details && j.user_details[0]) || {};
  // Si Leonardo cambió el formato y no vienen estos campos, NO inventamos un 0 (daría una falsa alarma)
  if (d.apiPaidTokens === undefined && d.apiSubscriptionTokens === undefined) {
    throw new Error('Leonardo no devolvió el saldo en el formato esperado');
  }
  const paid = Number(d.apiPaidTokens) || 0;
  const sub = Number(d.apiSubscriptionTokens) || 0;
  // Datos numéricos tal cual los manda Leonardo (para que veas en qué unidad viene el saldo)
  const detalle = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === 'number') detalle[k] = v;
  return { saldo: paid + sub, paid, sub, renovacion: d.apiPlanTokenRenewalDate || null, detalle };
}

// Umbral de alerta, en la MISMA unidad que muestra el panel. Se define con la variable
// LEONARDO_UMBRAL en Cloudflare. Sin esa variable NO hay aviso por mail (así no te llega
// una falsa alarma si la unidad del saldo no es la que pensabas).
export function umbralLeonardo(env) {
  const n = Number(env.LEONARDO_UMBRAL);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Si el saldo está bajo, manda UN mail (máximo 1 cada 24 horas).
// Devuelve: 'sin_umbral' | 'no_bajo' | 'enviado' | 'ya_avisado' | 'sin_mail_configurado' | 'falta_tabla' | 'error_mail'
export async function avisarSiBajo(env, saldo, umbral) {
  if (!umbral) return 'sin_umbral';
  if (saldo > umbral) return 'no_bajo';
  if (!env.RESEND_API_KEY) return 'sin_mail_configurado';

  let sb;
  try { sb = getServiceClient(env); } catch (e) { return 'falta_tabla'; }

  // Anti-spam: si ya avisamos en las últimas 24 h, no mandamos otro.
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recientes, error: e1 } = await sb.from('avisos_leonardo').select('id').gte('enviado_en', desde).limit(1);
  if (e1) return 'falta_tabla';            // no existe la tabla: mejor no mandar nada que mandar repetido
  if (recientes && recientes.length) return 'ya_avisado';

  // Se anota ANTES de mandar (así dos chequeos a la vez no duplican el mail)
  const { data: fila, error: e2 } = await sb.from('avisos_leonardo').insert({ saldo, umbral }).select('id').single();
  if (e2) return 'falta_tabla';

  const usdPorCred = Number(env.LEONARDO_USD_POR_CREDITO);
  const cred = Number(saldo).toLocaleString('es-AR');
  const quedan = usdPorCred > 0
    ? '$' + (saldo * usdPorCred).toFixed(2) + ' USD (' + cred + ' créditos)'
    : cred + ' créditos';
  const texto = '⚠️ Saldo de Leonardo bajo: quedan ' + quedan + '. Cargá más antes de que se corte la IA.';

  let ok = false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'SalaMangaS <onboarding@resend.dev>',
        to: [env.MAIL_CEO || MAIL_CEO_DEFAULT],
        subject: '⚠️ Saldo de Leonardo bajo (' + cred + ' créditos)',
        text: texto,
        html: '<div style="font-family:Arial,sans-serif;font-size:16px"><p><b>' + texto + '</b></p>' +
              '<p style="color:#666;font-size:13px">Alerta configurada en ' + Number(umbral).toLocaleString('es-AR') +
              ' créditos. Si no cargás saldo, te vuelvo a avisar en 24 horas.</p></div>'
      })
    });
    ok = r.ok;
    if (!ok) console.error('Resend rechazó el mail:', r.status, await r.text().catch(() => ''));
  } catch (e) { console.error('Error mandando mail:', e.message); }

  if (!ok) {                                // si no salió, se borra la marca para reintentar en el próximo chequeo
    await sb.from('avisos_leonardo').delete().eq('id', fila.id);
    return 'error_mail';
  }
  return 'enviado';
}
