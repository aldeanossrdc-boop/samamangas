// functions/api/_filtro.js — lista negra de contenido. Aplica SOLO a usuarios comunes: el CEO verificado queda exento.
// (Los filtros propios de DeepInfra y de los modelos no se pueden saltar: los maneja DeepInfra.)
import { leerConfig } from './_ia.js';

const normalizar = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's')
  .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// 1) Contenido sexual con menores: bloqueo SIEMPRE (también para el CEO). 2) Pornografía explícita y 3) violencia extrema: solo usuarios comunes.
const MENORES = [
  /\b(loli|lolicon|shota|shotacon|pedofil\w*|pedo\s?porn\w*|child\s?porn\w*|cp\s?porn\w*)\b/,
  /\b(nino|nina|ninos|ninas|menor|menores|bebe|chico|chica|adolescente|colegial\w*)\b.{0,40}\b(desnud\w*|sexual\w*|sexo|porno\w*|violar\w*|violacion)\b/,
  /\b(desnud\w*|sexual\w*|sexo|porno\w*)\b.{0,40}\b(nino|nina|ninos|ninas|menor|menores|bebe|adolescente|colegial\w*)\b/
];
const BASE = [
  /\b(porno|pornografia|pornografico|xxx|hentai explicito|sexo explicito|sexo anal|sexo oral|felacion|penetracion|eyaculacion|orgia)\b/,
  /\b(gore extremo|desmembr\w*|descuartiz\w*|violacion|violar)\b/
];

const MSG = 'No se permite ese contenido en SalaMangaS. Probá describirlo de otra forma.';

export async function filtrar(env, ctx, ...textos) {
  const t = normalizar(textos.filter(Boolean).join(' . '));
  if (!t) return null;
  for (const re of MENORES) if (re.test(t)) return MSG;       // nadie se salta esto, ni el CEO
  if (ctx && ctx.esCeo) return null;                          // el CEO verificado queda exento del resto de la lista
  for (const re of BASE) if (re.test(t)) return MSG;
  const extra = await leerConfig(env, 'filtro_palabras');   // palabras extra que carga el CEO en config.filtro_palabras (separadas por coma)
  if (extra) for (const w of extra.split(',').map(x => normalizar(x)).filter(x => x.length > 2)) {
    if ((' ' + t + ' ').includes(' ' + w + ' ')) return MSG;
  }
  return null;
}
