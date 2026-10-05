// functions/api/mercadopago-webhook.js
import { out, getServiceClient, CANT_SAKURAS, SAKURAS_MENSUALES_PLAN } from './_shared.js';

export async function onRequestPost({ request, env }) {
  const token = env.MP_ACCESS_TOKEN;
  let sb;
  try { sb = getServiceClient(env); } catch (e) { return out(200); }
  if (!token) return out(200);

  try {
    const url = new URL(request.url);
    const q = Object.fromEntries(url.searchParams);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const topic = q.type || q.topic || body.type || body.topic;
    const id = (q['data.id']) || (body.data && body.data.id) || q.id || body.id;
    if (!id) return out(200);

    if (topic === 'payment') {
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + id, { headers: { Authorization: 'Bearer ' + token } });
      const pago = await r.json();
      if (!r.ok || pago.status !== 'approved') return out(200);
      let ref; try { ref = JSON.parse(pago.external_reference); } catch (e) { return out(200); }
      if (!ref || !ref.user_id) return out(200);

      if (ref.tipo === 'sakuras') {
        const cant = CANT_SAKURAS[ref.item];
        if (cant) await sb.rpc('dar_sakuras', { uid: ref.user_id, cant, origen: 'compra_mp' });

      } else if (ref.tipo === 'plan') {
        const { data: perfil } = await sb.from('profiles').select('tier_hasta').eq('id', ref.user_id).maybeSingle();
        const base = (perfil && perfil.tier_hasta && new Date(perfil.tier_hasta) > new Date()) ? new Date(perfil.tier_hasta) : new Date();
        base.setMonth(base.getMonth() + 1);
        await sb.from('profiles').update({ tier: ref.item, tier_hasta: base.toISOString() }).eq('id', ref.user_id);
        await sb.rpc('dar_sakuras', { uid: ref.user_id, cant: SAKURAS_MENSUALES_PLAN, origen: 'plan_mensual' });

      } else if (ref.tipo === 'donacion') {
        const { data: donante } = await sb.from('profiles').select('username').eq('id', ref.user_id).maybeSingle();
        const { data: creador } = await sb.from('profiles').select('username,tier').eq('id', ref.creador).maybeSingle();
        const pctComision = creador && (creador.tier === 'pro' || creador.tier === 'superpro') ? 0.5 : 0.2;
        const montoCreador = Math.round(Number(pago.transaction_amount || 0) * pctComision);
        await sb.from('donaciones').insert({
          donante: (donante && donante.username) || 'Usuario', creador: (creador && creador.username) || ref.creador,
          monto: pago.transaction_amount, moneda: 'ARS', comision_pct: pctComision, monto_creador: montoCreador
        });
        await sb.from('notificaciones').insert({ user_id: ref.creador, tipo: 'donacion', texto: '💖 Recibiste una donación de $' + pago.transaction_amount + ' ARS' });

      } else if (ref.tipo === 'manga_extra') {
        await sb.rpc('acreditar_manga_extra', { destino: ref.user_id });
      }
      return out(200);
    }

    if (topic === 'preapproval' || topic === 'subscription_preapproval') {
      const r = await fetch('https://api.mercadopago.com/preapproval/' + id, { headers: { Authorization: 'Bearer ' + token } });
      const sub = await r.json();
      if (!r.ok) return out(200);
      let ref; try { ref = JSON.parse(sub.external_reference); } catch (e) { return out(200); }
      if (!ref || !ref.user_id || ref.tipo !== 'plan') return out(200);

      if (sub.status === 'authorized') {
        const hasta = new Date(); hasta.setMonth(hasta.getMonth() + 1);
        await sb.from('profiles').update({ tier: ref.item, tier_hasta: hasta.toISOString() }).eq('id', ref.user_id);
        await sb.rpc('dar_sakuras', { uid: ref.user_id, cant: SAKURAS_MENSUALES_PLAN, origen: 'plan_mensual' });
      } else if (sub.status === 'cancelled' || sub.status === 'paused') {
        await sb.from('profiles').update({ tier: 'gratis', tier_hasta: null }).eq('id', ref.user_id);
      }
      return out(200);
    }

    return out(200);
  } catch (e) {
    console.error('mercadopago-webhook error:', e);
    return out(200);
  }
}
