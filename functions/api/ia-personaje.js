// functions/api/ia-personaje.js  ·  POST /api/ia-personaje  { nombre, descripcion, estilo, genero }
// Crea la HOJA DE PERSONAJE con Leonardo (Phoenix, el modelo barato): UNA imagen con el mismo personaje en distintas
// posturas (frente, perfil, espalda, retrato y detalle), SIN textos. Es asíncrono: devuelve { id } y la app consulta
// /api/ia-estado?id=... hasta que esté lista. NO guarda nada ni descuenta el cupo: el cupo se descuenta recién cuando
// el usuario ACEPTA el personaje (así puede regenerar sin gastar).
import { out, getServiceClient } from './_shared.js';
import { IAError, usuarioIA, rpcUsuario, crearGeneracion } from './_ia.js';
import { filtrar, esContenidoAdulto } from './_filtro.js';

// Estilos de la app -> texto para el modelo + color + estilo de Leonardo
const ESTILOS = {
  'Manga blanco y negro': { txt: 'black and white manga style, clean ink lines, screentones',              color: 'B/N',   estilo: 'clasico' },
  'Anime a color':        { txt: 'colorful anime style, clean lineart, soft cel shading',                    color: 'Color', estilo: 'clasico' },
  'Chibi':                { txt: 'cute chibi style, big head, small body, colorful',                         color: 'Color', estilo: 'chibi' },
  'Dark fantasy':         { txt: 'dark fantasy illustration style, dramatic lighting, detailed, colorful',   color: 'Color', estilo: 'dark' },
  'Realista':             { txt: 'semi-realistic illustration style, detailed shading, natural proportions', color: 'Color', estilo: 'realista' }
};

export async function onRequestPost({ request, env }) {
  try {
    const ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para crear personajes' });
    if (!env.LEONARDO_API_KEY) {
      console.error('Falta LEONARDO_API_KEY en Cloudflare');
      return out(503, { error: 'Crear personajes con IA todavía no está disponible.' });
    }
    const b = await request.json().catch(() => ({}));
    const nombre = String(b.nombre || '').trim().slice(0, 60);
    const desc = String(b.descripcion || '').trim().slice(0, 900);
    const estiloApp = String(b.estilo || 'Manga blanco y negro').trim().slice(0, 60);
    const genero = String(b.genero || '').trim().slice(0, 20);
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
      if (r === 'sin_credito') return out(402, { error: 'Ya usaste los personajes de tu plan. Cada personaje extra cuesta 2 Sakuras IA.', codigo: 'sin_credito' });
      if (r === 'limite_dia') return out(429, { error: 'Llegaste al máximo de intentos de hoy. Probá mañana.', codigo: 'limite_dia' });
    }

    // La app manda el texto del estilo elegido (los mismos 24 estilos de toda la app). Si no llega, se usa el de la lista vieja.
    const estiloTxt = String(b.estilo_txt || '').trim().slice(0, 450);
    const est = estiloTxt ? { txt: estiloTxt, color: '', estilo: 'clasico' } : (ESTILOS[estiloApp] || ESTILOS['Manga blanco y negro']);
    const quien = genero === 'Mujer' ? 'a woman' : genero === 'Hombre' ? 'a man' : 'a character';
    // El texto del usuario (en español) va tal cual; las órdenes de formato van en inglés porque el modelo las obedece mejor.
    const prompt =
      'Professional character design reference sheet of ONE single character (' + quien + '), the SAME person shown in several different poses and views on one image: ' +
      'a large full-body front view standing, a large full-body side view, a full-body back view, a three-quarter view in a relaxed pose, and two close-up portraits (the face and a detail of an accessory). ' +
      'Consistent face, hair, body, outfit and accessories in every view. Neat panel layout on a plain soft neutral background. ' +
      'ABSOLUTELY NO text, no letters, no words, no labels, no captions, no titles, no numbers, no watermark, no logo. ' +
      (ctx.esCeo ? '' : 'Safe for work reference sheet: the character is fully clothed, neutral relaxed poses, tasteful, no nudity. ') +
      'Art style: ' + est.txt + '. Character "' + nombre + '": ' + desc;

    const { id } = await crearGeneracion(env, { prompt, estilo: est.estilo, modelo: 'phoenix', dibujoId: null, personajeId: null, cantidad: 1, colorModo: est.color });
    return out(200, { ok: true, id });
  } catch (e) {
    return out(e instanceof IAError ? e.status : 500, { error: e instanceof IAError ? e.message : 'No se pudo crear el personaje. Probá de nuevo.', codigo: e.codigo || '' });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
