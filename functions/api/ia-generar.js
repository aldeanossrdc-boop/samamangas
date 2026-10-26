// functions/api/ia-generar.js  ·  POST /api/ia-generar  (multipart)
// 1) verifica quién es · 2) IA y función encendidas (solo usuarios comunes) · 3) filtra el contenido y pide edad para +18
// 4) descuenta generaciones en la base (el CEO no gasta) · 5) genera con Fal.ai (o DeepInfra si no hay FAL_KEY):
//      modo 'ia'      -> UNA imagen (con o sin referencias)                      = 1 generación
//      modo 'paneles' -> UNA imagen por viñeta, todo en una sola llamada          = 1 generación (hasta 3 viñetas) · 2 (4 a 6)
//      modo 'lapiz'   -> EDITA tu dibujo (Qwen Image Edit o FLUX Kontext, lo elige el CEO) = 1 generación
// 6) si algo falla, el SERVIDOR devuelve la generación.
import { out, getServiceClient } from './_shared.js';
import { IAError, usuarioIA, iaActiva, modeloEscena, modeloLapizCfg, funcionActiva, leerConfig, rpcUsuario, cantidadPorModo, directivaColor } from './_ia.js';
import { motorActivo, motorImagenes, motorEditar, motorConReferencias } from './_motor.js';
import { filtrar, esContenidoAdulto } from './_filtro.js';

const MAX_ARCHIVO = 8 * 1024 * 1024; // 8 MB (la app ya achica la imagen antes de mandarla)
const ANCHO = 832, ALTO = 1248;      // vertical 2:3 FIJO
const esArchivo = f => f && typeof f === 'object' && typeof f.size === 'number' && typeof f.arrayBuffer === 'function';
const costoPaneles = n => (n <= 3 ? 1 : 2);

// ¿Esta cuenta verificó que es mayor de 18? (el CEO siempre puede)
async function esMayor18(env, ctx) {
  if (ctx.esCeo) return true;
  try { const { data } = await getServiceClient(env).from('profiles').select('mayor_18').eq('id', ctx.user.id).maybeSingle(); return !!(data && data.mayor_18); }
  catch (e) { return false; }
}

