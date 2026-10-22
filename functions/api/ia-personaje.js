// functions/api/ia-personaje.js  ·  POST /api/ia-personaje  { nombre, descripcion, estilo, estilo_txt, genero, edad }
// Crea la HOJA DE PERSONAJE: UNA imagen con el mismo personaje en distintas posturas (frente, perfil, espalda, retrato y detalle), SIN textos.
// Ahora se genera con Fal.ai (síncrono: devuelve { imagen } al instante). Si el CEO elige "Leonardo" en el panel, usa Leonardo (devuelve { id }).
// NO guarda nada ni descuenta el cupo: el cupo se descuenta recién cuando el usuario ACEPTA el personaje.
import { out, getServiceClient } from './_shared.js';
import { IAError, usuarioIA, rpcUsuario, crearGeneracion, modeloPersonajeCfg, funcionActiva, leerConfig } from './_ia.js';
import { filtrar, esContenidoAdulto } from './_filtro.js';
import { motorActivo, motorImagenes } from './_motor.js';

const ESTILOS = {
  'Manga blanco y negro': { txt: 'black and white manga style, clean ink lines, screentones',              color: 'B/N',   estilo: 'clasico' },
  'Anime a color':        { txt: 'colorful anime style, clean lineart, soft cel shading',                    color: 'Color', estilo: 'clasico' },
  'Chibi':                { txt: 'cute chibi style, big head, small body, colorful',                         color: 'Color', estilo: 'chibi' },
  'Dark fantasy':         { txt: 'dark fantasy illustration style, dramatic lighting, detailed, colorful',   color: 'Color', estilo: 'dark' },
  'Realista':             { txt: 'semi-realistic illustration style, detailed shading, natural proportions', color: 'Color', estilo: 'realista' }
};
const MINOR = /\b(nino|nina|ninos|ninas|menor|menores|adolescente|colegial|colegiala|infantil|kid|child|teen)\b/;

