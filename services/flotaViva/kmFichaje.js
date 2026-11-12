// ============================================================
// FLOTA VIVA · LOS KM FUERA DE BOLT, CON EL FICHAJE (versión ligera)
// ============================================================
// Camilo, 12/11/2026, después de que la versión completa tumbara la base de
// producción: «Hazlo con la versión ligera entonces. Si no hay nadie fichado en
// los KM rodados por fuera, entonces se le suman al último que estuvo en BOLT».
//
//   · KM BOLT        no cambian: de la cuenta que estaba conectada (viaje o
//                    espera), como siempre (rutas.kmPorVentanas).
//   · KM FUERA BOLT  los que el coche hace mientras nadie está en viaje ni en
//                    espera con él. Si en ese rato alguien tenía FICHADO el
//                    coche por WhatsApp, son suyos; si no, del último que estuvo
//                    en BOLT con el coche (el corte de FIN_KM), como siempre.
//
// Aquí solo se calcula lo que CAMBIA respecto a kmPorVentanas, y solo con los
// coches que tienen un fichaje que toca el día. Dos clases de filas por ventana:
//
//   fila 'fichaje'  { codigo, fichaje_id, conductor_id, usuario_id, telefono,
//                     nombre, tipo, matricula, km_fuera, hay_can, hay_gps }:
//                   los km del coche durante el fichaje SIN nadie en viaje o
//                   espera con él (también los que no eran de nadie).
//   fila 'resta'    { codigo, uuid, matricula, km_fuera }: lo que kmPorVentanas
//                   le dio a esa cuenta como «fuera de BOLT» (su descanso o
//                   desconectado) y que cae dentro de un fichaje: se le quita.
//
// POR QUÉ ES APARTE Y CON TOPE. La versión completa (12/11/2026) metía el
// fichaje dentro del reparto de TODOS los coches: en la copia local tardaba 1 s
// porque no tenía ni una fila del odómetro, y en producción, con ~40.000 al día,
// se quedaba colgada más de diez minutos por petición y tumbó la base. Con un
// odómetro de prueba de 70.000 filas al día, aquella tardaba más de 90 s y esta
// lo que se mide abajo (ver docs/modulos/Control Reportes.md). Y va con
// `statement_timeout`: si un día se pasa, falla ESTA consulta —el reporte sale
// sin el ajuste del fichaje y lo dice— en vez de la base.

const db = require('./db');
const { FIN_KM, UMBRAL_CAN, TOPE_TRAMO_ABIERTO } = require('./rutas');

const TOPE_MS = Number(process.env.KM_FICHAJE_TOPE_MS || 25000);

/** Las ventanas como VALUES, validadas (son del catálogo TURNOS, pero se escriben en el SQL). */
function ventanasSql(ventanas) {
  return ventanas.map(({ codigo, hIni, off, hFin }) => {
    const a = Number(hIni), b = Number(off), c = Number(hFin);
    if (![a, b, c].every(Number.isFinite)) throw new Error('Ventana con horas que no son números');
    if (!/^[a-zA-Z0-9_]+$/.test(codigo)) throw new Error('Código de ventana no válido');
    return `('${codigo}', ($1::date + interval '${a} hours') AT TIME ZONE 'Europe/Madrid',`
         + ` LEAST((($1::date + ${b}) + interval '${c} hours') AT TIME ZONE 'Europe/Madrid', now()))`;
  }).join(',\n         ');
}

/**
 * Los km fuera de BOLT que cambian de dueño por el fichaje, en las ventanas
 * dadas. Devuelve Map(codigo → { fichajes: [...], restas: [...] }).
 * Lanza si se pasa del tope: quien la llama decide qué hacer sin ella.
 */
