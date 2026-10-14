// functions/api/paypal-webhook.js
// Cambios: cada orden se acredita UNA vez (pagos_procesados); la activación + primer cobro ya no suman 2 meses;
// si la captura ya estaba hecha (reintento) igual se acredita; se revisan los errores de la base y se responde 500
// para que PayPal reintente si algo falla; si falta PAYPAL_WEBHOOK_ID ahora queda registrado en el log.
import { out, getServiceClient, paypalBase, getPaypalToken, CANT_SAKURAS, CANT_SAKURAS_IA } from './_shared.js';
import { own, chk, reclamar, liberar, otorgarPlan, detallePago } from './_pagos.js';
import { notificarPago } from './_notificar-pago.js';

export async function onRequestPost({ request, env }) {
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  let sb;
  try { sb = getServiceClient(env); } catch (e) { console.error('pp-webhook:', e.message); return out(200); }
  if (!webhookId) { console.error('pp-webhook: falta PAYPAL_WEBHOOK_ID: los pagos de PayPal NO se acreditan'); return out(200); }

  try {
    const body = await request.json().catch(() => ({}));
    const token = await getPaypalToken(env);
    const base = paypalBase(env);

    const vr = await fetch(base + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        auth_algo: request.headers.get('paypal-auth-algo'),
        cert_url: request.headers.get('paypal-cert-url'),
        transmission_id: request.headers.get('paypal-transmission-id'),
        transmission_sig: request.headers.get('paypal-transmission-sig'),
        transmission_time: request.headers.get('paypal-transmission-time'),
        webhook_id: webhookId,
        webhook_event: body
      })
    });
    const vj = await vr.json();
    if (!vr.ok || vj.verification_status !== 'SUCCESS') { console.warn('Firma de PayPal no verificada (¿PAYPAL_MODE o PAYPAL_WEBHOOK_ID mal?):', JSON.stringify(vj)); return out(200); }

    const type = body.event_type;
    const res = body.resource || {};

    // ---- Orden de pago único: sakuras, donación o manga extra ----
    if (type === 'CHECKOUT.ORDER.APPROVED') {
      const pu = (res.purchase_units || [])[0] || {};
      let ref; try { ref = JSON.parse(pu.custom_id || res.custom_id); } catch (e) { return out(200); }
      if (!ref || !ref.user_id) return out(200);

      const clave = 'pp:order:' + res.id;
      if (!(await reclamar(sb, clave))) return out(200);   // ya acreditada
      try {
        const cap = await fetch(base + '/v2/checkout/orders/' + encodeURIComponent(res.id) + '/capture', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
        });
        const capj = await cap.json().catch(() => ({}));
        const yaCapturada = !cap.ok && JSON.stringify(capj).includes('ORDER_ALREADY_CAPTURED');
        if (!yaCapturada && (!cap.ok || capj.status !== 'COMPLETED')) {
          console.error('PayPal capture no completó:', cap.status, JSON.stringify(capj).slice(0, 400));
          await liberar(sb, clave);
          return out(cap.status >= 500 ? 500 : 200);
        }
        const montoUSD = pu.amount && pu.amount.value;

        if (ref.tipo === 'sakuras') {
          if (!own(CANT_SAKURAS, ref.item)) throw new Error('pack inválido: ' + ref.item);
          chk(await sb.rpc('dar_sakuras', { uid: ref.user_id, cant: CANT_SAKURAS[ref.item], origen: 'compra_pp' }), 'dar_sakuras');

        } else if (ref.tipo === 'sakuras_ia') {
          if (!own(CANT_SAKURAS_IA, ref.item)) throw new Error('pack IA inválido: ' + ref.item);
          chk(await sb.rpc('dar_sakuras_ia', { uid: ref.user_id, cant: CANT_SAKURAS_IA[ref.item], origen: 'compra_pp' }), 'dar_sakuras_ia');

        } else if (ref.tipo === 'donacion') {
          const { data: donante } = await sb.from('profiles').select('username').eq('id', ref.user_id).maybeSingle();
          const { data: creador } = await sb.from('profiles').select('username,tier').eq('id', ref.creador).maybeSingle();
          // Reparto: Pro = 20% creador · Súper Pro = 50% · el resto 0% (ver nota: Mercado Pago usa otro reparto)
          let pctCreador = 0;
          if (creador && creador.tier === 'pro') pctCreador = 0.20;
          else if (creador && creador.tier === 'superpro') pctCreador = 0.50;
          const montoCreador = Math.round(Number(ref.monto_ars || 0) * pctCreador);
          chk(await sb.from('donaciones').insert({
            donante: (donante && donante.username) || 'Usuario',
            creador: (creador && creador.username) || ref.creador,
            monto: ref.monto_ars || montoUSD, moneda: ref.monto_ars ? 'ARS' : 'USD',
            comision_pct: pctCreador, monto_creador: montoCreador
          }), 'insert donaciones');
          await sb.from('notificaciones').insert({ user_id: ref.creador, tipo: 'donacion', texto: '💖 Recibiste una donación por PayPal' });

        } else if (ref.tipo === 'manga_extra') {
          chk(await sb.rpc('acreditar_manga_extra', { destino: ref.user_id }), 'acreditar_manga_extra');
        }
        await notificarPago({ userId: ref.user_id, tipo: ref.tipo, monto: montoUSD, moneda: 'USD', detalle: detallePago(ref), provider: 'PayPal', env });
      } catch (e) { await liberar(sb, clave); throw e; }
      return out(200);
    }

    // ---- Suscripción activada (primer mes) ----
    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      let ref; try { ref = JSON.parse(res.custom_id); } catch (e) { return out(200); }
      if (!ref || ref.tipo !== 'plan') return out(200);
      if (await otorgarPlan(sb, ref)) await notificarPago({ userId: ref.user_id, tipo: 'plan', monto: '', moneda: 'USD', detalle: detallePago(ref), provider: 'PayPal', env });
      return out(200);
    }

    // ---- Cobro mensual (el primero llega junto con la activación: otorgarPlan no lo suma dos veces) ----
    if (type === 'PAYMENT.SALE.COMPLETED' && res.billing_agreement_id) {
      const sr = await fetch(base + '/v1/billing/subscriptions/' + encodeURIComponent(res.billing_agreement_id), { headers: { Authorization: 'Bearer ' + token } });
      const sub = await sr.json();
      let ref; try { ref = JSON.parse(sub.custom_id); } catch (e) { return out(200); }
      if (!ref || ref.tipo !== 'plan') return out(200);
      if (await otorgarPlan(sb, ref)) await notificarPago({ userId: ref.user_id, tipo: 'plan', monto: (res.amount && res.amount.total) || '', moneda: 'USD', detalle: detallePago(ref), provider: 'PayPal', env });
      return out(200);
    }

    // ---- Cancelada / expirada / falló el pago ----
    if (['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.EXPIRED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'].includes(type)) {
      let ref; try { ref = JSON.parse(res.custom_id); } catch (e) { return out(200); }
      if (!ref || ref.tipo !== 'plan') return out(200);
      chk(await sb.from('profiles').update({ tier: 'gratis', tier_hasta: null }).eq('id', ref.user_id), 'bajar plan');
      return out(200);
    }

    return out(200);
  } catch (e) {
    console.error('paypal-webhook error:', e.message);
    return out(500);   // que PayPal reintente
  }
}
