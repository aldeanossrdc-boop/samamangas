// functions/api/ia-generar.js  ·  POST /api/ia-generar  (multipart)
// 1) verifica quién es · 2) IA encendida (solo usuarios comunes) · 3) filtra el contenido (solo usuarios comunes)
// 4) descuenta 1 generación (en la base; el CEO no gasta) · 5) genera con DeepInfra:
//      SalaMangaS IA -> texto→imagen (Qwen-Image; el CEO puede elegir FLUX Kontext, que sin imagen se cambia a Qwen)
//      Lápiz         -> EDITA tu dibujo (Qwen-Image-Edit): mantiene el personaje y aplica lo que pedís (color, pelo, ropa, fondo)
// 6) si algo falla, el SERVIDOR devuelve la generación. Leonardo ya NO se usa acá (solo para crear personajes).
import { out, getServiceClient } from './_shared.js';
import { IAError, usuarioIA, iaActiva, modeloEscena, rpcUsuario, cantidadPorModo, directivaColor } from './_ia.js';
import { diDisponible, diModelo, diImagenes, diEditar } from './_deepinfra.js';
import { filtrar } from './_filtro.js';

const MAX_ARCHIVO = 8 * 1024 * 1024; // 8 MB (la app ya achica la imagen antes de mandarla)
const ANCHO = 832, ALTO = 1248;      // vertical 2:3 FIJO
const esArchivo = f => f && typeof f === 'object' && typeof f.size === 'number' && typeof f.arrayBuffer === 'function';

export async function onRequestPost({ request, env }) {
  let ctx = null, consumida = false;
  try {
    ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para usar la IA' });
    if (!diDisponible(env)) {
      console.error('Falta DEEPINFRA_API_KEY en las variables de Cloudflare (Production)');
      return out(503, { error: ctx.esCeo ? 'Falta cargar DEEPINFRA_API_KEY en Cloudflare (Settings → Variables and Secrets → Production) y volver a publicar.' : 'SalaMangaS IA todavía no está disponible.', codigo: 'ia_pausada' });
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

    // La orden de color va al principio y al final: los modelos la obedecen mucho más así.
    const dirColor = directivaColor(colorModo);
    const prompt = dirColor ? (dirColor + ' ' + promptUsuario + ' ' + dirColor) : promptUsuario;

    // Lista negra: SOLO usuarios comunes (el CEO verificado queda exento, salvo contenido sexual con menores)
    const bloqueo = await filtrar(env, ctx, promptUsuario);
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
      const imagenes = await diImagenes(env, { modelo: diModelo(env, escena), prompt, w: ANCHO, h: ALTO, n: cantidadPorModo('ia') });
      return out(200, { ok: true, sync: true, imagenes, motor: 'deepinfra-' + escena, cantidad: imagenes.length });
    }

    // ---- Lápiz: EDITA el dibujo con Qwen-Image-Edit ----
    const promptEdicion = 'Redraw the attached reference image as a finished manga illustration. KEEP the same character: same face, expression, hairstyle shape, pose, camera angle and composition. Apply ONLY the changes and details requested below; everything else stays the same as the reference. Requested changes and details: ' + promptUsuario + (dirColor ? ' ' + dirColor : '');
    const img = await diEditar(env, { prompt: promptEdicion, archivo: dibujo, w: ANCHO, h: ALTO });
    return out(200, { ok: true, sync: true, imagenes: [img], motor: 'deepinfra-edit', cantidad: 1 });
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
