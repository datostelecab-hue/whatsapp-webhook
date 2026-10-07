// ============================================================
// BARCELONA · REPOSITORIO — sus conductores, sus coches y su planificador
// ============================================================
// Todo lo de una sede que no es la vigilada (Madrid) vive en tablas suyas
// (db/181): sus cuentas de BOLT (conductor_externo, de la empresa de esa sede),
// sus coches de BOLT (sede_bolt_vehiculo), sus asignaciones (sede_asignacion) y
// sus cambios de estado (sede_bolt_state_log). Las consultas llevan la sede como
// parámetro: la próxima sede no pide otro repositorio.
//
// Hasta que se aplique db/181 las tablas no existen: `faltaMigracion(e)` lo
// reconoce para que la pantalla lo diga en vez de dar un error.

const db = require('../../services/db');

/** ¿El error es que aún no existen las tablas de db/181? */
const faltaMigracion = e => !!e && e.code === '42P01';

/**
 * Las cuentas de BOLT de la sede (la empresa de BOLT de esa sede, `flota.sede`).
 * Todas, activas o no: una desactivada puede seguir en una asignación vieja y
 * hace falta su nombre. Quién se ofrece lo decide el servicio.
 */
async function conductores(sede) {
  const r = await db.consulta(
    `SELECT ce.externo_id AS uuid,
            btrim(COALESCE(ce.externo_nombre, '')) AS nombre,
            COALESCE(ce.externo_telefono, '') AS telefono,
            ce.estado_externo AS estado
       FROM conductor_externo ce
       JOIN flota f ON f.company_id = ce.bolt_company_id AND f.sede = $1
      WHERE ce.sistema = 'bolt'
      ORDER BY 2`, [sede]);
  return r.rows;
}

/**
 * LOS COCHES DE LA SEDE, uno por matrícula: los de su empresa de BOLT (el
 * último que BOLT devolvió) MÁS los del maestro de Vehículos con esa sede que
 * no están de baja. Camilo, 07/10/2026: hay coches de Barcelona que aún no
 * están dados de alta en BOLT (la 3035LTX) y hay que poder planificarlos.
 * Vehículos es quien dice de qué sede es cada coche; BOLT, si puede trabajar.
 *
 * Cada fila dice de dónde sale: `enBolt` (con su `estado` de BOLT) y `enErp`.
 */
async function coches(sede) {
  const r = await db.consulta(
    `WITH bolt AS (
       SELECT DISTINCT ON (matricula) uuid, matricula, modelo, estado_bolt, visto_at
         FROM sede_bolt_vehiculo
        WHERE sede = $1
        ORDER BY matricula, visto_at DESC
     ), erp AS (
       SELECT DISTINCT ON (matricula_norm) matricula_norm AS matricula, marca_modelo AS modelo
         FROM vehiculo
        WHERE sede = $1 AND baja_at IS NULL AND matricula_norm IS NOT NULL
        ORDER BY matricula_norm, id DESC
     )
     SELECT b.uuid, COALESCE(b.matricula, e.matricula) AS matricula,
            COALESCE(NULLIF(b.modelo, ''), e.modelo, '') AS modelo,
            COALESCE(b.estado_bolt, '') AS estado,
            (b.matricula IS NOT NULL) AS "enBolt", (e.matricula IS NOT NULL) AS "enErp", b.visto_at
       FROM bolt b
       FULL JOIN erp e ON e.matricula = b.matricula
      ORDER BY 2`, [sede]);
  return r.rows;
}

/** Las asignaciones que valen un día ('AAAA-MM-DD'). */
async function asignacionesEn(sede, fecha) {
  const r = await db.consulta(
    `SELECT id, matricula, turno, driver_uuid AS uuid,
            to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta
       FROM sede_asignacion
      WHERE sede = $1 AND desde <= $2::date AND (hasta IS NULL OR hasta >= $2::date)`, [sede, fecha]);
  return r.rows;
}

/** Las asignaciones que tocan un rango de días (para el reporte y la Visibilidad de varios días). */
async function asignacionesEntre(sede, desde, hasta) {
  const r = await db.consulta(
    `SELECT id, matricula, turno, driver_uuid AS uuid,
            to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta
       FROM sede_asignacion
      WHERE sede = $1 AND desde <= $3::date AND (hasta IS NULL OR hasta >= $2::date)`, [sede, desde, hasta]);
  return r.rows;
}

/**
 * PONER (O QUITAR) A ALGUIEN EN UNA PLAZA (matrícula + turno) DESDE UN DÍA.
 *
 * Fija hasta que se cambie (Camilo, 07/10/2026). Un cambio no borra el pasado:
 * la asignación de antes se CIERRA el día anterior (`hasta`), y así el reporte de
 * un día viejo sigue sabiendo a quién le tocaba. Si la de antes empezaba ese
 * mismo día o después (una corrección), no llegó a valer y se borra.
 *
 * Si la persona ya estaba en otra plaza del mismo turno, SE MUEVE: aquella se
 * cierra igual. La base no deja dos plazas abiertas por persona y turno
 * (uq_sede_asig_conductor), así que esto no es cortesía: sin ello fallaría.
 *
 * `driverUuid` vacío deja la plaza libre. Devuelve { cambio, movidaDe }.
 */
