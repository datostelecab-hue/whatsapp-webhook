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
           -- La hora del apunte de BOLT que abrió el tramo. Es lo que deja
           -- compararlo con el apunte crudo y quedarse con el más reciente.
           a.desde                                                   AS desde_tramo,
           a.conductor, a.telefono,
           a.segundos                                                AS segundos_situacion,
           a.km,
           v.sede,
           -- ── LA SITUACIÓN EN CRUDO, SIN PASAR POR LOS TRAMOS ──────────────
           -- La tabla bolt_state_log es tonta: un apunte por cambio de
           -- estado, tal y como lo manda BOLT, y la escribe la ingesta cada 10
           -- minutos. Los TRAMOS los construye el motor de Flota viva, que hace
           -- mucho más —km, franjas, odómetro, rutas— y por eso se rompe más:
           -- el 23/09/2026 estuvo dos horas sin terminar una vuelta y el mapa
           -- acusó de "rueda sin nadie" a gente que estaba de viaje.
           --
           -- Para la pregunta del mapa —¿hay alguien conectado con este
           -- coche?— no hace falta un tramo: basta el ÚLTIMO APUNTE. Así el
           -- semáforo se apoya en la tubería tonta, que es la que aguanta.
           eb.situacion                                              AS situacion_cruda,
           cru.ocurrido_at                                           AS crudo_at,
           cc.nombre                                                 AS conductor_crudo,
           cc.telefono                                               AS telefono_crudo,
           -- En qué estado está el coche para la casa. Sirve para leer un gris:
           -- uno "En taller" lleva días callado y es normal; uno "Operativo"
           -- callado tres meses es un equipo que hay que ir a mirar.
           ev.etiqueta                                               AS estado_vehiculo,
           ev.es_operativo                                           AS coche_operativo
      FROM fv_posicion p
      JOIN vehiculo v ON v.matricula = p.matricula AND v.baja_at IS NULL
      LEFT JOIN fv_ahora a ON a.mapon_unit = p.mapon_unit
      LEFT JOIN cat_estado_vehiculo ev ON ev.codigo = v.estado_operativo
      LEFT JOIN fv_vehiculo fvv ON fvv.matricula = p.matricula
      -- Doce horas de ventana: más que un turno largo. Lo que no tenga un
      -- apunte en doce horas es que no lo lleva nadie, y eso ya lo dice el NULL.
      LEFT JOIN LATERAL (
        SELECT l.estado, l.ocurrido_at, l.driver_uuid
          FROM bolt_state_log l
         WHERE l.vehiculo_uuid = fvv.uuid
           AND l.ocurrido_at > now() - interval '12 hours'
         ORDER BY l.ocurrido_at DESC
         LIMIT 1) cru ON TRUE
      LEFT JOIN fv_estado_bolt eb ON eb.estado = cru.estado
      LEFT JOIN fv_conductor cc ON cc.uuid = cru.driver_uuid
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
           -- LA OTRA MITAD DEL MAPA, y la que se cae en silencio. La posición se
           -- refresca cada 30 s; lo de BOLT entra por DOS tuberías distintas y
           -- basta con que una vaya al día:
           --
           --   la ingesta   cada 10 min, escribe bolt_state_log. Tonta y dura.
           --   el motor     cada  5 min, construye los tramos. Listo y frágil.
           --
           -- Se mira la MÁS FRESCA de las dos. Si las dos van viejas, lo que
           -- sabemos de BOLT es viejo y el mapa tiene que decirlo en vez de
           -- acusar a nadie: el 23/09/2026 el motor estuvo dos horas parado y la
           -- pantalla siguió pareciendo viva porque los puntos sí se movían.
           LEAST(
             (SELECT EXTRACT(EPOCH FROM (now() - max(empezada_at)))::int
                FROM ingesta_ejecucion WHERE tarea = 'state_logs_bolt' AND ok),
             (SELECT EXTRACT(EPOCH FROM (now() - max(terminada_at)))::int
                FROM fv_vuelta WHERE error IS NULL))                     AS bolt_hace,
           count(*) FILTER (WHERE v.id IS NOT NULL
                              AND ($1::varchar[] IS NULL
                                   OR v.sede = ANY($1::varchar[])))::int AS dentro,
           count(*) FILTER (WHERE v.id IS NULL)::int                     AS sin_ficha,
           count(*) FILTER (WHERE v.id IS NOT NULL
                              AND $1::varchar[] IS NOT NULL
                              AND NOT (v.sede = ANY($1::varchar[])))::int AS otra_sede
      FROM fv_posicion p
      LEFT JOIN vehiculo v ON v.matricula = p.matricula AND v.baja_at IS NULL`, [filtro]);
  return r.rows[0] || { refrescado_at: null, hace: null, bolt_hace: null, dentro: 0, sin_ficha: 0, otra_sede: 0 };
}

module.exports = { coches, frescura };
