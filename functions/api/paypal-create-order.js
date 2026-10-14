// functions/api/paypal-create-order.js
// Crea una orden de PayPal y devuelve el link de aprobación (approve_url). El cobro/entrega se completa en paypal-webhook.js.
// Cambios: ahora usa los helpers y precios de _shared.js (antes tenía copias propias: el modo sandbox/live se decidía
// al revés que en el resto de las funciones, y los precios estaban duplicados).
import { out, verifyUser, siteUrl, paypalBase, getPaypalToken,
         CANT_SAKURAS, PRECIOS_SAKURAS_USD, CANT_SAKURAS_IA, PRECIOS_SAKURAS_IA_USD, MANGA_EXTRA_USD } from './_shared.js';
import { own } from './_pagos.js';

export async function onRequestPost({ request, env }) {
  try {
    const { tipo, item, creador, manga_id } = await request.json().catch(() => ({}));

    const user = await verifyUser(request, env);
    if (!user) return out(401, { error: 'Sesión inválida. Volvé a iniciar sesión.' });

    const ARS_POR_USD = Number(env.ARS_POR_USD || 1500);
    const SITE_URL = siteUrl(env);
    let descripcion, montoUSD, customId;

    if (tipo === 'sakuras') {
      if (!own(PRECIOS_SAKURAS_USD, item)) return out(400, { error: 'Pack de sakuras inválido' });
      montoUSD = Number(PRECIOS_SAKURAS_USD[item]);
      descripcion = `SalaMangaS - ${CANT_SAKURAS[item]} Sakuras`;
      customId = JSON.stringify({ user_id: user.id, tipo: 'sakuras', item: String(item) });

    } else if (tipo === 'sakuras_ia') {
      if (!own(PRECIOS_SAKURAS_IA_USD, item)) return out(400, { error: 'Pack de Sakuras IA inválido' });
      montoUSD = Number(PRECIOS_SAKURAS_IA_USD[item]);
      descripcion = `SalaMangaS - ${CANT_SAKURAS_IA[item]} Sakuras IA`;
      customId = JSON.stringify({ user_id: user.id, tipo: 'sakuras_ia', item: String(item) });

    } else if (tipo === 'manga_extra') {
      montoUSD = Number(MANGA_EXTRA_USD);
      descripcion = 'SalaMangaS - Manga extra';
      customId = JSON.stringify({ user_id: user.id, tipo: 'manga_extra' });

    } else if (tipo === 'donacion') {
      const montoARS = Number(item);
      if (!montoARS || montoARS < 500) return out(400, { error: 'Monto de donación inválido (mínimo $500 ARS)' });
      if (!creador) return out(400, { error: 'Falta el creador de la donación' });
      montoUSD = Math.max(0.5, Number((montoARS / ARS_POR_USD).toFixed(2)));
      descripcion = 'SalaMangaS - Donación a creador';
      customId = JSON.stringify({ user_id: user.id, tipo: 'donacion', creador, manga_id: manga_id || null, monto_ars: montoARS });

    } else {
      return out(400, { error: 'Tipo de pago inválido' });
    }

    const accessToken = await getPaypalToken(env);
    const orderResponse = await fetch(`${paypalBase(env)}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: env.PAYPAL_CURRENCY || 'USD', value: montoUSD.toFixed(2) },
          description: descripcion,
          custom_id: customId
        }],
        application_context: {
          brand_name: 'SalaMangaS',
          user_action: 'PAY_NOW',
          return_url: `${SITE_URL}/?pago=ok`,
          cancel_url: `${SITE_URL}/?pago=cancel`
        }
      })
    });
    const orderData = await orderResponse.json();
    if (!orderResponse.ok) { console.error('PayPal create order falló:', JSON.stringify(orderData).slice(0, 500)); return out(500, { error: 'PayPal no pudo crear la orden' }); }

    const approveUrl = (orderData.links || []).find(l => l.rel === 'approve')?.href;
    if (!approveUrl) return out(500, { error: 'PayPal no devolvió link de aprobación' });
    return out(200, { order_id: orderData.id, approve_url: approveUrl, monto_usd: montoUSD });
  } catch (error) {
    console.error('PayPal create order error:', error.message);
    return out(500, { error: 'Error interno al crear la orden de PayPal' });
  }
}