export async function onRequestPost({ request, env }) {
  try {
    const ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para crear personajes' });
    if (!ctx.esCeo && !(await funcionActiva(env, 'personaje'))) return out(503, { error: 'Crear personajes con IA está desactivado por ahora.', codigo: 'funcion_desactivada' });
    const escena = await modeloPersonajeCfg(env);
    if (escena === 'leonardo' ? !env.LEONARDO_API_KEY : !motorActivo(env)) {
      console.error('Falta la clave de IA para personajes (' + escena + ')');
      return out(503, { error: 'Crear personajes con IA todavía no está disponible.' });
    }
    const b = await request.json().catch(() => ({}));
    const nombre = String(b.nombre || '').trim().slice(0, 60);
    const desc = String(b.descripcion || '').trim().slice(0, 900);
    const estiloApp = String(b.estilo || 'Shonen Battle').trim().slice(0, 60);
    const genero = String(b.genero || '').trim().slice(0, 20);
    const edad = Math.round(Number(b.edad || (/Edad:\s*(\d{1,2})/i.exec(desc) || [])[1] || 0));
    if (nombre.length < 2 || desc.length < 5) return out(400, { error: 'Poné un nombre y la descripción del personaje.' });
    const bloqueo = await filtrar(env, ctx, nombre, desc, estiloApp);
    if (bloqueo) return out(400, { error: bloqueo, codigo: 'filtro' });
    // Contenido +18 (sensual): solo con la edad verificada (el CEO siempre puede)
    if (!ctx.esCeo && (estiloApp === 'Ecchi adulto' || esContenidoAdulto(nombre, desc))) {
      let ok = false;
      try { const { data } = await getServiceClient(env).from('profiles').select('mayor_18').eq('id', ctx.user.id).maybeSingle(); ok = !!(data && data.mayor_18); } catch (e) {}
      if (!ok) return out(403, { error: 'Para crear personajes +18 tenés que verificar tu edad.', codigo: 'edad' });
    }
    if (!ctx.esCeo) {
      const r = await rpcUsuario(env, ctx.token, 'puede_generar_personaje', {});
      if (r === 'sin_credito') return out(402, { error: 'Ya usaste los personajes de tu plan. Cada personaje extra cuesta 400 Sakuras IA.', codigo: 'sin_credito' });
      if (r === 'limite_dia') return out(429, { error: 'Llegaste al máximo de intentos de hoy. Probá mañana.', codigo: 'limite_dia' });
    }

    const estiloTxt = String(b.estilo_txt || '').trim().slice(0, 450);
    const est = estiloTxt ? { txt: estiloTxt, color: '', estilo: 'clasico' } : (ESTILOS[estiloApp] || ESTILOS['Manga blanco y negro']);
    const quien = genero === 'Mujer' ? 'a woman' : genero === 'Hombre' ? 'a man' : 'a character';
    const chibi = /chibi|super deformed/i.test(est.txt) || /chibi/i.test(estiloApp);
    // Anclaje de edad: la ficha manda. Adultos siempre con proporciones y cara adultas (evita que parezcan niños).
    const esMenor = (edad > 0 && edad < 18) || MINOR.test(desc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const reglaEdad = esMenor ? (edad ? ' The character is ' + edad + ' years old: age-appropriate look.' : '')
      : (chibi ? '' : ' The character is an ADULT' + (edad >= 18 ? ' (' + edad + ' years old)' : '') + ': adult body proportions, mature adult face, no childlike features, no baby face.');
    // Ropa: personajes comunes = vestidos. Si la ficha pide ropa interior, lencería o traje de baño (solo adultos verificados), se permite sin desnudos. El CEO queda libre.
    const pideSensual = esContenidoAdulto(nombre, desc);
    const claseRopa = ctx.esCeo ? '' : (pideSensual && !esMenor
      ? 'Adult reference sheet: lingerie, underwear or swimwear is allowed, tasteful poses, no nudity, no exposed nipples or genitals. '
      : 'Safe for work reference sheet: the character is fully clothed, neutral relaxed poses, tasteful, no nudity. ');
    const filtroUsuarios = String((await leerConfig(env, 'fal_filtro_usuarios')) ?? '0') !== '0';
    // El texto del usuario (en español) va tal cual; las órdenes de formato van en inglés porque el modelo las obedece mejor.
    const prompt =
      'Professional character design reference sheet of ONE single character (' + quien + '), the SAME person shown in several different poses and views on one image: ' +
      'a large full-body front view standing, a large full-body side view, a full-body back view, a three-quarter view in a relaxed pose, and two close-up portraits (the face and a detail of an accessory). ' +
      'Consistent face, hair, body, outfit and accessories in every view. Neat panel layout on a plain soft neutral background. ' +
      'ABSOLUTELY NO text, no letters, no words, no labels, no captions, no titles, no numbers, no watermark, no logo. ' +
      claseRopa +
      'Art style: ' + est.txt + '. Character "' + nombre + '": ' + desc + '.' + reglaEdad;

    if (escena === 'leonardo') {
      const { id } = await crearGeneracion(env, { prompt, estilo: est.estilo, modelo: 'phoenix', dibujoId: null, personajeId: null, cantidad: 1, colorModo: est.color });
      return out(200, { ok: true, id });
    }
    // Fal: síncrono. El filtro de imágenes de Fal está apagado para el CEO.
    const { imagenes } = await motorImagenes(env, { escena, prompt, w: 832, h: 1248, n: 1, colorModo: est.color, seguro: !ctx.esCeo && filtroUsuarios });
    return out(200, { ok: true, sync: true, imagen: imagenes[0] });
  } catch (e) {
    return out(e instanceof IAError ? e.status : 500, { error: e instanceof IAError ? e.message : 'No se pudo crear el personaje. Probá de nuevo.', codigo: e.codigo || '' });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
