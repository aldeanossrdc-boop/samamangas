// functions/api/ia-estado.js — GET /api/ia-estado?id=...
// La app pregunta cada 3 segundos si las 4 imágenes ya están listas.
// Si Leonardo falló (o bloqueó todo por contenido), se devuelve la generación.
import { out } from './_shared.js';
import { IAError, usuarioIA, rpcUsuario, consultarGeneracion } from './_ia.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env }) {
  try {
    const ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para usar la IA' });
    if (!env.LEONARDO_API_KEY) return out(500, { error: 'La IA todavía no está configurada' });
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!UUID.test(id)) return out(400, { error: 'Pedido inválido' });

    const g = await consultarGeneracion(env, id);
    const devolver = async () => { if (!ctx.esCeo) { try { await rpcUsuario(env, ctx.token, 'devolver_generacion_ia', {}); return true; } catch (e) { console.error('devolver:', e.message); } } return false; };

    if (g.status === 'FAILED') {
      const d = await devolver();
      return out(200, { estado: 'fallo', error: 'La IA no pudo crear la imagen.' + (d ? ' No se te descontó la generación.' : '') });
    }
    if (g.status === 'COMPLETE') {
      const imgs = g.imagenes.filter(x => x && x.url && !x.nsfw).map(x => x.url);
      if (!imgs.length) {
        const d = await devolver();
        return out(200, { estado: 'fallo', error: 'La IA bloqueó las imágenes por contenido no permitido. Probá describirlo de otra forma.' + (d ? ' No se te descontó la generación.' : '') });
      }
      return out(200, { estado: 'listo', imagenes: imgs });
    }
    return out(200, { estado: 'pendiente' });
  } catch (e) {
    return out(e instanceof IAError ? e.status : 500, { error: e instanceof IAError ? e.message : 'Error consultando la IA' });
  }
}
export const onRequestPost = onRequestGet;
