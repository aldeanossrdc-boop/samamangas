// functions/api/ia-generar.js — POST /api/ia-generar
// 1) verifica quién es, 2) descuenta 1 generación (en la base, no en el celu),
// 3) pide las imágenes a Leonardo (Lápiz = 1, SalaMangaS IA = 2), 4) si algo falla, DEVUELVE la generación.
// El CEO siempre puede generar (aunque la IA esté apagada para los usuarios) y no gasta generaciones.
import { out } from './_shared.js';
import { IAError, usuarioIA, iaActiva, rpcUsuario, subirReferencia, crearGeneracion, cantidadPorModo } from './_ia.js';

const MAX_ARCHIVO = 4 * 1024 * 1024; // 4 MB por imagen de referencia
const esArchivo = f => f && typeof f === 'object' && typeof f.size === 'number' && typeof f.arrayBuffer === 'function';

export async function onRequestPost({ request, env }) {
  let ctx = null, consumida = false;
  try {
    ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para usar la IA' });
    if (!env.LEONARDO_API_KEY) return out(500, { error: 'La IA todavía no está configurada (falta LEONARDO_API_KEY)' });
    if (!ctx.esCeo && !(await iaActiva(env))) return out(503, { error: 'La IA está desactivada por ahora. Volvé a probar más tarde.', codigo: 'ia_desactivada' });

    const fd = await request.formData();
    const prompt = String(fd.get('prompt') || '').trim().slice(0, 1800);
    if (prompt.length < 3) return out(400, { error: 'Escribí una instrucción para la IA' });
    const modo = fd.get('modo') === 'lapiz' ? 'lapiz' : 'ia';
    const estilo = String(fd.get('estilo') || 'clasico');
    const borrador = fd.get('borrador') === '1';
    let dibujo = fd.get('dibujo'), personaje = fd.get('personaje');
    dibujo = esArchivo(dibujo) ? dibujo : null;
    personaje = esArchivo(personaje) ? personaje : null;
    if ((dibujo && dibujo.size > MAX_ARCHIVO) || (personaje && personaje.size > MAX_ARCHIVO)) return out(400, { error: 'Una imagen de referencia es muy pesada (máximo 4 MB)' });
    if (modo === 'lapiz' && !dibujo) return out(400, { error: 'Falta el dibujo a lápiz' });

    // 1) COBRAR (el CEO no gasta). Si no tiene generaciones, la base devuelve -1.
    if (!ctx.esCeo) {
      const restante = await rpcUsuario(env, ctx.token, 'usar_generacion_ia', { modo });
      if (Number(restante) < 0) return out(402, { error: 'No te quedan generaciones. Podés comprar Sakuras IA o mejorar tu plan.', codigo: 'sin_generaciones' });
      consumida = true;
    }

    // 2) Referencias + creación
    const dibujoId = dibujo ? await subirReferencia(env, dibujo) : null;
    const personajeId = personaje ? await subirReferencia(env, personaje) : null;
    const cantidad = cantidadPorModo(modo);
    const { id, motor } = await crearGeneracion(env, { prompt, estilo, borrador, dibujoId, personajeId, cantidad });
    return out(200, { ok: true, id, motor, cantidad });
  } catch (e) {
    let devuelta = false;
    if (consumida && ctx) { try { await rpcUsuario(env, ctx.token, 'devolver_generacion_ia', {}); devuelta = true; } catch (e2) { console.error('No se pudo devolver la generación:', e2.message); } }
    const status = e instanceof IAError ? e.status : 500;
    return out(status, { error: (e instanceof IAError ? e.message : 'No se pudo generar. Probá de nuevo.') + (devuelta ? ' No se te descontó la generación.' : ''), codigo: e.codigo || '', devuelta });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
