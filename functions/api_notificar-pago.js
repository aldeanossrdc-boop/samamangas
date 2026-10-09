// functions/api/_notificar-pago.js — Helper para notificar pagos confirmados.
// Pensado para llamarse desde mercadopago-webhook.js y paypal-webhook.js.
// (Nota: en el código original tampoco se llamaba desde ahí todavía —
// se portó tal cual estaba, sin agregar el llamado, para no cambiar
// comportamiento que no se pidió tocar.)

import { getServiceClient } from './_shared.js';

export async function notificarPago({ userId, tipo, monto, moneda, detalle, provider, env }) {
  try {
    const sb = getServiceClient(env);
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
      'salamangas.oficial.92@gmail.com'
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