export async function onRequestPost({ request, env }) {
  let ctx = null, cobrada = false;
  try {
    ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para usar la IA' });
    if (!motorActivo(env)) {
      console.error('Falta FAL_KEY (o DEEPINFRA_API_KEY) en las variables de Cloudflare (Production)');
      return out(503, { error: ctx.esCeo ? 'Falta cargar FAL_KEY en Cloudflare (Settings → Variables and Secrets → Production) y volver a publicar.' : 'SalaMangaS IA todavía no está disponible.', codigo: 'ia_pausada' });
    }
    if (!ctx.esCeo && !(await iaActiva(env))) return out(503, { error: 'La IA está desactivada por ahora. Volvé a probar más tarde.', codigo: 'ia_desactivada' });

    const fd = await request.formData();
    const m = String(fd.get('modo'));
    const modo = m === 'lapiz' ? 'lapiz' : m === 'paneles' ? 'paneles' : 'ia';
    if (!ctx.esCeo && !(await funcionActiva(env, modo === 'lapiz' ? 'lapiz' : 'escena'))) return out(503, { error: 'Esta función está desactivada por ahora.', codigo: 'funcion_desactivada' });

    const promptUsuario = String(fd.get('prompt') || '').trim().slice(0, 1650);
    let paneles = [];
    if (modo === 'paneles') {
      try { paneles = JSON.parse(String(fd.get('paneles') || '[]')); } catch (e) { paneles = []; }
      paneles = (Array.isArray(paneles) ? paneles : []).map(x => String(x || '').trim().slice(0, 1650)).filter(Boolean);
      if (paneles.length < 2 || paneles.length > 6) return out(400, { error: 'Una página con viñetas necesita entre 2 y 6 viñetas.' });
    } else if (promptUsuario.length < 3) return out(400, { error: 'Escribí una instrucción para la IA' });

    const colorModo = ['B/N', 'Color'].includes(String(fd.get('color_modo'))) ? String(fd.get('color_modo')) : '';
    let dibujo = fd.get('dibujo');
    dibujo = esArchivo(dibujo) ? dibujo : null;
    if (dibujo && dibujo.size > MAX_ARCHIVO) return out(400, { error: 'La imagen es muy pesada (máximo 8 MB)' });
    if (modo === 'lapiz' && !dibujo) return out(400, { error: 'Falta el dibujo a lápiz' });
    const refs = fd.getAll('ref').filter(esArchivo).slice(0, 10);
    if (refs.some(f => f.size > MAX_ARCHIVO)) return out(400, { error: 'Una imagen de referencia es muy pesada (máximo 8 MB)' });
    const refNotas = String(fd.get('ref_notas') || '').slice(0, 800);
    // Fal tiene un filtro propio de imágenes: activo para usuarios comunes y apagado para el CEO. (FAL_SAFETY_USUARIOS=off lo apaga para todos.)
    // El CEO lo prende o apaga para los usuarios desde el panel (config fal_filtro_usuarios). Por defecto está prendido.
    const filtroUsuarios = String((await leerConfig(env, 'fal_filtro_usuarios')) ?? '0') !== '0';
    const seguro = !ctx.esCeo && filtroUsuarios && String(env.FAL_SAFETY_USUARIOS || '').toLowerCase() !== 'off';

    // Filtro: se revisan SOLO las palabras del usuario. Menores + sexual = bloqueo total para todos (CEO incluido).
    const textoFiltro = String(fd.get('texto') || '').slice(0, 3000) || (modo === 'paneles' ? paneles.join(' . ') : promptUsuario);
    const bloqueo = await filtrar(env, ctx, textoFiltro);
    if (bloqueo) return out(400, { error: bloqueo, codigo: 'filtro' });
    // Contenido +18 (sensual): solo con la edad verificada. Se pide ANTES de cobrar.
    if ((String(fd.get('estilo')) === 'ecchi-adulto' || esContenidoAdulto(textoFiltro)) && !(await esMayor18(env, ctx))) {
      return out(403, { error: 'Para crear contenido +18 tenés que verificar tu edad.', codigo: 'edad' });
    }

    const dirColor = directivaColor(colorModo);
    // Usuarios comunes: sensual suave sí (ropa escotada, corta o ajustada, ropa interior, playa), desnudo explícito NO. El CEO queda libre.
    const reglaSuave = ctx.esCeo ? '' : ' No nudity: at most swimwear or lingerie level, no exposed nipples or genitals, no explicit sexual acts.';
    // Anclaje de edad: la app manda adultos=1 cuando todos los personajes son adultos (según su ficha). Evita caras y cuerpos de niños.
    const reglaAdultos = String(fd.get('adultos')) === '1' ? ' All characters are ADULTS: adult body proportions, mature adult faces, no childlike features, no baby face, no oversized eyes like a child.' : '';
    // Adolescentes/menores: ropa normal de su edad, nunca sexualizados (rige para TODOS, CEO incluido).
    const reglaMenores = String(fd.get('menores')) === '1' ? ' Any character under 18 wears ordinary everyday clothes, is drawn age-appropriate and NEVER sexualized: no cleavage, no lingerie or swimwear poses, no suggestive pose or camera angle, no fanservice.' : '';
    const conReglas = p => (dirColor ? (dirColor + ' ' + p + ' ' + dirColor) : p) + reglaAdultos + reglaSuave + reglaMenores;
    const intro = 'FACE LOCK (highest priority): copy each character\'s face from its own reference image exactly: same eye shape and color, eyebrows, nose, mouth, face shape, hair color, hairstyle and skin tone. Never blend faces between characters and never invent a new face. OUTFIT LOCK: every character wears only its own assigned outfit; characters with different outfits must look clearly different from each other. Create ONE new manga illustration (use the frame shape requested below; vertical if none is requested) using the reference images in this order: ' + (refNotas || 'each image is a reference') + '. Every character MUST have EXACTLY the same face (eye shape and color, nose, mouth), hair color and hairstyle, skin tone and body as in its own reference image. Each character wears ONLY the outfit shown in the outfit reference noted as \'outfit worn by NAME\'; a character without an outfit reference keeps the clothes of its own reference. The scene happens EXACTLY in the location shown in the location reference image. IMPORTANT: each character reference shows ONE single figure: use it ONLY to learn that character\'s look. An outfit reference may show the garments on a mannequin, flat on fabric or in several views: copy ONLY the garments (design, color, straps, lace), never the mannequin, the fabric background or the sheet layout, and put them on the character. NEVER draw a character sheet, several views, labels or panels of the character, and never copy the reference background. Draw only the scene requested below. Before finishing, double-check that every face, hairstyle, outfit and the location match their references. ';

    // ---- COBRAR (el CEO no gasta). Páginas con viñetas: 1 generación hasta 3 viñetas, 2 generaciones de 4 a 6 ----
    const costo = modo === 'paneles' ? costoPaneles(paneles.length) : 1;
    if (!ctx.esCeo) {
      const restante = await rpcUsuario(env, ctx.token, 'usar_generacion_ia', { modo });
      if (Number(restante) < 0) return out(402, { error: 'No te quedan generaciones. Podés comprar Sakuras IA o mejorar tu plan.', codigo: 'sin_generaciones' });
      cobrada = true;
      if (costo === 2 && Number(restante) < 1) {   // no alcanza para la segunda: se devuelve la primera y se avisa
        try { await getServiceClient(env).rpc('devolver_generacion_ia_srv', { p_uid: ctx.user.id }); } catch (e) {}
        cobrada = false;
        return out(402, { error: 'Una página de ' + paneles.length + ' viñetas cuesta 2 generaciones y no te alcanzan.', codigo: 'sin_generaciones' });
      }
    }

    // ---- Lápiz: EDITA el dibujo ----
    if (modo === 'lapiz') {
      const promptEdicion = 'Redraw the attached reference image as a finished manga illustration. KEEP the same character: same face, expression, hairstyle shape, pose, camera angle and composition. Apply ONLY the changes and details requested below; everything else stays the same as the reference. Requested changes and details: ' + promptUsuario + (dirColor ? ' ' + dirColor : '') + reglaAdultos + reglaSuave;
      const { imagen, motor } = await motorEditar(env, { prompt: promptEdicion, archivo: dibujo, w: ANCHO, h: ALTO, seguro, motorLapiz: await modeloLapizCfg(env) });
      return out(200, { ok: true, sync: true, imagenes: [imagen], motor, cantidad: 1 });
    }

    const escena = await modeloEscena(env);

    // ---- Página con viñetas: una imagen por viñeta, en una sola llamada ----
    if (modo === 'paneles') {
      const imagenes = [];
      // Cada viñeta se pide con la forma de su cuadro (ancha, cuadrada o alta) para no recortarla después
      let formas = []; try { formas = JSON.parse(String(fd.get('formas') || '[]')); } catch (e) { formas = []; }
      const TAM = { xtall: [576, 1536], vtall: [640, 1280], tall: [ANCHO, ALTO], square: [1024, 1024], wide: [1248, 832], xwide: [1536, 640] };
      for (let i = 0; i < paneles.length; i += 3) {     // de a 3 en paralelo para no saturar a Fal
        const lote = paneles.slice(i, i + 3);
        const res = await Promise.all(lote.map((p, k) => { const tam = TAM[formas[i + k]] || TAM.tall; return motorConReferencias(env, { escena, prompt: refs.length ? intro + conReglas(p) : conReglas(p), promptSinRef: conReglas(p), archivos: refs, w: tam[0], h: tam[1], n: 1, colorModo, seguro }); }));
        res.forEach(r => imagenes.push(r.imagenes[0]));
      }
      if (costo === 2 && !ctx.esCeo) { try { await rpcUsuario(env, ctx.token, 'usar_generacion_ia', { modo }); } catch (e) { console.warn('Segunda generación no cobrada:', e.message); } }
      return out(200, { ok: true, sync: true, paneles: true, imagenes, motor: 'fal-' + escena, cantidad: imagenes.length, costo });
    }

    // ---- SalaMangaS IA: una imagen ----
    const { imagenes, motor } = await motorConReferencias(env, { escena, prompt: refs.length ? intro + conReglas(promptUsuario) : conReglas(promptUsuario), promptSinRef: conReglas(promptUsuario), archivos: refs, w: ANCHO, h: ALTO, n: cantidadPorModo('ia'), colorModo, seguro });
    return out(200, { ok: true, sync: true, imagenes, motor, cantidad: imagenes.length });
  } catch (e) {
    let devuelta = false;
    if (cobrada && ctx) {
      try { const { error: er } = await getServiceClient(env).rpc('devolver_generacion_ia_srv', { p_uid: ctx.user.id }); if (er) throw new Error(er.message); devuelta = true; }
      catch (e2) { console.error('No se pudo devolver la generación:', e2.message); }
    }
    const status = e instanceof IAError ? e.status : 500;
    return out(status, { error: (e instanceof IAError ? e.message : 'No se pudo generar. Probá de nuevo.') + (devuelta ? ' No se te descontó la generación.' : ''), codigo: e.codigo || '', devuelta });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
