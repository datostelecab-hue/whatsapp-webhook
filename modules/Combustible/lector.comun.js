// ============================================================
// COMBUSTIBLE · LO QUE COMPARTEN LOS LECTORES DE CORREO
// ============================================================
// Puro: ni base, ni red. Pasar un correo a texto, leer un número escrito a la
// española o a la inglesa, una fecha dd/mm/aaaa hh:mm y las líneas «Etiqueta:
// valor» de un correo. Cada proveedor (lector.ballenoil.js, lector.petroprix.js)
// dice QUÉ etiquetas busca; el CÓMO está aquí una sola vez.
//
// POR QUÉ SE LEE TEXTO Y NO EL HTML. El correo de Ballenoil trae dos partes, y
// la que se llama «text/plain» es también HTML; el que reenvía alguien de la
// oficina desde Outlook trae un text/plain de verdad y un HTML de Word. Lo único
// que se parece en los tres es el texto que se ve, así que todo pasa por texto
// antes de leerse. Ese texto se guarda para enseñarlo (repostaje.cuerpo_texto),
// pero para RELEER se guardan las partes tal cual llegaron
// (repostaje.cuerpo_partes): si lo que falla un día es esta conversión, el
// texto ya convertido no serviría para arreglarlo.

const { INVISIBLES } = require('../../services/nucleo');
const { sinCortes } = require('../../services/dkim');

// ── EL TEXTO DEL CORREO ─────────────────────────────────────────────────────

const ENTIDADES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euro: '€',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  agrave: 'à', egrave: 'è', ograve: 'ò', ccedil: 'ç', Ccedil: 'Ç', ordm: 'º', ordf: 'ª',
  iexcl: '¡', iquest: '¿', laquo: '«', raquo: '»', acute: '´', middot: '·', ndash: '–', mdash: '—',
};

function entidades(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; })
    .replace(/&#(\d+);/g, (m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; })
    .replace(/&([a-z]+);/gi, (m, k) => (k in ENTIDADES ? ENTIDADES[k] : m));
}

/** ¿Esto es HTML? El «text/plain» de Ballenoil lo es. */
const pareceHtml = s => /<(html|body|br|p|div|table|td|h\d)\b/i.test(String(s || ''));

/**
 * Del HTML al texto que se ve: un salto donde el navegador pondría uno.
 *
 * Ballenoil escribe los saltos de cuatro maneras en el mismo correo —`<br />`,
 * `<br/>`, `<br / >` y hasta `</br>`—, así que el patrón las coge todas, y
 * también las que llevan atributos (`<br style=…>`, `<BR clear=all>`). Si un
 * día cambian las etiquetas, lo que no cambia es que cada dato va en su línea,
 * y si ni eso, el lector corta también por la etiqueta siguiente.
 *
 * El resto de etiquetas se cambian por un ESPACIO, no por nada: borrarlas
 * pegaba las palabras («Muntean</span>Matrícula:» quedaba «MunteanMatrícula:»)
 * y la etiqueta pegada a otra palabra ya no se encontraba. Los espacios de más
 * los junta limpiarTexto.
 */
function htmlATexto(html) {
  const t = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?br\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|tr|table|tbody|thead|li|ul|ol|center|blockquote|section|article|header|footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return limpiarTexto(entidades(t));
}

/**
 * Saltos de línea de un solo tipo, sin invisibles ni espacios colgando. Sin el
 * carácter nulo tampoco: PostgreSQL no lo acepta en un texto y rechazaría el
 * correo entero por un byte perdido.
 */
