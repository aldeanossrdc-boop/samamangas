// netlify/functions/paypal-webhook.js
const { out, getServiceClient, PAYPAL_BASE, getPaypalToken, CANT_SAKURAS, SAKURAS_MENSUALES_PLAN } = require('./_shared');

exports.handler = async (event) => {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  let sb;
  try { sb = getServiceClient(); } catch (e) { return out(200); }
  if (!webhookId) return out(200);

  try {
    const body = JSON.parse(event.body || '{}');
    const token = await getPaypalToken();

    const h = event.headers;
    const vr = await fetch(PAYPAL_BASE + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        auth_algo: h['paypal-auth-algo'] || h['Paypal-Auth-Algo'],
        cert_url: h['paypal-cert-url'] || h['Paypal-Cert-Url'],
        transmission_id: h['paypal-transmission-id'] || h['Paypal-Transmission-Id'],
        transmission_sig: h['paypal-transmission-sig'] || h['Paypal-Transmission-Sig'],
        transmission_time: h['paypal-transmission-time'] || h['Paypal-Transmission-Time'],
        webhook_id: webhookId,
        webhook_event: body
      })
    });
    const vj = await vr.json();
    if (!vr.ok || vj.verification_status !== 'SUCCESS') { console.warn('Firma de PayPal no verificada:', vj); return out(200); }

    const type = body.event_type;
    const res = body.resource || {};

    // ---- Orden de pago único: sakuras, donación o manga extra ----
    if (type === 'CHECKOUT.ORDER.APPROVED') {
      const pu = (res.purchase_units || [])[0] || {};
      let ref; try { ref = JSON.parse(pu.custom_id || res.custom_id); } catch (e) { return out(200); }
      if (!ref) return out(200);

      const cap = await fetch(PAYPAL_BASE + '/v2/checkout/orders/' + res.id + '/capture', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
      });
      const capj = await cap.json();
      if (!cap.ok || capj.status !== 'COMPLETED') return out(200);
      const montoUSD = pu.amount && pu.amount.value;

      if (ref.tipo === 'sakuras') {
        const cant = CANT_SAKURAS[ref.item];
        if (cant) await sb.rpc('dar_sakuras', { uid: ref.user_id, cant, origen: 'compra_pp' });

      } else if (ref.tipo === 'donacion') {
        const { data: donante } = await sb.from('profiles').select('username').eq('id', ref.user_id).maybeSingle();
        const { data: creador } = await sb.from('profiles').select('username,tier').eq('id', ref.creador).maybeSingle();

        // Comisión según plan del creador:
        // Pro = 20% para el creador / 80% CEO
        // Súper = 50% para el creador / 50% CEO
        // Gratis / Básico = 0% (no monetizan)
        let pctCreador = 0;
        if (creador && creador.tier === 'pro') pctCreador = 0.20;
        else if (creador && creador.tier === 'superpro') pctCreador = 0.50;

        const montoCreador = Math.round(Number(ref.monto_ars || 0) * pctCreador);
        await sb.from('donaciones').insert({
          donante: (donante && donante.username) || 'Usuario',
          creador: (creador && creador.username) || ref.creador,
          monto: ref.monto_ars || montoUSD,
          moneda: ref.monto_ars ? 'ARS' : 'USD',
          comision_pct: pctCreador,
          monto_creador: montoCreador
        });
        await sb.from('notificaciones').insert({ user_id: ref.creador, tipo: 'donacion', texto: '💖 Recibiste una donación por PayPal' });

      } else if (ref.tipo === 'manga_extra') {
        await sb.rpc('acreditar_manga_extra', { destino: ref.user_id });
      }
      return out(200);
    }

    // ---- Suscripción activada ----
    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      let ref; try { ref = JSON.parse(res.custom_id); } catch (e) { return out(200); }
      if (!ref || ref.tipo !== 'plan') return out(200);
      const hasta = new Date(); hasta.setMonth(hasta.getMonth() + 1);
      await sb.from('profiles').update({ tier: ref.item, tier_hasta: hasta.toISOString() }).eq('id', ref.user_id);
      await sb.rpc('dar_sakuras', { uid: ref.user_id, cant: SAKURAS_MENSUALES_PLAN, origen: 'plan_mensual' });
      return out(200);
    }

    // ---- Renovación mensual ----
    if (type === 'PAYMENT.SALE.COMPLETED' && res.billing_agreement_id) {
      const sr = await fetch(PAYPAL_BASE + '/v1/billing/subscriptions/' + res.billing_agreement_id, { headers: { Authorization: 'Bearer ' + token } });
      const sub = await sr.json();
      let ref; try { ref = JSON.parse(sub.custom_id); } catch (e) { return out(200); }
      if (!ref || ref.tipo !== 'plan') return out(200);
      const { data: perfil } = await sb.from('profiles').select('tier_hasta').eq('id', ref.user_id).maybeSingle();
      const base = (perfil && perfil.tier_hasta && new Date(perfil.tier_hasta) > new Date()) ? new Date(perfil.tier_hasta) : new Date();
      base.setMonth(base.getMonth() + 1);
      await sb.from('profiles').update({ tier: ref.item, tier_hasta: base.toISOString() }).eq('id', ref.user_id);
      await sb.rpc('dar_sakuras', { uid: ref.user_id, cant: SAKURAS_MENSUALES_PLAN, origen: 'plan_mensual' });
      return out(200);
    }

    // ---- Cancelada / expirada / falló el pago ----
    if (['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.EXPIRED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'].includes(type)) {
      let ref; try { ref = JSON.parse(res.custom_id); } catch (e) { return out(200); }
      if (!ref || ref.tipo !== 'plan') return out(200);
      await sb.from('profiles').update({ tier: 'gratis', tier_hasta: null }).eq('id', ref.user_id);
      return out(200);
    }

    return out(200);
  } catch (e) {
    console.error('paypal-webhook error:', e);
    return out(200);
  }
};
