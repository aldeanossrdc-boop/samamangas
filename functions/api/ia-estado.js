// functions/api/ia-estado.js — GET /api/ia-estado?id=<generationId>
// La app pregunta cada 3 s cómo va la generación de Leonardo (modo Lápiz).
// Si Leonardo falla (o bloquea la imagen por contenido), se devuelve la generación UNA sola vez.
// Mejora sobre la versión anterior: antes cada consulta de una generación fallida devolvía otra vez (se podía
// repetir para regalarse generaciones). Ahora se devuelve solo si ese usuario la pagó (tabla ia_generaciones)
// y una única vez. Requiere correr sql/ia_generaciones.sql.
import { out, getServiceClient } from './_shared.js';
import { IAError, usuarioIA, consultarGeneracion } from './_ia.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function devolverUnaVez(env, ctx, id) {
  if (ctx.esCeo) return false;                                   // el CEO no gasta: no hay nada que devolver
  const devolver = async () => { try { const { error: er } = await getServiceClient(env).rpc('devolver_generacion_ia_srv', { p_uid: ctx.user.id }); if (er) throw new Error(er.message); return true; } catch (e) { console.error('devolver:', e.message); return false; } };
  let sb;
  try { sb = getServiceClient(env); } catch (e) { console.error('ia-estado sin service key:', e.message); return false; }
  try {
    const { data, error } = await sb.from('ia_generaciones').update({ devuelta: true })
      .eq('id', id).eq('user_id', ctx.user.id).eq('devuelta', false).select('id');
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {   // todavía no corriste sql/ia_generaciones.sql: se comporta como antes
        console.error('FALTA la tabla ia_generaciones (correr sql/ia_generaciones.sql): se devuelve sin control de repeticiones');
        return await devolver();
      }
      console.error('ia_generaciones update:', error.message); return false;
    }
    if (!data || !data.length) return false;                      // no la pagó este usuario, o ya se devolvió
    if (await devolver()) return true;
    await sb.from('ia_generaciones').update({ devuelta: false }).eq('id', id);   // la devolución falló: queda para reintentar
    return false;
  } catch (e) { console.error('devolverUnaVez:', e.message); return false; }
}

export async function onRequestGet({ request, env }) {
  try {
    const ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para usar la IA' });
    if (!env.LEONARDO_API_KEY) return out(500, { error: 'La IA todavía no está configurada' });
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!UUID.test(id)) return out(400, { error: 'Pedido inválido' });

    const g = await consultarGeneracion(env, id);

    if (g.status === 'FAILED') {
      const d = await devolverUnaVez(env, ctx, id);
      return out(200, { estado: 'fallo', devuelta: d, error: 'La IA no pudo crear la imagen.' + (d ? ' No se te descontó la generación.' : '') });
    }
    if (g.status === 'COMPLETE') {
      const imgs = g.imagenes.filter(x => x && x.url && !x.nsfw).map(x => x.url);
      if (!imgs.length) {
        const d = await devolverUnaVez(env, ctx, id);
        return out(200, { estado: 'fallo', devuelta: d, error: 'La IA bloqueó las imágenes por contenido no permitido. Probá describirlo de otra forma.' + (d ? ' No se te descontó la generación.' : '') });
      }
      return out(200, { estado: 'listo', imagenes: imgs });
    }
    return out(200, { estado: 'pendiente' });
  } catch (e) {
    return out(e instanceof IAError ? e.status : 500, { error: e instanceof IAError ? e.message : 'Error consultando la IA' });
  }
}
export const onRequestPost = onRequestGet;
