// functions/api/mercadopago-webhook.js
// El aviso solo trae un id: el pago real se vuelve a pedir a Mercado Pago con tu token (no se puede falsificar).
// Cambios: cada pago se acredita UNA vez (pagos_procesados), el plan no se suma doble, se revisan los errores
// de la base y, si algo falla, se responde 500 para que Mercado Pago reintente (antes el pago se perdía en silencio).
import { out, getServiceClient, CANT_SAKURAS, CANT_SAKURAS_IA } from './_shared.js';
import { own, chk, reclamar, liberar, otorgarPlan, detallePago } from './_pagos.js';
import { notificarPago } from './_notificar-pago.js';

export async function onRequestPost({ request, env }) {
  const token = env.MP_ACCESS_TOKEN;
  let sb;
  try { sb = getServiceClient(env); } catch (e) { console.error('mp-webhook:', e.message); return out(200); }
  if (!token) { console.error('mp-webhook: falta MP_ACCESS_TOKEN'); return out(200); }

  try {
    const url = new URL(request.url);
    const q = Object.fromEntries(url.searchParams);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const topic = q.type || q.topic || body.type || body.topic;
    const id = (q['data.id']) || (body.data && body.data.id) || q.id || body.id;
    if (!id) return out(200);

    if (topic === 'payment') {
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token } });
      const pago = await r.json();
      if (!r.ok || pago.status !== 'approved') return out(200);
      let ref; try { ref = JSON.parse(pago.external_reference); } catch (e) { return out(200); }
      if (!ref || !ref.user_id) return out(200);
      const aviso = () => notificarPago({ userId: ref.user_id, tipo: ref.tipo, monto: pago.transaction_amount, moneda: 'ARS', detalle: detallePago(ref), provider: 'Mercado Pago', env });

      // Plan (cobro mensual de la suscripción): un mes por usuario+plan+mes
      if (ref.tipo === 'plan') {
        if (await otorgarPlan(sb, ref)) await aviso();
        return out(200);
      }

      const clave = 'mp:payment:' + String(pago.id || id);
      if (!(await reclamar(sb, clave))) return out(200);   // ya acreditado antes
      try {
        if (ref.tipo === 'sakuras') {
          if (!own(CANT_SAKURAS, ref.item)) throw new Error('pack inválido: ' + ref.item);
          chk(await sb.rpc('dar_sakuras', { uid: ref.user_id, cant: CANT_SAKURAS[ref.item], origen: 'compra_mp' }), 'dar_sakuras');

        } else if (ref.tipo === 'sakuras_ia') {
          if (!own(CANT_SAKURAS_IA, ref.item)) throw new Error('pack IA inválido: ' + ref.item);
          chk(await sb.rpc('dar_sakuras_ia', { uid: ref.user_id, cant: CANT_SAKURAS_IA[ref.item], origen: 'compra_mp' }), 'dar_sakuras_ia');

        } else if (ref.tipo === 'donacion') {
          const { data: donante } = await sb.from('profiles').select('username').eq('id', ref.user_id).maybeSingle();
          const { data: creador } = await sb.from('profiles').select('username,tier').eq('id', ref.creador).maybeSingle();
          const pctComision = creador && (creador.tier === 'pro' || creador.tier === 'superpro') ? 0.5 : 0.2;   // (ver nota: PayPal usa otro reparto)
          const montoCreador = Math.round(Number(pago.transaction_amount || 0) * pctComision);
          chk(await sb.from('donaciones').insert({
            donante: (donante && donante.username) || 'Usuario', creador: (creador && creador.username) || ref.creador,
            monto: pago.transaction_amount, moneda: 'ARS', comision_pct: pctComision, monto_creador: montoCreador
          }), 'insert donaciones');
          await sb.from('notificaciones').insert({ user_id: ref.creador, tipo: 'donacion', texto: '💖 Recibiste una donación de $' + pago.transaction_amount + ' ARS' });

        } else if (ref.tipo === 'manga_extra') {
          chk(await sb.rpc('acreditar_manga_extra', { destino: ref.user_id }), 'acreditar_manga_extra');
        } else { return out(200); }
      } catch (e) { await liberar(sb, clave); throw e; }
      await aviso();
      return out(200);
    }

    if (topic === 'preapproval' || topic === 'subscription_preapproval') {
      const r = await fetch('https://api.mercadopago.com/preapproval/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token } });
      const sub = await r.json();
      if (!r.ok) return out(200);
      let ref; try { ref = JSON.parse(sub.external_reference); } catch (e) { return out(200); }
      if (!ref || !ref.user_id || ref.tipo !== 'plan') return out(200);

      if (sub.status === 'authorized') {
        if (await otorgarPlan(sb, ref)) await notificarPago({ userId: ref.user_id, tipo: 'plan', monto: (sub.auto_recurring && sub.auto_recurring.transaction_amount) || '', moneda: 'ARS', detalle: detallePago(ref), provider: 'Mercado Pago', env });
      } else if (sub.status === 'cancelled' || sub.status === 'paused') {
        chk(await sb.from('profiles').update({ tier: 'gratis', tier_hasta: null }).eq('id', ref.user_id), 'bajar plan');
      }
      return out(200);
    }

    return out(200);
  } catch (e) {
    console.error('mercadopago-webhook error:', e.message);
    return out(500);   // que Mercado Pago reintente
  }
}
