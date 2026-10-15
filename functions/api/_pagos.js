// functions/api/_pagos.js — helpers de pagos compartidos por los webhooks de Mercado Pago y PayPal.
// Objetivo: que un pago se acredite UNA sola vez aunque el proveedor reenvíe el aviso (lo hacen seguido).
import { NOMBRE_PLAN, CANT_SAKURAS, CANT_SAKURAS_IA, SAKURAS_MENSUALES_PLAN } from './_shared.js';

export const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, String(k));

// Lanza error si una llamada a Supabase (rpc / insert / update) falló.
export function chk(r, nombre) {
  if (r && r.error) throw new Error(nombre + ': ' + r.error.message);
  return r;
}

// Reclama una clave única en public.pagos_procesados. true = es la primera vez (procesar); false = ya se procesó.
// Si la tabla todavía no existe (no corriste el SQL), NO frena el pago: acredita igual y avisa en el log.
export async function reclamar(sb, clave) {
  const { error } = await sb.from('pagos_procesados').insert({ clave });
  if (!error) return true;
  if (error.code === '23505') return false;
  if (error.code === '42P01' || error.code === 'PGRST205' || /pagos_procesados/.test(error.message || '')) {
    console.error('FALTA la tabla pagos_procesados (correr sql/pagos_procesados.sql): se acredita SIN control de duplicados');
    return true;
  }
  throw new Error('reclamar: ' + error.message);
}
export async function liberar(sb, clave) {
  try { await sb.from('pagos_procesados').delete().eq('clave', clave); } catch (e) {}
}

// Acredita un mes de plan + las Sakuras mensuales. UNA vez por usuario+plan+mes calendario (UTC):
// así la activación y el primer cobro (que llegan juntos) no suman el mes dos veces, y los reintentos tampoco.
export async function otorgarPlan(sb, ref) {
  if (!ref || !ref.user_id || !own(NOMBRE_PLAN, ref.item)) return false;
  const clave = 'plan:' + ref.user_id + ':' + ref.item + ':' + new Date().toISOString().slice(0, 7);
  if (!(await reclamar(sb, clave))) return false;
  try {
    const { data: perfil } = await sb.from('profiles').select('tier_hasta').eq('id', ref.user_id).maybeSingle();
    const base = (perfil && perfil.tier_hasta && new Date(perfil.tier_hasta) > new Date()) ? new Date(perfil.tier_hasta) : new Date();
    base.setMonth(base.getMonth() + 1);
    chk(await sb.from('profiles').update({ tier: ref.item, tier_hasta: base.toISOString() }).eq('id', ref.user_id), 'actualizar plan');
    chk(await sb.rpc('dar_sakuras', { uid: ref.user_id, cant: SAKURAS_MENSUALES_PLAN, origen: 'plan_mensual' }), 'dar_sakuras plan');
  } catch (e) { await liberar(sb, clave); throw e; }
  return true;
}

// Texto corto para la notificación de pago confirmado
export function detallePago(ref) {
  if (!ref) return 'Pago';
  if (ref.tipo === 'sakuras') return (CANT_SAKURAS[ref.item] || '') + ' Sakuras';
  if (ref.tipo === 'sakuras_ia') return (CANT_SAKURAS_IA[ref.item] || '') + ' Sakuras IA';
  if (ref.tipo === 'plan') return 'Plan ' + (NOMBRE_PLAN[ref.item] || ref.item);
  if (ref.tipo === 'donacion') return 'Donación a creador';
  if (ref.tipo === 'manga_extra') return 'Manga extra';
  return 'Pago';
}

// Reparto de donaciones (decisión del CEO): Pro 50% al creador · Súper Pro 100% · Semi Dios 0% · Dios 0% · Gratis 0%.
// El resto se lo queda el CEO. Cuenta solo si el plan del creador está vigente.
export async function pctCreadorDonacion(sb, creadorId) {
  const { data: c } = await sb.from('profiles').select('username,tier,tier_hasta,creador_gratis,vence_gratis').eq('id', creadorId).maybeSingle();
  if (!c) return { creador: null, pct: 0 };
  const ahora = new Date();
  const vigente = c.tier && c.tier !== 'gratis'
    && !(c.tier_hasta && new Date(c.tier_hasta) < ahora)
    && !(c.creador_gratis && c.vence_gratis && new Date(c.vence_gratis) < ahora);
  const tabla = { pro: 0.5, superpro: 1 };
  return { creador: c, pct: vigente && own(tabla, c.tier) ? tabla[c.tier] : 0 };
}
