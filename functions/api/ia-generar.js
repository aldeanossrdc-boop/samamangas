// functions/api/ia-generar.js — POST /api/ia-generar
// 1) verifica quién es, 2) filtra el contenido (solo usuarios comunes), 3) descuenta 1 generación (en la base),
// 4) SalaMangaS IA -> DeepInfra (Qwen-Image o FLUX Kontext, lo elige el CEO), 1 imagen vertical 832x1248.
//    Lápiz -> Leonardo primero (1 imagen); cuando Leonardo está en 0 pasa SOLO a Qwen-Image-Edit (DeepInfra).
// 5) si algo falla, DEVUELVE la generación. El CEO siempre puede generar y no gasta nada.
import { out, getServiceClient } from './_shared.js';
import { IAError, usuarioIA, iaActiva, modeloIA, modeloEscena, rpcUsuario, subirReferencia, crearGeneracion, cantidadPorModo } from './_ia.js';
import { diDisponible, diModelo, diImagenes, diEditar } from './_deepinfra.js';
import { filtrar } from './_filtro.js';

const MAX_ARCHIVO = 4 * 1024 * 1024; // 4 MB por imagen de referencia
const ANCHO = 832, ALTO = 1248;      // vertical 2:3 FIJO
const esArchivo = f => f && typeof f === 'object' && typeof f.size === 'number' && typeof f.arrayBuffer === 'function';

export async function onRequestPost({ request, env }) {
  let ctx = null, consumida = false;
  try {
    ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para usar la IA' });
    if (!env.LEONARDO_API_KEY && !diDisponible(env)) return out(500, { error: 'La IA todavía no está configurada (faltan LEONARDO_API_KEY o DEEPINFRA_API_KEY)' });
    if (!ctx.esCeo && !(await iaActiva(env))) return out(503, { error: 'La IA está desactivada por ahora. Volvé a probar más tarde.', codigo: 'ia_desactivada' });

    const fd = await request.formData();
    const prompt = String(fd.get('prompt') || '').trim().slice(0, 1800);
    if (prompt.length < 3) return out(400, { error: 'Escribí una instrucción para la IA' });
    const modo = fd.get('modo') === 'lapiz' ? 'lapiz' : 'ia';
    const estilo = String(fd.get('estilo') || 'clasico');
    let dibujo = fd.get('dibujo'), personaje = fd.get('personaje');
    dibujo = esArchivo(dibujo) ? dibujo : null;
    personaje = esArchivo(personaje) ? personaje : null;
    if ((dibujo && dibujo.size > MAX_ARCHIVO) || (personaje && personaje.size > MAX_ARCHIVO)) return out(400, { error: 'Una imagen de referencia es muy pesada (máximo 4 MB)' });
    if (modo === 'lapiz' && !dibujo) return out(400, { error: 'Falta el dibujo a lápiz' });
    if (modo === 'ia' && !diDisponible(env)) return out(503, { error: 'SalaMangaS IA todavía no está disponible.', codigo: 'ia_pausada' });

    // Lista negra: SOLO usuarios comunes (el CEO verificado queda exento)
    const bloqueo = await filtrar(env, ctx, prompt);
    if (bloqueo) return out(400, { error: bloqueo, codigo: 'filtro' });

    // COBRAR (el CEO no gasta). Si no tiene generaciones, la base devuelve -1.
    if (!ctx.esCeo) {
      const restante = await rpcUsuario(env, ctx.token, 'usar_generacion_ia', { modo });
      if (Number(restante) < 0) return out(402, { error: 'No te quedan generaciones. Podés comprar Sakuras IA o mejorar tu plan.', codigo: 'sin_generaciones' });
      consumida = true;
    }

    // ---- SalaMangaS IA: DeepInfra (el CEO elige Qwen-Image o FLUX Kontext) ----
    if (modo === 'ia') {
      let escena = await modeloEscena(env);
      // FLUX Kontext es un modelo de EDICIÓN: exige imagen de entrada y falla en texto→imagen. Sin imagen, se usa Qwen-Image.
      if (escena === 'kontext') { console.warn('ia_modelo_escena=kontext no sirve para texto→imagen: se usa qwen'); escena = 'qwen'; }
      const imagenes = await diImagenes(env, { modelo: diModelo(env, escena), prompt, w: ANCHO, h: ALTO, n: cantidadPorModo('ia') });
      return out(200, { ok: true, sync: true, imagenes, motor: 'deepinfra-' + escena, cantidad: imagenes.length });
    }

    // ---- Lápiz: Leonardo primero; si Leonardo está en 0 (o caído) pasa automático a Qwen-Image-Edit ----
    if (env.LEONARDO_API_KEY) {
      try {
        const dibujoId = await subirReferencia(env, dibujo);
        const personajeId = personaje ? await subirReferencia(env, personaje) : null;
        const modelo = await modeloIA(env);
        const cantidad = cantidadPorModo(modo);
        const { id, motor } = await crearGeneracion(env, { prompt, estilo, modelo, dibujoId, personajeId, cantidad });
        // Se anota quién pagó esta generación: si Leonardo falla después (ia-estado.js), se devuelve UNA sola vez.
        if (consumida) {
          try {
            const { error } = await getServiceClient(env).from('ia_generaciones').insert({ id, user_id: ctx.user.id });
            if (error) console.error('ia_generaciones insert:', error.message);
          } catch (e2) { console.error('ia_generaciones:', e2.message); }
        }
        return out(200, { ok: true, id, motor, cantidad });
      } catch (e) {
        const puedeRespaldo = e instanceof IAError && (e.codigo === 'sin_saldo_ia' || e.status >= 500) && diDisponible(env);
        if (!puedeRespaldo) throw e;
        console.warn('Leonardo sin saldo o caído (' + e.message + '): se usa Qwen-Image-Edit');
      }
    }
    if (!diDisponible(env)) throw new IAError('La IA no está disponible en este momento. Avisale al equipo de SalaMangaS.', 503, 'sin_saldo_ia');
    const img = await diEditar(env, { prompt, archivo: dibujo, w: ANCHO, h: ALTO });
    return out(200, { ok: true, sync: true, imagenes: [img], motor: 'deepinfra-edit', cantidad: 1 });
  } catch (e) {
    let devuelta = false;
    if (consumida && ctx) { try { const { error: er } = await getServiceClient(env).rpc('devolver_generacion_ia_srv', { p_uid: ctx.user.id }); if (er) throw new Error(er.message); devuelta = true; } catch (e2) { console.error('No se pudo devolver la generación:', e2.message); } }
    const status = e instanceof IAError ? e.status : 500;
    return out(status, { error: (e instanceof IAError ? e.message : 'No se pudo generar. Probá de nuevo.') + (devuelta ? ' No se te descontó la generación.' : ''), codigo: e.codigo || '', devuelta });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