async function asignar({ sede, matricula, turno, driverUuid, desde, usuarioId }) {
  return db.transaccion(async cli => {
    const abiertas = async (donde, params) => (await cli.query(
      `SELECT id, matricula, driver_uuid AS uuid, to_char(desde, 'YYYY-MM-DD') AS desde
         FROM sede_asignacion WHERE ${donde} AND hasta IS NULL FOR UPDATE`, params)).rows;
    const cerrar = async x => {
      if (x.desde >= desde) await cli.query('DELETE FROM sede_asignacion WHERE id = $1', [x.id]);
      else {
        await cli.query(
          `UPDATE sede_asignacion SET hasta = $2::date - 1, cerrado_por = $3, cerrado_at = now() WHERE id = $1`,
          [x.id, desde, usuarioId || null]);
      }
    };

    const enLaPlaza = await abiertas('sede = $1 AND matricula = $2 AND turno = $3', [sede, matricula, turno]);
    // Lo mismo que ya había, desde antes: no hay nada que cambiar.
    if (driverUuid && enLaPlaza.length === 1 && enLaPlaza[0].uuid === driverUuid && enLaPlaza[0].desde <= desde) {
      return { cambio: false, movidaDe: null };
    }
    for (const x of enLaPlaza) await cerrar(x);

    let movidaDe = null;
    if (driverUuid) {
      const suyas = await abiertas('sede = $1 AND driver_uuid = $2 AND turno = $3', [sede, driverUuid, turno]);
      for (const x of suyas) { movidaDe = x.matricula; await cerrar(x); }
      await cli.query(
        `INSERT INTO sede_asignacion (sede, matricula, turno, driver_uuid, desde, creado_por)
         VALUES ($1, $2, $3, $4, $5::date, $6)`, [sede, matricula, turno, driverUuid, desde, usuarioId || null]);
    }
    return { cambio: true, movidaDe };
  });
}

/**
 * Los cambios de estado de BOLT de la sede en [iniMs, finMs). `veh` sale ya
 * como matrícula cuando se conoce el coche (si no, su uuid de BOLT).
 */
async function apuntesEntre(sede, iniMs, finMs) {
  const r = await db.consulta(
    `SELECT l.driver_uuid AS uuid, COALESCE(v.matricula, l.vehiculo_uuid) AS veh, l.estado,
            (extract(epoch FROM l.ocurrido_at) * 1000)::bigint AS t
       FROM sede_bolt_state_log l
       LEFT JOIN sede_bolt_vehiculo v ON v.uuid = l.vehiculo_uuid
      WHERE l.sede = $1 AND l.ocurrido_at >= $2::timestamptz AND l.ocurrido_at < $3::timestamptz`,
    [sede, new Date(iniMs).toISOString(), new Date(finMs).toISOString()]);
  return r.rows.map(x => ({ uuid: x.uuid, veh: x.veh, estado: x.estado, t: Number(x.t) }));
}

/**
 * Cómo se traduce cada estado de BOLT al nuestro, y si es trabajo: el MISMO
 * catálogo que Madrid (fv_estado_bolt + fv_cat_situacion, de Flota viva). Si
 * mañana BOLT estrena un estado y se clasifica allí, Barcelona lo hereda.
 */
async function situaciones() {
  const r = await db.consulta(`SELECT estado, situacion FROM fv_estado_bolt`);
  return new Map(r.rows.map(x => [x.estado, x.situacion]));
}

/**
 * El neto y los pedidos terminados de la sede en [iniMs, finMs) (db/182), por
 * la hora en que se pidieron, como en Madrid.
 */
async function dineroEntre(sede, iniMs, finMs) {
  const r = await db.consulta(
    `SELECT COALESCE(round(sum(neto) FILTER (WHERE estado = 'finished'), 2), 0)::float AS neto,
            count(*) FILTER (WHERE estado = 'finished')::int AS viajes
       FROM sede_bolt_order
      WHERE sede = $1 AND creado_ts >= $2::timestamptz AND creado_ts < $3::timestamptz`,
    [sede, new Date(iniMs).toISOString(), new Date(finMs).toISOString()]);
  return { neto: Number(r.rows[0].neto) || 0, viajes: Number(r.rows[0].viajes) || 0 };
}

/**
 * El neto y los pedidos terminados de cada día natural (en Madrid) entre dos
 * fechas, para la serie del mes: Map('AAAA-MM-DD' → { neto, viajes }).
 */
async function dineroPorDia(sede, desde, hasta) {
  const r = await db.consulta(
    `SELECT to_char((creado_ts AT TIME ZONE 'Europe/Madrid')::date, 'YYYY-MM-DD') AS dia,
            COALESCE(round(sum(neto) FILTER (WHERE estado = 'finished'), 2), 0)::float AS neto,
            count(*) FILTER (WHERE estado = 'finished')::int AS viajes
       FROM sede_bolt_order
      WHERE sede = $1
        AND creado_ts >= ($2::date)::timestamp AT TIME ZONE 'Europe/Madrid'
        AND creado_ts < ($3::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid'
      GROUP BY 1`, [sede, desde, hasta]);
  return new Map(r.rows.map(x => [x.dia, { neto: Number(x.neto) || 0, viajes: Number(x.viajes) || 0 }]));
}

/** La configuración de la Visibilidad de la sede (capacidad, meta, coches), o null. */
async function leerConfigVisibilidad(sede) {
  const r = await db.consulta(`SELECT valor FROM visibilidad_config WHERE clave = $1`, ['parametros_' + sede]);
  return r.rows[0] ? r.rows[0].valor : null;
}

async function guardarConfigVisibilidad(sede, valor) {
  await db.consulta(
    `INSERT INTO visibilidad_config (clave, valor, actualizado_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_at = now()`,
    ['parametros_' + sede, JSON.stringify(valor)]);
}

module.exports = {
  faltaMigracion, conductores, coches, asignacionesEn, asignacionesEntre, asignar,
  apuntesEntre, situaciones, dineroEntre, dineroPorDia, leerConfigVisibilidad, guardarConfigVisibilidad,
};
