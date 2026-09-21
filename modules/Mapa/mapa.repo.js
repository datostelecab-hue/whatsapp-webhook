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
 * Todos los coches que el GPS sabe situar, con lo que BOLT dice de cada uno.
 *
 * MANDA LA POSICIÓN, NO EL ESTADO. El FROM es `fv_posicion` y `fv_ahora` entra
 * por LEFT JOIN, y no al revés. Si fuera al revés desaparecerían justo los que
 * hay que mirar: un equipo que rueda y no casa con ningún coche de BOLT no
 * tiene fila en `fv_ahora`. Medido el 21/09/2026: de 108 unidades, 14 no eran
 * coches del ERP y cinco estaban en marcha.
 *
 * `antiguedad` son los segundos desde que habló el equipo, calculados por la
 * base y no por el navegador: el reloj del que mira puede ir mal, y de eso
 * depende que un coche se pinte encendido o apagado.
 */
async function coches() {
  const r = await db.consulta(`
    SELECT p.mapon_unit,
           COALESCE(a.matricula, p.matricula)                  AS matricula,
           p.lat, p.lng, p.velocidad, p.rumbo, p.estado_mapon,
           EXTRACT(EPOCH FROM (now() - p.visto_at))::int        AS antiguedad,
           a.situacion, a.situacion_etiqueta, a.conectado, a.color,
           a.conductor, a.telefono,
           a.segundos                                          AS segundos_situacion,
           a.km,
           -- Si no está en el maestro de coches, no es de la flota: o es un
           -- equipo de otra cosa, o una matrícula que nunca se dio de alta.
           (v.id IS NOT NULL)                                   AS de_la_flota,
           v.sede
      FROM fv_posicion p
      LEFT JOIN fv_ahora a ON a.mapon_unit = p.mapon_unit
      LEFT JOIN vehiculo v ON v.matricula = COALESCE(a.matricula, p.matricula)
                          AND v.baja_at IS NULL
     ORDER BY COALESCE(a.matricula, p.matricula)`);
  return r.rows;
}

/** Cuándo se refrescó por última vez, para poder decirlo en pantalla. */
async function frescura() {
  const r = await db.consulta(`
    SELECT max(refrescado_at) AS refrescado_at,
           count(*)::int      AS unidades,
           EXTRACT(EPOCH FROM (now() - max(refrescado_at)))::int AS hace
      FROM fv_posicion`);
  return r.rows[0] || { refrescado_at: null, unidades: 0, hace: null };
}

module.exports = { coches, frescura };
