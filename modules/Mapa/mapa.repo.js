// ============================================================
// MAPA — consultas contra PostgreSQL
// ============================================================
// El mapa no llama a Mapon ni a BOLT: lee de la base, como todas las pantallas.
// Quien habla con fuera es la vuelta de `services/flotaViva/posiciones`, y esa
// es la única puerta por la que entra la posición.
//
// LAS DOS MITADES DEL MAPA YA EXISTÍAN POR SEPARADO:
//
//   · DÓNDE está el coche  → `fv_posicion`, que es lo único nuevo.
//   · QUIÉN lo lleva y en qué está en BOLT → `fv_ahora`, que ya daba la
//     situación (viaje / espera / descanso / desconectado), el conductor, su
//     teléfono, los km del tramo y hasta el color de la casa.
//
// Juntarlas es un LEFT JOIN por `mapon_unit`. Nada de esto se copia ni se
// recalcula aquí.

const db = require('../../services/db');

/**
 * Los coches de la flota que el GPS sabe situar, con lo que BOLT dice de cada
 * uno.
 *
 * SOLO LOS COCHES DE LA CASA, Y SOLO DE LAS SEDES QUE SE PIDEN.
 *
 * La primera versión pintaba las 108 unidades que devuelve la cuenta de Mapon,
 * y eso incluía catorce que no son coches del ERP —equipos de otra cosa,
 * matrículas que nunca se dieron de alta, hasta un `1159283703`— más los de
 * Barcelona. Con casi treinta puntos que no son tuyos, los que sí lo son dejan
 * de verse. Por eso el JOIN con `vehiculo` es INNER y no LEFT.
 *
 * Lo que se pierde a cambio: un equipo rodando que no casa con ningún coche del
 * maestro deja de salir. Se cuentan aparte (`fuera`) y se dicen en la cinta,
 * para que desaparezcan a la vista y no en silencio.
 *
 * `antiguedad` y `rodandoDesde` los calcula la BASE y no el navegador: el reloj
 * del que mira puede ir mal, y de ellos depende que un coche se pinte apagado o
 * que suene un aviso.
 */
async function coches(sedes) {
  const filtro = Array.isArray(sedes) && sedes.length ? sedes : null;
  const r = await db.consulta(`
    SELECT p.mapon_unit, v.matricula,
           p.lat, p.lng, p.velocidad, p.rumbo, p.estado_mapon,
           EXTRACT(EPOCH FROM (now() - p.visto_at))::int             AS antiguedad,
           EXTRACT(EPOCH FROM (now() - p.estado_desde))::int         AS lleva_asi,
           a.situacion, a.situacion_etiqueta, a.conectado,
           a.conductor, a.telefono,
           a.segundos                                                AS segundos_situacion,
           a.km,
           v.sede,
           -- En qué estado está el coche para la casa. Sirve para leer un gris:
           -- uno "En taller" lleva días callado y es normal; uno "Operativo"
           -- callado tres meses es un equipo que hay que ir a mirar.
           ev.etiqueta                                               AS estado_vehiculo,
           ev.es_operativo                                           AS coche_operativo
      FROM fv_posicion p
      JOIN vehiculo v ON v.matricula = p.matricula AND v.baja_at IS NULL
      LEFT JOIN fv_ahora a ON a.mapon_unit = p.mapon_unit
      LEFT JOIN cat_estado_vehiculo ev ON ev.codigo = v.estado_operativo
     WHERE ($1::varchar[] IS NULL OR v.sede = ANY($1::varchar[]))
     ORDER BY v.matricula`, [filtro]);
  return r.rows;
}

/**
 * Cuándo se refrescó por última vez y cuántas unidades se quedan fuera.
 *
 * Las de fuera se cuentan para poder DECIRLO. Un mapa que enseña 88 de 106
 * equipos sin avisar es un mapa en el que un día falta un coche y nadie sabe
 * por qué.
 */
async function frescura(sedes) {
  const filtro = Array.isArray(sedes) && sedes.length ? sedes : null;
  const r = await db.consulta(`
    SELECT max(p.refrescado_at)                                        AS refrescado_at,
           EXTRACT(EPOCH FROM (now() - max(p.refrescado_at)))::int      AS hace,
           count(*) FILTER (WHERE v.id IS NOT NULL
                              AND ($1::varchar[] IS NULL
                                   OR v.sede = ANY($1::varchar[])))::int AS dentro,
           count(*) FILTER (WHERE v.id IS NULL)::int                     AS sin_ficha,
           count(*) FILTER (WHERE v.id IS NOT NULL
                              AND $1::varchar[] IS NOT NULL
                              AND NOT (v.sede = ANY($1::varchar[])))::int AS otra_sede
      FROM fv_posicion p
      LEFT JOIN vehiculo v ON v.matricula = p.matricula AND v.baja_at IS NULL`, [filtro]);
  return r.rows[0] || { refrescado_at: null, hace: null, dentro: 0, sin_ficha: 0, otra_sede: 0 };
}

module.exports = { coches, frescura };
