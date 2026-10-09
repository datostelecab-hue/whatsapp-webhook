// ============================================================
// LO QUE CABE EN CADA COLUMNA DE TEXTO
// ============================================================
// Pasarse del largo de una columna (`varchar(10)`) daba el error de PostgreSQL
// tal cual, en inglés y sin decir cuál: «value too long for type character
// varying(10)». Lo vio Mercedes el 09/10/2026 rellenando los datos de una
// candidata en Selección, y no había forma de saber qué casilla era.
//
// Los largos se leen de la propia base, una vez por proceso y tabla: así no hay
// una lista escrita a mano que se quede vieja el día que una migración amplíe
// una columna.

const db = require('../db');

const memo = new Map();   // tabla → Map(columna → largo máximo)

/** Map(columna → largo máximo) de las columnas de texto con tope de esa tabla. */
async function de(tabla) {
  if (!memo.has(tabla)) {
    memo.set(tabla, db.consulta(
      `SELECT column_name, character_maximum_length AS max
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
          AND character_maximum_length IS NOT NULL`, [tabla])
      .then(r => new Map(r.rows.map(x => [x.column_name, Number(x.max)])))
      .catch(e => { memo.delete(tabla); throw e; }));
  }
  return memo.get(tabla);
}

/** Los que no caben: [{ columna, max, largo, valor }]. Pura, para las pruebas. */
function sobran(valores, largos) {
  return Object.entries(valores || {})
    .filter(([k, v]) => typeof v === 'string' && largos.has(k) && v.length > largos.get(k))
    .map(([k, v]) => ({ columna: k, max: largos.get(k), largo: v.length, valor: v }));
}

/** El mensaje para quien lo escribió: qué casilla, cuánto cabe y qué ha puesto. */
function mensaje(malos, etiquetaDe = k => k) {
  return malos.map(m =>
    `«${etiquetaDe(m.columna)}» admite como mucho ${m.max} caracteres y «${m.valor}» tiene ${m.largo}: abrévialo`)
    .join(' · ');
}

/**
 * Lanza, con un mensaje que se entiende, si algún valor no cabe en su columna.
 * `etiquetaDe(columna)` da el nombre que ve la pantalla.
 */
async function comprobar(tabla, valores, etiquetaDe) {
  const malos = sobran(valores, await de(tabla));
  if (malos.length) throw new Error(mensaje(malos, etiquetaDe));
}

module.exports = { de, sobran, mensaje, comprobar };
