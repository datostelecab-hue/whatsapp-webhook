// ============================================================
// MAPA — consultas contra PostgreSQL
// ============================================================
// El mapa no llama a Mapon ni a BOLT: lee de la base, como todas las pantallas.
// Quien habla con fuera es la vuelta de `services/flotaViva/posiciones`, y esa
// es la única puerta por la que entra la posición.
//
// LAS DOS MITADES DEL MAPA:
//
//   · DÓNDE está el coche  → `fv_posicion`: esta consulta.
//   · QUIÉN lo lleva y en qué está en BOLT → la FOTO DEL AHORA
//     (services/flotaViva/ahora.js), la misma que lee En directo de Control.
//     Hasta el 25/09/2026 esa mitad se calculaba también aquí, con su propia
//     copia de la regla, y el mapa y Control decían cosas distintas del mismo
//     conductor. Se cruzan en el servicio, por matrícula.

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
    SELECT p.mapon_unit, v.matricula, v.id AS vehiculo_id,
           -- Si Mapon conoce el equipo del coche aunque no de posicion. Es lo
           -- que separa "no hay NADA en Mapon" de "Mapon no dice donde esta".
           fvv.mapon_unit                                            AS unidad_conocida,
           p.lat, p.lng, p.velocidad, p.rumbo, p.estado_mapon,
           EXTRACT(EPOCH FROM (now() - p.visto_at))::int             AS antiguedad,
           EXTRACT(EPOCH FROM (now() - p.estado_desde))::int         AS lleva_asi,
           v.sede,
           -- En qué estado está el coche para la casa. Sirve para leer un gris:
           -- uno "En taller" lleva días callado y es normal; uno "Operativo"
           -- callado tres meses es un equipo que hay que ir a mirar.
           ev.etiqueta                                               AS estado_vehiculo,
           ev.es_operativo                                           AS coche_operativo,
           -- EL ÚLTIMO QUE LO LLEVÓ EN BOLT, sin las doce horas de arriba: la
           -- lista enseña a la persona, y de un coche parado desde ayer lo que
           -- se quiere saber es quién lo tuvo. El índice idx_bsl_vehiculo_dia
           -- lo deja en ~8 ms para toda la flota.
           ult.nombre                                                AS ultimo_conductor,
           EXTRACT(EPOCH FROM (now() - ult.ocurrido_at))::int        AS ultimo_hace,
           -- DÓNDE DEJÓ AL ÚLTIMO PASAJERO (db/156), y cuánto ha rodado desde
           -- entonces según el odómetro. Con esto el mapa dice si un coche que
           -- espera fuera de la M-30 está volviendo o dando vueltas.
           ud.destino                                                AS destino,
           ud.destino_lat, ud.destino_lng,
           ud.dejado_ts                                              AS dejado_at,
           EXTRACT(EPOCH FROM (now() - ud.dejado_ts))::int           AS dejado_hace,
           kd.metros                                                 AS metros_desde_dejado,
           -- UN VIAJE ACABA DE TERMINAR Y SU PEDIDO AÚN NO HA LLEGADO: el último
           -- has_order del coche empezó después de cualquier pedido suyo que
           -- tengamos. Sin esto, la ficha enseñaba el viaje de ANTES como si
           -- fuera el último (el 1208MJY en Aranjuez con «Tres Cantos»).
           (ho.t IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM bolt_order b2
               WHERE b2.matricula_norm = v.matricula_norm
                 AND b2.creado_ts BETWEEN ho.t - interval '5 minutes' AND ho.t + interval '2 minutes'
                 AND b2.estado NOT IN ('driver_did_not_respond', 'driver_rejected')))  AS viaje_sin_llegar
      -- SE PARTE DE NUESTRA FLOTA, NO DE MAPON (24/09/2026). Antes era al
      -- reves -de fv_posicion hacia vehiculo- y un coche que Mapon no conoce
      -- no salia en el mapa ni avisaba de nada: sencillamente no existia. Lo
      -- pidio Camilo: los coches son los NUESTROS, esten en taller o donde
      -- esten, y si de alguno no hay nada en Mapon, eso es una alerta.
      FROM vehiculo v
      LEFT JOIN fv_posicion p ON p.matricula = v.matricula
      LEFT JOIN cat_estado_vehiculo ev ON ev.codigo = v.estado_operativo
      LEFT JOIN fv_vehiculo fvv ON fvv.matricula = v.matricula
      LEFT JOIN LATERAL (
        SELECT uc.nombre, l.ocurrido_at
          FROM bolt_state_log l
          JOIN fv_conductor uc ON uc.uuid = l.driver_uuid
         WHERE l.vehiculo_uuid = fvv.uuid
           AND l.driver_uuid IS NOT NULL
         ORDER BY l.ocurrido_at DESC
         LIMIT 1) ult ON TRUE
      -- Doce horas, como el apunte de arriba: un destino de ayer ya no dice
      -- nada de hacia dónde va ahora.
      LEFT JOIN LATERAL (
        SELECT bo.destino, bo.destino_lat, bo.destino_lng, bo.dejado_ts
          FROM bolt_order bo
         WHERE bo.matricula_norm = v.matricula_norm
           -- SOLO LOS QUE HIZO. BOLT también manda los pedidos que le
           -- ofrecieron y NO cogió (driver_did_not_respond, driver_rejected), y
           -- muchos traen la hora de bajada de quien sí los hizo: el 1208MJY
           -- salía «dejado en Tres Cantos» por uno que ni aceptó.
           AND bo.estado = 'finished'
           AND bo.dejado_ts IS NOT NULL
           AND bo.dejado_ts > now() - interval '12 hours'
         ORDER BY bo.dejado_ts DESC
         LIMIT 1) ud ON TRUE
      -- El último viaje que EMPEZÓ, según los apuntes de BOLT (llegan cada 10 s).
      LEFT JOIN LATERAL (
        SELECT max(l.ocurrido_at) AS t
          FROM bolt_state_log l
         WHERE l.vehiculo_uuid = fvv.uuid AND l.estado = 'has_order'
           AND l.ocurrido_at > now() - interval '12 hours') ho ON TRUE
      LEFT JOIN LATERAL (
        SELECT sum(o.metros)::int AS metros
          FROM fv_odometro o
         WHERE o.unit_id = p.mapon_unit AND o.inicio >= ud.dejado_ts
        HAVING count(*) > 0) kd ON ud.dejado_ts IS NOT NULL
     WHERE v.baja_at IS NULL
       AND ($1::varchar[] IS NULL OR v.sede = ANY($1::varchar[]))
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