async function kmFueraConFichaje(dia, ventanas) {
  if (!ventanas.length) return new Map();
  const d = String(dia).slice(0, 10);
  const sql = `
    WITH w AS (
       SELECT codigo, ini, fin FROM (VALUES
         ${ventanasSql(ventanas)}
       ) AS t(codigo, ini, fin)
       WHERE fin > ini
     ),
     lim AS (SELECT min(ini) AS ini0, max(fin) AS fin0 FROM w),
     -- LOS FICHAJES QUE TOCAN LAS VENTANAS, con su coche de Mapon (por la unidad
     -- que guardó el fichaje o, si no casa, por la matrícula). Abierto = hasta ahora.
     fich AS MATERIALIZED (
       SELECT DISTINCT ON (f.id)
              f.id AS fichaje_id, f.tipo, f.conductor_id, f.usuario_id, f.telefono, f.nombre,
              veh.matricula, veh.mapon_unit AS unit_id, f.inicio AS fi, COALESCE(f.fin, now()) AS ff
         FROM fichaje_turno f
         CROSS JOIN lim
         JOIN fv_vehiculo veh ON veh.mapon_unit IS NOT NULL
              AND (veh.mapon_unit::text = f.unit_id
                   OR upper(regexp_replace(veh.matricula, '[^A-Za-z0-9]', '', 'g'))
                    = upper(regexp_replace(f.matricula, '[^A-Za-z0-9]', '', 'g')))
        WHERE f.inicio >= $1::date - interval '3 days'
          AND f.inicio < lim.fin0 AND COALESCE(f.fin, now()) > lim.ini0
        ORDER BY f.id, (veh.mapon_unit::text = f.unit_id) DESC
     ),
     -- SOLO LOS COCHES FICHADOS: todo lo de abajo se lee para ellos y nada más.
     units AS MATERIALIZED (SELECT DISTINCT unit_id FROM fich),
     vehs AS MATERIALIZED (
       SELECT v.uuid, v.mapon_unit AS unit_id, v.matricula FROM fv_vehiculo v
        WHERE v.mapon_unit IN (SELECT unit_id FROM units)
     ),
     fich_w AS MATERIALIZED (
       SELECT w.codigo, fc.fichaje_id, fc.tipo, fc.conductor_id, fc.usuario_id, fc.telefono, fc.nombre,
              fc.matricula, fc.unit_id, GREATEST(fc.fi, w.ini) AS a, LEAST(fc.ff, w.fin) AS b
         FROM fich fc JOIN w ON fc.fi < w.fin AND fc.ff > w.ini
     ),
     -- LOS KM DE ESOS COCHES, con la misma elección CAN/GPS que kmPorVentanas
     -- (por ventana y coche), para que las cuentas cuadren con las suyas.
     can_v AS (
       SELECT w.codigo, o.unit_id, o.inicio, o.fin, o.metros,
              o.metros * GREATEST(0, EXTRACT(EPOCH FROM (LEAST(o.fin, w.fin) - GREATEST(o.inicio, w.ini))))
                / NULLIF(EXTRACT(EPOCH FROM (o.fin - o.inicio)), 0) AS en_ventana
         FROM fv_odometro o JOIN w ON o.inicio < w.fin AND o.fin > w.ini
        WHERE o.unit_id IN (SELECT unit_id FROM units)
          AND o.inicio >= $1::date - interval '1 day' AND o.inicio < $1::date + interval '3 days'
          AND o.fin > o.inicio
     ),
     gps_v AS (
       SELECT w.codigo, r.unit_id, r.inicio, r.fin, r.metros,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (LEAST(r.fin, w.fin) - GREATEST(r.inicio, w.ini))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS en_ventana
         FROM fv_ruta r JOIN w ON r.inicio < w.fin AND r.fin > w.ini
        WHERE r.unit_id IN (SELECT unit_id FROM units)
          AND r.inicio >= $1::date - interval '1 day' AND r.inicio < $1::date + interval '3 days'
          AND r.fin IS NOT NULL AND r.fin > r.inicio
     ),
     fuente AS (
       SELECT COALESCE(c.codigo, g.codigo) AS codigo, COALESCE(c.unit_id, g.unit_id) AS unit_id,
              (c.unit_id IS NOT NULL AND COALESCE(c.m, 0) >= ${UMBRAL_CAN} * COALESCE(g.m, 0)) AS por_can
         FROM      (SELECT codigo, unit_id, sum(en_ventana) AS m FROM can_v GROUP BY 1, 2) c
         FULL JOIN (SELECT codigo, unit_id, sum(en_ventana) AS m FROM gps_v GROUP BY 1, 2) g
                ON g.unit_id = c.unit_id AND g.codigo = c.codigo
     ),
     km_src AS MATERIALIZED (
       SELECT k.codigo, k.unit_id, k.inicio, k.fin, TRUE AS por_can,
              k.metros / NULLIF(EXTRACT(EPOCH FROM (k.fin - k.inicio)), 0) AS ritmo
         FROM can_v k JOIN fuente f ON f.unit_id = k.unit_id AND f.codigo = k.codigo AND f.por_can
       UNION ALL
       SELECT k.codigo, k.unit_id, k.inicio, k.fin, FALSE AS por_can,
              k.metros / NULLIF(EXTRACT(EPOCH FROM (k.fin - k.inicio)), 0) AS ritmo
         FROM gps_v k JOIN fuente f ON f.unit_id = k.unit_id AND f.codigo = k.codigo AND NOT f.por_can
     ),
     -- LOS TRAMOS DE ESOS COCHES. En BOLT (viaje o espera): el rato en que los
     -- km son de BOLT. Fuera (descanso o desconectado): con su corte (FIN_KM),
     -- que es como kmPorVentanas le da a cada cuenta sus km de fuera.
     tramo AS MATERIALIZED (
       SELECT t.conductor_uuid AS uuid, vehs.matricula, vehs.unit_id,
              (t.situacion IN ('viaje', 'espera')) AS en_bolt,
              t.desde AS d0, ${FIN_KM} AS h0
         FROM fv_tramo t
         JOIN vehs ON vehs.uuid = t.vehiculo_uuid
         CROSS JOIN lim
        WHERE t.conductor_uuid IS NOT NULL
          AND t.desde < lim.fin0
          AND t.desde >= lim.ini0 - interval '${TOPE_TRAMO_ABIERTO}'
     ),
     -- 1. Cada trozo de km dentro de un fichaje, y cuánto de él fue en BOLT.
     km_f AS MATERIALIZED (
       SELECT row_number() OVER () AS kid, fw.codigo, fw.fichaje_id, fw.unit_id, r.por_can, r.ritmo,
              GREATEST(r.inicio, fw.a) AS x0, LEAST(r.fin, fw.b) AS x1
         FROM km_src r
         JOIN fich_w fw ON fw.codigo = r.codigo AND fw.unit_id = r.unit_id
                       AND r.inicio < fw.b AND r.fin > fw.a
     ),
     en_bolt AS (
       SELECT kf.kid, sum(EXTRACT(EPOCH FROM (LEAST(tr.h0, kf.x1) - GREATEST(tr.d0, kf.x0)))) AS seg
         FROM km_f kf
         JOIN tramo tr ON tr.en_bolt AND tr.unit_id = kf.unit_id AND tr.d0 < kf.x1 AND tr.h0 > kf.x0
        GROUP BY kf.kid
     ),
     fichado AS (
       SELECT kf.codigo, kf.fichaje_id, kf.por_can,
              COALESCE(kf.ritmo, 0) * GREATEST(0, EXTRACT(EPOCH FROM (kf.x1 - kf.x0))
                - LEAST(EXTRACT(EPOCH FROM (kf.x1 - kf.x0)), COALESCE(eb.seg, 0))) AS metros_fuera
         FROM km_f kf LEFT JOIN en_bolt eb ON eb.kid = kf.kid
        WHERE kf.x1 > kf.x0
     ),
     -- 2. Lo que kmPorVentanas dio como «fuera» a una cuenta y cae dentro de un
     --    fichaje: el trozo de su tramo de fuera (recortado a la ventana) que se
     --    solapa con el fichaje, por los km de ese rato.
     fuera_f AS MATERIALIZED (
       SELECT fw.codigo, tr.uuid, tr.matricula, tr.unit_id,
              GREATEST(tr.d0, fw.a) AS p0, LEAST(tr.h0, fw.b) AS p1
         FROM tramo tr
         JOIN fich_w fw ON fw.unit_id = tr.unit_id AND fw.a < tr.h0 AND fw.b > tr.d0
        WHERE NOT tr.en_bolt
     ),
     resta AS (
       SELECT ff.codigo, ff.uuid, ff.matricula,
              sum(COALESCE(r.ritmo, 0) * GREATEST(0, EXTRACT(EPOCH FROM (LEAST(r.fin, ff.p1) - GREATEST(r.inicio, ff.p0))))) AS metros
         FROM fuera_f ff
         JOIN km_src r ON r.codigo = ff.codigo AND r.unit_id = ff.unit_id AND r.inicio < ff.p1 AND r.fin > ff.p0
        WHERE ff.p1 > ff.p0
        GROUP BY ff.codigo, ff.uuid, ff.matricula
     )
    SELECT 'fichaje' AS fila, fw.codigo, NULL::text AS uuid, fw.matricula, fw.fichaje_id, fw.tipo::text AS tipo,
           fw.conductor_id, fw.usuario_id::bigint AS usuario_id, fw.telefono::text AS telefono, fw.nombre::text AS nombre,
           round(COALESCE(sum(fd.metros_fuera), 0)::numeric / 1000.0, 1) AS km_fuera,
           COALESCE(bool_or(fd.por_can AND fd.metros_fuera > 0), FALSE) AS hay_can,
           COALESCE(bool_or(NOT fd.por_can AND fd.metros_fuera > 0), FALSE) AS hay_gps
      FROM fich_w fw LEFT JOIN fichado fd ON fd.codigo = fw.codigo AND fd.fichaje_id = fw.fichaje_id
     GROUP BY fw.codigo, fw.fichaje_id, fw.tipo, fw.conductor_id, fw.usuario_id, fw.telefono, fw.nombre, fw.matricula
    UNION ALL
    SELECT 'resta' AS fila, codigo, uuid, matricula, NULL::bigint, NULL::text, NULL::bigint, NULL::bigint, NULL::text, NULL::text,
           round(metros::numeric / 1000.0, 1) AS km_fuera, NULL::boolean, NULL::boolean
      FROM resta`;

  // EL TOPE: dentro de una transacción de solo lectura con statement_timeout,
  // para que si un día se pasa caiga esta consulta y no la base.
  const filas = await db.transaccion(async cli => {
    await cli.query('SET TRANSACTION READ ONLY');
    await cli.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.round(TOPE_MS))}`);
    // SIN BUCLES ANIDADOS (12/11/2026). Postgres no sabe cuántas filas salen de
    // los CTE de km (estima 1 y son más de cien mil) y elegía un bucle anidado
    // que comparaba todos los trozos contra todos: con el odómetro de verdad no
    // acababa nunca. Es casi seguro lo que colgó la versión completa en
    // producción. Así cruza por coche (hash por unit_id). Solo en esta transacción.
    await cli.query('SET LOCAL enable_nestloop = off');
    return (await cli.query(sql, [d])).rows;
  });

  const out = new Map(ventanas.map(v => [v.codigo, { fichajes: [], restas: [] }]));
  filas.forEach(x => {
    const v = out.get(x.codigo);
    if (!v) return;
    if (x.fila === 'fichaje') v.fichajes.push(x); else v.restas.push(x);
  });
  return out;
}

module.exports = { kmFueraConFichaje };