function limpiarTexto(t) {
  return String(t || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(INVISIBLES, '')
    .replace(/[ \t]/g, ' ')
    .split('\n').map(l => l.replace(/ {2,}/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Los textos que se pueden leer de un correo, del mejor al peor: el text/plain
 * (pasado por htmlATexto si es HTML disfrazado, como el de Ballenoil) y, detrás,
 * el text/html. El lector prueba en ese orden y se queda con el primero que
 * entiende: si el text/plain fuera un «este correo necesita HTML», el dato
 * estaría en el otro.
 *
 * `partes`: [{ tipo: 'text/plain' | 'text/html', contenido }]
 */
function textosDe(partes) {
  const out = [];
  // Las líneas de más de 990 caracteres llegan partidas con «!», salto y un
  // espacio: lo hace un servidor del camino DESPUÉS de que Ballenoil firme (su
  // pie legal se lee «comerciale! s»; ver services/dkim). Se deshace antes de
  // leer: si un día el correo entero viniera en una línea, el corte podría caer
  // en mitad de un importe.
  const contenido = p => sinCortes(String(p.contenido).replace(/\r?\n/g, '\r\n'));
  const plano = (partes || []).filter(p => p && p.tipo === 'text/plain' && p.contenido);
  const html = (partes || []).filter(p => p && p.tipo === 'text/html' && p.contenido);
  for (const p of plano) out.push(pareceHtml(p.contenido) ? htmlATexto(contenido(p)) : limpiarTexto(contenido(p)));
  for (const p of html) out.push(htmlATexto(contenido(p)));
  // Las líneas citadas de un reenvío («> Matrícula: …») se leen sin la marca.
  return [...new Set(out.map(t => t.replace(/^(?:> ?)+/gm, '')).filter(t => t.trim()))];
}

// ── LOS VALORES ─────────────────────────────────────────────────────────────

/**
 * Un número escrito como sea: «47,43€», «2.57€», «33€», «1.234,56 €», «27,432L».
 *
 * EL MISMO CORREO MEZCLA LOS DOS DECIMALES: los importes van con coma y el
 * «devuelto a su saldo» con punto («2.57€»). La regla: si hay coma y punto, el
 * último es el decimal y el otro separa miles; si solo hay uno de los dos, es el
 * decimal. No hay repostaje de mil euros ni de mil litros, así que «1.234» no
 * aparece; si un día apareciera, se leería 1,234 y el aviso de €/litro lo cantaría.
 */
function numero(txt) {
  const m = /-?\d[\d.,]*/.exec(String(txt == null ? '' : txt).replace(/\s+/g, ''));
  if (!m) return null;
  let s = m[0].replace(/[.,]+$/, '');
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    const dec = Math.max(coma, punto);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else if (coma >= 0 || punto >= 0) {
    const sep = coma >= 0 ? ',' : '.';
    const trozos = s.split(sep);
    // «1.234.567» o «1,234,567»: varios del mismo, separan miles.
    s = trozos.length > 2 ? trozos.join('') : trozos.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Un entero, con o sin puntos de miles: «270500», «270.500». */
function entero(txt) {
  const m = /\d[\d.\s]*/.exec(String(txt == null ? '' : txt));
  if (!m) return null;
  const n = Number(m[0].replace(/[.\s]/g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * «22/10/2026 06:49» → '2026-10-22T06:49', la hora de Madrid SIN zona.
 *
 * Sin zona a propósito: el correo dice la hora de aquí, y quien la guarda la
 * interpreta en Madrid (`::timestamp AT TIME ZONE 'Europe/Madrid'`). Pasarla
 * por un Date de JavaScript la movería según el huso del servidor, que en
 * Render es UTC: dos horas de golpe en verano. Ver «Trampas conocidas».
 *
 * SIN HORA NO HAY FECHA Y HORA. «22/10/2026» a secas devuelve null: leerla como
 * las 00:00 ponía el repostaje a medianoche, BOLT se miraba a esa hora y se
 * comparaba la tarjeta con quien no era. El día solo, con `fecha`.
 */
function fechaHora(txt) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})[^\d]+(\d{1,2})[:.h](\d{2})/.exec(String(txt || ''));
  if (!m) return null;
  const dia = fecha(m[0]);
  const hh = Number(m[4]), mn = Number(m[5]);
  if (!dia || hh > 23 || mn > 59) return null;
  const p = n => String(n).padStart(2, '0');
  return `${dia}T${p(hh)}:${p(mn)}`;
}

/** «22/10/2026» → '2026-10-22', o null si ese día no existe (un 31/02 no). */
function fecha(txt) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(txt || ''));
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), a = Number(m[3]);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  const prueba = new Date(Date.UTC(a, mm - 1, dd));
  if (prueba.getUTCMonth() !== mm - 1) return null;
  const p = n => String(n).padStart(2, '0');
  return `${a}-${p(mm)}-${p(dd)}`;
}

/** La matrícula como la guarda Vehículos: sin espacios ni guiones, en mayúsculas. */
const matricula = txt => String(txt || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Las direcciones de correo que aparecen en un texto, en minúsculas. */
const correosEn = txt => (String(txt || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(x => x.toLowerCase());

// ── LAS LÍNEAS «ETIQUETA: VALOR» ────────────────────────────────────────────

// Una etiqueta escrita como patrón que no distingue tildes ni espacios: así
// «Matrícula», «Matricula» y «MATRÍCULA  :» son la misma.
const TILDES = { a: '[aáàä]', e: '[eéèë]', i: '[iíìï]', o: '[oóòö]', u: '[uúùü]', n: '[nñ]' };
const patronDe = etiqueta => etiqueta.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split('').map(c => (TILDES[c] || (/\s/.test(c) ? '\\s+' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).join('');

/**
 * Busca las etiquetas en el texto y devuelve { campo: valor en crudo }.
 *
 * `campos`: [{ campo, etiqueta }]. Se busca la etiqueta seguida de «:», empiece
 * donde empiece la línea. El valor es lo que hay detrás hasta el final de la
 * línea o hasta la etiqueta siguiente, lo que llegue antes: si un día el correo
 * pierde los saltos de línea, cada dato se sigue cortando en su sitio. Si la
 * etiqueta se queda sola en su línea y el valor va en la de debajo —justo antes
 * de la etiqueta siguiente—, también vale.
 *
 * Cuenta la PRIMERA vez que sale cada etiqueta.
 */
function etiquetas(texto, campos) {
  const lista = [...campos].sort((a, b) => b.etiqueta.length - a.etiqueta.length);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${lista.map(c => patronDe(c.etiqueta)).join('|')})\\s*:`, 'giu');
  const marcas = [];
  for (const m of String(texto || '').matchAll(re)) {
    const c = lista.find(x => new RegExp(`^${patronDe(x.etiqueta)}$`, 'iu').test(m[1]));
    if (c) marcas.push({ campo: c.campo, ini: m.index, fin: m.index + m[0].length });
  }
  const out = {};
  marcas.forEach((m, i) => {
    if (m.campo in out) return;
    const hasta = i + 1 < marcas.length ? marcas[i + 1].ini : texto.length;
    const resto = texto.slice(m.fin, hasta).replace(/^[ \t]+/, '');
    let valor = resto.split('\n')[0].trim();
    if (!valor) {
      const lineas = resto.split('\n').map(l => l.trim()).filter(Boolean);
      if (lineas.length === 1 && i + 1 < marcas.length) valor = lineas[0];
    }
    out[m.campo] = valor;
  });
  return out;
}

module.exports = {
  pareceHtml, htmlATexto, limpiarTexto, textosDe,
  numero, entero, fechaHora, fecha, matricula, correosEn, etiquetas,
};
