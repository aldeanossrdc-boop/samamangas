// netlify/functions/paypal-create-order.js
const { out, verifyUser, SITE_URL, PAYPAL_BASE, getPaypalToken,
        CANT_SAKURAS, PRECIOS_SAKURAS_USD, MANGA_EXTRA_USD, precioUSD } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return out(405, { error: 'Método no permitido' });

  try {
    const user = await verifyUser(event);
    if (!user) return out(401, { error: 'Sesión inválida. Volvé a iniciar sesión.' });

    const { tipo, item, creador, manga_id } = JSON.parse(event.body || '{}');
    let descripcion, precio, customId;

    if (tipo === 'sakuras') {
      if (!CANT_SAKURAS[item]) return out(400, { error: 'Pack de sakuras inválido' });
      precio = await precioUSD('precio_usd_pack' + item, PRECIOS_SAKURAS_USD[item]);
      descripcion = 'SalaMangaS — ' + CANT_SAKURAS[item] + ' Sakuras';
      customId = JSON.stringify({ user_id: user.id, tipo, item });

    } else if (tipo === 'donacion') {
      const montoARS = Number(item);
      if (!montoARS || montoARS < 100) return out(400, { error: 'Monto inválido' });
      if (!creador) return out(400, { error: 'Falta el creador' });
      // Conversión aproximada ARS→USD (dólar ~1500 ARS a fecha de esta build).
      // El CEO puede ajustar el precio de fondo cambiando 'precio_usd_donacion_base' en config.
      const base = await precioUSD('precio_usd_donacion_base', '0.00067'); // USD por 1 ARS, aprox
      precio = (montoARS * Number(base)).toFixed(2);
      descripcion = 'SalaMangaS — Donación a creador';
      customId = JSON.stringify({ user_id: user.id, tipo, creador, manga_id: manga_id || null, monto_ars: montoARS });

    } else if (tipo === 'manga_extra') {
      precio = await precioUSD('precio_usd_manga_extra', MANGA_EXTRA_USD);
      descripcion = 'SalaMangaS — Manga extra';
      customId = JSON.stringify({ user_id: user.id, tipo });

    } else {
      return out(400, { error: 'tipo inválido' });
    }

    const token = await getPaypalToken();
    const r = await fetch(PAYPAL_BASE + '/v2/checkout/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ custom_id: customId, description: descripcion, amount: { currency_code: 'USD', value: String(precio) } }],
        application_context: { brand_name: 'SalaMangaS', return_url: SITE_URL, cancel_url: SITE_URL, user_action: 'PAY_NOW' }
      })
    });
    const j = await r.json();
    if (!r.ok) return out(502, { error: (j.message || 'PayPal rechazó la orden') });
    const approve = (j.links || []).find(l => l.rel === 'approve');
    if (!approve) return out(502, { error: 'PayPal no devolvió link de aprobación' });
    return out(200, { approve_url: approve.href });
  } catch (e) { return out(500, { error: e.message }); }
};
                
