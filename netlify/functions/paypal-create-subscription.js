// netlify/functions/paypal-create-subscription.js
const { out, verifyUser, SITE_URL, PAYPAL_BASE, getPaypalToken,
        NOMBRE_PLAN, PRECIOS_PLANES_USD, precioUSD } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return out(405, { error: 'Método no permitido' });

  try {
    const user = await verifyUser(event);
    if (!user) return out(401, { error: 'Sesión inválida. Volvé a iniciar sesión.' });

    const { item } = JSON.parse(event.body || '{}');
    if (!PRECIOS_PLANES_USD[item]) return out(400, { error: 'Plan inválido' });

    const precio = await precioUSD('precio_usd_' + item, PRECIOS_PLANES_USD[item]);
    const token = await getPaypalToken();
    const authHdr = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

    const pr = await fetch(PAYPAL_BASE + '/v1/catalogs/products', {
      method: 'POST', headers: authHdr,
      body: JSON.stringify({ name: 'SalaMangaS — ' + NOMBRE_PLAN[item], type: 'SERVICE', category: 'SOFTWARE' })
    });
    const product = await pr.json();
    if (!pr.ok) return out(502, { error: product.message || 'PayPal rechazó el producto' });

    const plr = await fetch(PAYPAL_BASE + '/v1/billing/plans', {
      method: 'POST', headers: authHdr,
      body: JSON.stringify({
        product_id: product.id,
        name: NOMBRE_PLAN[item] + ' mensual',
        billing_cycles: [{
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR', sequence: 1, total_cycles: 0,
          pricing_scheme: { fixed_price: { value: precio, currency_code: 'USD' } }
        }],
        payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 }
      })
    });
    const plan = await plr.json();
    if (!plr.ok) return out(502, { error: plan.message || 'PayPal rechazó el plan' });

    const sr = await fetch(PAYPAL_BASE + '/v1/billing/subscriptions', {
      method: 'POST', headers: authHdr,
      body: JSON.stringify({
        plan_id: plan.id,
        custom_id: JSON.stringify({ user_id: user.id, tipo: 'plan', item }),
        subscriber: user.email ? { email_address: user.email } : undefined,
        application_context: { brand_name: 'SalaMangaS', return_url: SITE_URL, cancel_url: SITE_URL, user_action: 'SUBSCRIBE_NOW' }
      })
    });
    const sub = await sr.json();
    if (!sr.ok) return out(502, { error: sub.message || 'PayPal rechazó la suscripción' });
    const approve = (sub.links || []).find(l => l.rel === 'approve');
    if (!approve) return out(502, { error: 'PayPal no devolvió link de aprobación' });
    return out(200, { approve_url: approve.href });
  } catch (e) { return out(500, { error: e.message }); }
};
