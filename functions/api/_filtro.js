// functions/api/_filtro.js — lista negra de contenido.
// REGLA 1 (nadie se la salta, ni el CEO): NADA sexual con menores. Se detecta por palabras de infancia/colegio,
//   por edades menores de 18 escritas ("16 años") y por palabras ambiguas (chica/chico/estudiante) cuando no hay señal de adulto.
// REGLA 2 (solo usuarios comunes): pornografía/sexo explícito y violencia extrema. El CEO verificado queda exento.
// Todo lo demás para ADULTOS está permitido: curvas, escote, ropa ajustada, "tetas grandes", estilo ecchi/seinen adulto, etc.
import { leerConfig } from './_ia.js';

const sinAcentos = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizar = t => sinAcentos(t)
  .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's')
  .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const MSG = 'No se permite ese contenido en SalaMangaS. Probá describirlo de otra forma.';

// Palabras sexuales / de cuerpo (con un menor, CUALQUIERA de estas bloquea)
const SEXUAL = '(desnud\\w*|sexual\\w*|sexo|porno\\w*|erotic\\w*|ecchi|hentai|sensual\\w*|tetas?|pechos|senos|escote|nalgas|culo|trasero|lenceri\\w*|bikini|calzon\\w*|ropa interior|violar\\w*|violacion|provocativ\\w*|voluptuos\\w*|curvas|ajustad\\w*|entallad\\w*|seduc\\w*)';
// Palabras que NO dejan dudas: es un menor
const MENOR_SEGURO = '(nino|nina|ninos|ninas|ninez|menor|menores|bebe|adolescente|adolescentes|preadolescente|colegial|colegiala|colegiales|colegiala|infantil|criatura|lolita|loli|lolicon|shota|shotacon|jardin de infantes|primaria|secundaria|high ?school|middle ?school|teen|teenager|underage|minor|kid|kids|child|children|little girl|little boy)';
// Palabras ambiguas (pueden ser jóvenes adultos): bloquean con contenido sexual si NO hay señal de adulto
const AMBIGUO = '(chico|chica|chicos|chicas|pibe|piba|pibes|pibas|joven|jovenes|muchacha|muchacho|estudiante|estudiantes|escolar|escuela|colegio|uniforme|girl|boy|student)';
const ADULTO = /\b(adult\w*|mujer|mujeres|hombre|hombres|madura\w*|senora|senor|mayor de edad|mayores de edad|profesora|profesor|maestra|maestro|secretaria|empresaria|doctora|enfermera adulta|18 ?\+|\+ ?18|woman|women|man|men|milf)\b/;

const REGLAS_MENORES = [
  /\b(pedofil\w*|pedo\s?porn\w*|child\s?porn\w*|cp\s?porn\w*|csam)\b/,
  new RegExp('\\b' + MENOR_SEGURO + '\\b.{0,60}\\b' + SEXUAL + '\\b'),
  new RegExp('\\b' + SEXUAL + '\\b.{0,60}\\b' + MENOR_SEGURO + '\\b'),
  // "lolicon" / "shota" solos ya son suficientes
  /\b(lolicon|shotacon|loli|shota)\b/
];
const AMBIGUO_SEXUAL = [
  new RegExp('\\b' + AMBIGUO + '\\b.{0,60}\\b' + SEXUAL + '\\b'),
  new RegExp('\\b' + SEXUAL + '\\b.{0,60}\\b' + AMBIGUO + '\\b')
];
// Para usuarios comunes: explícito y gore
const BASE = [
  /\b(porno|pornografia|pornografico|xxx|hentai explicito|sexo explicito|sexo anal|sexo oral|felacion|penetracion|eyaculacion|orgia|genitales|vagina|pene|verga|chupar la)\b/,
  /\b(gore extremo|desmembr\w*|descuartiz\w*|violacion|violar)\b/
];

// Edades escritas: "16 años", "17 years old"
function edadesEn(texto) {
  const t = sinAcentos(texto), out = [];
  const re = /(\d{1,2})\s*(anos|years?\s*old|yo\b|y\/o|a\.)/g;
  let m; while ((m = re.exec(t))) out.push(Number(m[1]));
  const re2 = /(?:edad|age)\s*[:=]?\s*(\d{1,2})\b/g;
  while ((m = re2.exec(t))) out.push(Number(m[1]));
  return out;
}

export async function filtrar(env, ctx, ...textos) {
  const crudo = textos.filter(Boolean).join(' . ');
  const t = normalizar(crudo);
  if (!t) return null;

  // --- REGLA 1: menores (para TODOS, incluido el CEO) ---
  for (const re of REGLAS_MENORES) if (re.test(t)) return MSG;
  const hayCuerpoSexual = new RegExp('\\b' + SEXUAL + '\\b').test(t);
  if (hayCuerpoSexual) {
    const edades = edadesEn(crudo);
    if (edades.some(e => e < 18)) return MSG;                                   // "16 años" + contenido sexual
    const adulto = ADULTO.test(t) || edades.some(e => e >= 18);
    if (!adulto) for (const re of AMBIGUO_SEXUAL) if (re.test(t)) return MSG;   // "chica con escote" sin señal de adulto
  }

  // --- REGLA 2: solo usuarios comunes ---
  if (ctx && ctx.esCeo) return null;
  for (const re of BASE) if (re.test(t)) return MSG;
  const extra = await leerConfig(env, 'filtro_palabras');   // palabras extra que carga el CEO en config.filtro_palabras (separadas por coma)
  if (extra) for (const w of extra.split(',').map(x => normalizar(x)).filter(x => x.length > 2)) {
    if ((' ' + t + ' ').includes(' ' + w + ' ')) return MSG;
  }
  return null;
}
