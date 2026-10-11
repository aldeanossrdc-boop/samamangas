// functions/api/asistente.js — POST /api/asistente  { tipo: 'sinopsis'|'app'|'historia', mensajes: [...], contexto? }
// UNA sola IA (DeepSeek V4 vía DeepInfra) con 3 personalidades. Solo Súper Pro, Semi Dios y Dios (y el CEO).
import { out } from './_shared.js';
import { IAError, usuarioIA, rpcUsuario } from './_ia.js';
import { diDisponible, diChat } from './_deepinfra.js';
import { filtrar } from './_filtro.js';

const BASE = 'Hablás en español rioplatense (criollo), con calidez y claridad. Respuestas cortas y útiles (máximo ~150 palabras salvo que pidan más). No inventes datos. No generes contenido sexual, ni nada sexual con menores, ni violencia extrema.';
const SYSTEMS = {
  sinopsis: 'Sos el asistente de sinopsis de SalaMangaS. Ayudás a escribir la sinopsis (resumen que invita a leer) de un manga. Si falta información, hacé UNA pregunta corta (género, protagonista, conflicto). Cuando tengas lo suficiente, entregá la sinopsis lista para copiar, de 300 a 500 caracteres, sin spoilers del final, y ofrecé variantes ("más dramática", "más corta"). ' + BASE,
  historia: 'Sos el asistente de historias de SalaMangaS. Ayudás a crear tramas, personajes, conflictos, escenas y diálogos para manga: estructura en 3 actos, giros, motivaciones, nombres, descripciones visuales para dibujar. Proponé 2 o 3 opciones y preguntá cuál sigue. Si te piden diálogos, escribilos con formato de guion corto. ' + BASE,
  app: 'Sos el asistente de ayuda de SalaMangaS. Explicás cómo usar la app en criollo, paso a paso. Datos reales: ' +
    '• Mangas: se leen, se puede seguir a los creadores y comentar; leer capítulos usa Sakuras 🪙. ' +
    '• Muro (deslizar de costado desde Mangas): historias de 24 h (foto) y publicaciones (hasta 10 por día, 500 caracteres); ❤️ y 💬. Tocar un nombre abre el perfil. ' +
    '• Crear: Página por página, PDF, Subir dibujos a lápiz (la IA convierte tu dibujo en manga limpio, 1 imagen, gasta 1 generación) y SalaMangaS IA (genera 2 imágenes verticales desde texto, gasta 1 generación). ' +
    '• Sakuras 🪙: sirven para leer, crear capítulos/PDF y comprar temas del chat; se ganan con el bono diario (200), referidos y regalos, o se compran. ' +
    '• Sakuras IA 🔴: solo para la IA; no se ganan gratis, se compran (packs de 5, 15, 25 y 50) y se acumulan; se usan cuando se acaban las generaciones del plan; un personaje extra cuesta 2 Sakuras IA. ' +
    '• Planes: Gratis (sin IA), Pro (20 generaciones por mes y 5 personajes de por vida), Súper Pro (50 y 7, con asistente), Semi Dios (100 y 10, asistente con historial descargable), Dios (200 y 15, historial guardado automático). Las generaciones del plan se renuevan cada mes y no se acumulan; los personajes se crean una sola vez en la vida. ' +
    '• Mis personajes: se pueden subir con foto o crear con IA (✨), editar, y se muestran en el perfil público con likes; se pueden elegir hasta 3 por generación. ' +
    '• Perfil: bio, redes (TikTok, Instagram, Facebook), seguidores, publicaciones e historias. ' +
    'Si no estás seguro de algo, decilo y sugerí escribirle al equipo de SalaMangaS. ' + BASE
};

const limpiar = arr => (Array.isArray(arr) ? arr : []).slice(-14)
  .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
  .map(m => ({ role: m.role, content: m.content.trim().slice(0, 1500) }));

export async function onRequestPost({ request, env }) {
  try {
    const ctx = await usuarioIA(request, env);
    if (!ctx) return out(401, { error: 'Iniciá sesión para usar el asistente' });
    if (!diDisponible(env)) return out(503, { error: 'El asistente todavía no está disponible.' });
    const b = await request.json().catch(() => ({}));
    const tipo = SYSTEMS[b.tipo] ? b.tipo : null;
    if (!tipo) return out(400, { error: 'Asistente inválido' });
    const mensajes = limpiar(b.mensajes);
    if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return out(400, { error: 'Escribí tu consulta' });
    const bloqueo = await filtrar(env, ctx, mensajes[mensajes.length - 1].content);
    if (bloqueo) return out(400, { error: bloqueo, codigo: 'filtro' });
    if (!ctx.esCeo) {
      const a = await rpcUsuario(env, ctx.token, 'asistente_acceso', {});
      if (!a || a.permitido !== true) {
        const lim = a && a.codigo === 'limite';
        return out(lim ? 429 : 403, { error: lim ? 'Llegaste al máximo de mensajes de hoy con el asistente. Seguí mañana.' : 'El asistente está disponible desde Súper Mangakers Pro.', codigo: lim ? 'limite' : 'plan' });
      }
    }
    const contexto = String(b.contexto || '').trim().slice(0, 800);
    const system = SYSTEMS[tipo] + (contexto ? '\n\nContexto actual del usuario: ' + contexto : '');
    const respuesta = await diChat(env, { system, mensajes, max_tokens: tipo === 'app' ? 500 : 700 });
    return out(200, { ok: true, respuesta });
  } catch (e) {
    return out(e instanceof IAError ? e.status : 500, { error: e instanceof IAError ? e.message : 'El asistente no pudo responder. Probá de nuevo.', codigo: e.codigo || '' });
  }
}
export const onRequestGet = () => out(405, { error: 'Usar POST' });
