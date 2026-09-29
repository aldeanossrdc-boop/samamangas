// netlify/functions/mercadopago-create-preference.js
const { out, verifyUser, SITE_URL, NOMBRE_PLAN, PRECIOS_PLANES_ARS,
        CANT_SAKURAS, PRECIOS_SAKURAS_ARS, MANGA_EXTRA_ARS } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return out(405, { error: 'Método no permitido' });
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return out(500, { error: 'Falta MP_ACCESS_TOKEN en Netlify' });

  try {
    const user = await verifyUser(event);
    if (!user) return out(401, { error: 'Sesión inválida. Volvé a iniciar sesión.' });

    const { tipo, item, creador, manga_id } = JSON.parse(event.body || '{}');

    if (tipo === 'sakuras') {
      const precio = PRECIOS_SAKURAS_ARS[item];
      if (!precio) return out(400, { error: 'Pack de sakuras inválido' });
      const j = await crearPreferencia(token, 'SalaMangaS — ' + CANT_SAKURAS[item] + ' Sakuras', precio,
        JSON.stringify({ user_id: user.id, tipo, item }));
      return out(200, { init_point: j.init_point || j.sandbox_init_point });
    }

    if (tipo === 'plan') {
      const precio = PRECIOS_PLANES_ARS[item];
      if (!precio) return out(400, { error: 'Plan inválido' });
      const r = await fetch('https://api.mercadopago.com/preapproval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          reason: 'SalaMangaS — ' + NOMBRE_PLAN[item],
          external_reference: JSON.stringify({ user_id: user.id, tipo, item }),
          payer_email: user.email,
          back_url: SITE_URL,
          auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: precio, currency_id: 'ARS' },
          status: 'pending'
        })
      });
      const j = await r.json();
      if (!r.ok) return out(502, { error: (j.message || 'Mercado Pago rechazó la suscripción') });
      return out(200, { init_point: j.init_point });
    }

    if (tipo === 'donacion') {
      const monto = Number(item);
      if (!monto || monto < 100) return out(400, { error: 'Monto de donación inválido' });
      if (!creador) return out(400, { error: 'Falta el creador' });
      const j = await crearPreferencia(token, 'SalaMangaS — Donación a creador', monto,
        JSON.stringify({ user_id: user.id, tipo, creador, manga_id: manga_id || null }));
      return out(200, { init_point: j.init_point || j.sandbox_init_point });
    }

    if (tipo === 'manga_extra') {
      const j = await crearPreferencia(token, 'SalaMangaS — Manga extra', MANGA_EXTRA_ARS,
        JSON.stringify({ user_id: user.id, tipo }));
      return out(200, { init_point: j.init_point || j.sandbox_init_point });
    }

    return out(400, { error: 'tipo inválido' });
  } catch (e) { return out(500, { error: e.message }); }
};

async function crearPreferencia(token, titulo, precio, externalRef) {
  const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      items: [{ title: titulo, quantity: 1, currency_id: 'ARS', unit_price: precio }],
      external_reference: externalRef,
      back_urls: { success: SITE_URL, failure: SITE_URL, pending: SITE_URL },
      auto_return: 'approved',
      notification_url: SITE_URL + '/.netlify/functions/mercadopago-webhook'
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || 'Mercado Pago rechazó la preferencia');
  return j;
                            }
