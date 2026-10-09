// functions/api/paypal-create-subscription.js
import { out, verifyUser, siteUrl, paypalBase, getPaypalToken,
         NOMBRE_PLAN, PRECIOS_PLANES_USD, precioUSD } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await verifyUser(request, env);
    if (!user) return out(401, { error: 'Sesión inválida. Volvé a iniciar sesión.' });

    const { item } = await request.json().catch(() => ({}));
    if (!PRECIOS_PLANES_USD[item]) return out(400, { error: 'Plan inválido' });

    const precio = await precioUSD(env, 'precio_usd_' + item, PRECIOS_PLANES_USD[item]);
    const token = await getPaypalToken(env);
    const authHdr = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    const base = paypalBase(env);

    const pr = await fetch(base + '/v1/catalogs/products', {
      method: 'POST', headers: authHdr,
      body: JSON.stringify({ name: 'SalaMangaS — ' + NOMBRE_PLAN[item], type: 'SERVICE', category: 'SOFTWARE' })
    });
    const product = await pr.json();
    if (!pr.ok) return out(502, { error: product.message || 'PayPal rechazó el producto' });

    const plr = await fetch(base + '/v1/billing/plans', {
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

    const sr = await fetch(base + '/v1/billing/subscriptions', {
      method: 'POST', headers: authHdr,
      body: JSON.stringify({
        plan_id: plan.id,
        custom_id: JSON.stringify({ user_id: user.id, tipo: 'plan', item }),
        subscriber: user.email ? { email_address: user.email } : undefined,
        application_context: { brand_name: 'SalaMangaS', return_url: siteUrl(env), cancel_url: siteUrl(env), user_action: 'SUBSCRIBE_NOW' }
      })
    });
    const sub = await sr.json();
    if (!sr.ok) return out(502, { error: sub.message || 'PayPal rechazó la suscripción' });
    const approve = (sub.links || []).find(l => l.rel === 'approve');
    if (!approve) return out(502, { error: 'PayPal no devolvió link de aprobación' });
    return out(200, { approve_url: approve.href });
  } catch (e) { return out(500, { error: e.message }); }
}
