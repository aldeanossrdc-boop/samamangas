// functions/api/ia-generar.js  ·  POST /api/ia-generar  (multipart)
// 1) verifica quién es · 2) IA encendida (solo usuarios comunes) · 3) filtra el contenido (solo usuarios comunes)
// 4) descuenta 1 generación (en la base; el CEO no gasta) · 5) genera con Fal.ai (o DeepInfra si no hay FAL_KEY):
//      SalaMangaS IA -> texto→imagen (Qwen-Image; el CEO puede elegir FLUX Kontext, que sin imagen se cambia a Qwen)
//      Lápiz         -> EDITA tu dibujo (Qwen-Image-Edit): mantiene el personaje y aplica lo que pedís (color, pelo, ropa, fondo)
// 6) si algo falla, el SERVIDOR devuelve la generación. Leonardo ya NO se usa acá (solo para crear personajes).
import { out, getServiceClient } from './_shared.js';
import { IAError, usuarioIA, iaActiva, modeloEscena, rpcUsuario, cantidadPorModo, directivaColor } from './_ia.js';
import { motorActivo, motorImagenes, motorEditar, motorConReferencias } from './_motor.js';
import { filtrar } from './_filtro.js';

const MAX_ARCHIVO = 8 * 1024 * 1024; // 8 MB (la app ya achica la imagen antes de mandarla)
const ANCHO = 832, ALTO = 1248;      // vertical 2:3 FIJO
const esArchivo = f => f && typeof f === 'object' && typeof f.size === 'number' && typeof f.arrayBuffer === 'function';

export async function onRequestPost({ request, env }) {
  let ctx = null, consumida = false;
  try {
    ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para usar la IA' });
    if (!motorActivo(env)) {
      console.error('Falta FAL_KEY (o DEEPINFRA_API_KEY) en las variables de Cloudflare (Production)');
      return out(503, { error: ctx.esCeo ? 'Falta cargar FAL_KEY en Cloudflare (Settings → Variables and Secrets → Production) y volver a publicar.' : 'SalaMangaS IA todavía no está disponible.', codigo: 'ia_pausada' });
    }
    if (!ctx.esCeo && !(await iaActiva(env))) return out(503, { error: 'La IA está desactivada por ahora. Volvé a probar más tarde.', codigo: 'ia_desactivada' });

    const fd = await request.formData();
    const promptUsuario = String(fd.get('prompt') || '').trim().slice(0, 1650);
    if (promptUsuario.length < 3) return out(400, { error: 'Escribí una instrucción para la IA' });
    const modo = fd.get('modo') === 'lapiz' ? 'lapiz' : 'ia';
    const colorModo = ['B/N', 'Color'].includes(String(fd.get('color_modo'))) ? String(fd.get('color_modo')) : '';
    let dibujo = fd.get('dibujo');
    dibujo = esArchivo(dibujo) ? dibujo : null;
    if (dibujo && dibujo.size > MAX_ARCHIVO) return out(400, { error: 'La imagen es muy pesada (máximo 8 MB)' });
    if (modo === 'lapiz' && !dibujo) return out(400, { error: 'Falta el dibujo a lápiz' });
    // Imágenes de referencia (fotos de personajes, lugar, outfit, las que sube el usuario): hasta 4
    const refs = fd.getAll('ref').filter(esArchivo).slice(0, 4);
    if (refs.some(f => f.size > MAX_ARCHIVO)) return out(400, { error: 'Una imagen de referencia es muy pesada (máximo 8 MB)' });
    const refNotas = String(fd.get('ref_notas') || '').slice(0, 600);
    // Fal tiene un filtro propio de imágenes: está activo para usuarios comunes y apagado para el CEO. (FAL_SAFETY_USUARIOS=off lo apaga para todos.)
    const seguro = !ctx.esCeo && String(env.FAL_SAFETY_USUARIOS || '').toLowerCase() !== 'off';

    // La orden de color va al principio y al final: los modelos la obedecen mucho más así.
    const dirColor = directivaColor(colorModo);
    const prompt = dirColor ? (dirColor + ' ' + promptUsuario + ' ' + dirColor) : promptUsuario;

    // Filtro: se revisan SOLO las palabras del usuario (texto, personajes, lugar, outfit, viñetas), no los textos de estilo de la app.
    // Menores + sexual = bloqueo total para todos (CEO incluido). Sexo explícito/gore: solo bloquea a usuarios comunes.
    const textoFiltro = String(fd.get('texto') || '').slice(0, 3000) || promptUsuario;
    const bloqueo = await filtrar(env, ctx, textoFiltro);
    if (bloqueo) return out(400, { error: bloqueo, codigo: 'filtro' });

    // COBRAR (el CEO no gasta). Si no tiene generaciones, la base devuelve -1.
    if (!ctx.esCeo) {
      const restante = await rpcUsuario(env, ctx.token, 'usar_generacion_ia', { modo });
      if (Number(restante) < 0) return out(402, { error: 'No te quedan generaciones. Podés comprar Sakuras IA o mejorar tu plan.', codigo: 'sin_generaciones' });
      consumida = true;
    }

    // ---- SalaMangaS IA: texto → imagen ----
    if (modo === 'ia') {
      let escena = await modeloEscena(env);
      // FLUX Kontext es un modelo de EDICIÓN: exige imagen de entrada y falla en texto→imagen. Sin imagen, se usa Qwen-Image.
      if (escena === 'kontext') { console.warn('ia_modelo_escena=kontext no sirve para texto→imagen: se usa qwen'); escena = 'qwen'; }
      const promptConRef = refs.length
        ? 'Create ONE new vertical manga illustration using the reference images in this order: ' + (refNotas || 'each image is a reference') + '. Keep every character\'s face, hair, body and outfit exactly like its reference image, and keep the location/outfit references. Do NOT copy the reference layout; draw this new scene. ' + prompt
        : prompt;
      const { imagenes, motor } = await motorConReferencias(env, { escena, prompt: promptConRef, promptSinRef: prompt, archivos: refs, w: ANCHO, h: ALTO, n: cantidadPorModo('ia'), colorModo, seguro });
      return out(200, { ok: true, sync: true, imagenes, motor, cantidad: imagenes.length });
    }

    // ---- Lápiz: EDITA el dibujo con Qwen-Image-Edit ----
    const promptEdicion = 'Redraw the attached reference image as a finished manga illustration. KEEP the same character: same face, expression, hairstyle shape, pose, camera angle and composition. Apply ONLY the changes and details requested below; everything else stays the same as the reference. Requested changes and details: ' + promptUsuario + (dirColor ? ' ' + dirColor : '');
    const { imagen, motor } = await motorEditar(env, { prompt: promptEdicion, archivo: dibujo, w: ANCHO, h: ALTO, seguro });
    return out(200, { ok: true, sync: true, imagenes: [imagen], motor, cantidad: 1 });
  } catch (e) {
    let devuelta = false;
    if (consumida && ctx) {
      try { const { error: er } = await getServiceClient(env).rpc('devolver_generacion_ia_srv', { p_uid: ctx.user.id }); if (er) throw new Error(er.message); devuelta = true; }
      catch (e2) { console.error('No se pudo devolver la generación:', e2.message); }
    }
    const status = e instanceof IAError ? e.status : 500;
    return out(status, { error: (e instanceof IAError ? e.message : 'No se pudo generar. Probá de nuevo.') + (devuelta ? ' No se te descontó la generación.' : ''), codigo: e.codigo || '', devuelta });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
