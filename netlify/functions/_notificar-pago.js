// _notificar-pago.js — Helper para notificar pagos confirmados.
// Se llama desde mercadopago-webhook.js y paypal-webhook.js.

const { getServiceClient } = require('./_shared');

async function notificarPago({ userId, tipo, monto, moneda, detalle, provider }) {
  try {
    const sb = getServiceClient();
    const texto = `💰 Pago confirmado: ${detalle} — $${monto} ${moneda || 'ARS'} (${provider || 'pago'})`;

    if (userId) {
      await sb.from('notificaciones').insert({
        user_id: userId,
        tipo: 'pago',
        texto
      });
    }

    // Notificar también al CEO
    const { data: ceo } = await sb.from('profiles').select('id').in('email', [
      'aldeanossrdc@gmail.com',
      'srdcceo1992@gmail.com',
      'salamangas.oficial@gmail.com'
    ]).limit(1).maybeSingle();

    if (ceo && ceo.id) {
      await sb.from('notificaciones').insert({
        user_id: ceo.id,
        tipo: 'pago_ceo',
        texto: `💰 ${texto}`
      });
    }

    return { ok: true };
  } catch (e) {
    console.error('_notificar-pago error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { notificarPago };
