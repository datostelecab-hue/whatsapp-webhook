// ============================================================
// OTRAS SEDES · LO QUE LA INGESTA TRAE DE SUS EMPRESAS DE BOLT
// ============================================================
// Barcelona (y la que venga) tiene su propia empresa en BOLT. De ella la
// ingesta trae los cambios de estado (de ahí salen sus horas) y los coches (de
// ahí salen las matrículas del planificador), y los guarda en TABLAS SUYAS
// (db/181): si entraran en bolt_state_log o en Flota viva, sus conductores, que
// no tienen ficha, saldrían como NN en Control, Visibilidad y la Bitácora de
// Madrid. Ver docs/nucleo/Sedes.md.
//
// Hasta que se aplique db/181 las tablas no existen: cada función lo dice
// (`sinTablas`) en vez de lanzar, para que la ingesta de Madrid no se entere.

const db = require('../db');

const FALTA_TABLA = '42P01';
const sinTablas = e => e && e.code === FALTA_TABLA;

/**
 * Guarda los cambios de estado de una empresa de otra sede. Idempotente: una
 * ventana solapada no duplica. Devuelve cuántos son nuevos, o null sin db/181.
 */
async function guardarStateLogs(sede, companyId, logs) {
  // Deduplicado antes de mandarlo: la misma clave dos veces en un INSERT es un
  // error («cannot affect row a second time»). Igual que en staging.js.
  const vistos = new Map();
  for (const l of logs || []) {
    const driver = l.driver_uuid || null;
    const t = Number(l.created);
    const estado = l.state || null;
    if (!driver || !t || !estado) continue;
    vistos.set(`${driver}|${t}|${estado}`, { driver, veh: l.vehicle_uuid || null, estado, t });
  }
  const filas = [...vistos.values()];
  if (!filas.length) return 0;
  try {
    const r = await db.consulta(
      `INSERT INTO sede_bolt_state_log (sede, company_id, driver_uuid, vehiculo_uuid, estado, ocurrido_at)
       SELECT $5, $6, x.driver, x.veh, x.estado, to_timestamp(x.t)
         FROM unnest($1::text[], $2::text[], $3::text[], $4::bigint[]) AS x(driver, veh, estado, t)
       ON CONFLICT (driver_uuid, ocurrido_at, estado) DO NOTHING
       RETURNING id`,
      [filas.map(x => x.driver), filas.map(x => x.veh), filas.map(x => x.estado), filas.map(x => x.t),
       sede, companyId]);
    return r.rowCount;
  } catch (e) {
    if (sinTablas(e)) return null;
    throw e;
  }
}

/** El último cambio guardado de una sede (epoch en segundos), o null si no hay ninguno o falta db/181. */
async function ultimoLog(sede) {
  try {
    const r = await db.consulta(
      `SELECT extract(epoch FROM max(ocurrido_at))::bigint AS t FROM sede_bolt_state_log WHERE sede = $1`, [sede]);
    return r.rows[0] && r.rows[0].t != null ? Number(r.rows[0].t) : null;
  } catch (e) {
    if (sinTablas(e)) return null;
    throw e;
  }
}

/**
 * Guarda los coches de una empresa de otra sede: los nuevos entran, los que ya
 * estaban se marcan como vistos ahora. Devuelve { nuevos, vistos } o null sin db/181.
 */
async function guardarVehiculos(sede, companyId, vehiculos) {
  const porUuid = new Map();
  for (const v of vehiculos || []) {
    const uuid = String(v.uuid || v.vehicle_uuid || '').trim();
    const matricula = String(v.reg_number || v.registration_number || v.license_plate || '')
      .toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!uuid || !matricula) continue;
    const modelo = [v.make, v.model].filter(Boolean).join(' ').trim() || null;
    porUuid.set(uuid, { uuid, matricula, modelo, estado: v.state ? String(v.state).slice(0, 24) : null });
  }
  const filas = [...porUuid.values()];
  if (!filas.length) return { nuevos: 0, vistos: 0 };
  try {
    const r = await db.consulta(
      `INSERT INTO sede_bolt_vehiculo (uuid, sede, company_id, matricula, modelo, estado_bolt)
       SELECT x.uuid, $5, $6, x.mat, x.modelo, x.estado
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS x(uuid, mat, modelo, estado)
       ON CONFLICT (uuid) DO UPDATE
          SET matricula = EXCLUDED.matricula, modelo = COALESCE(EXCLUDED.modelo, sede_bolt_vehiculo.modelo),
              estado_bolt = EXCLUDED.estado_bolt,
              sede = EXCLUDED.sede, company_id = EXCLUDED.company_id, visto_at = now()
       RETURNING (xmax = 0) AS nuevo`,
      [filas.map(x => x.uuid), filas.map(x => x.matricula), filas.map(x => x.modelo), filas.map(x => x.estado),
       sede, companyId]);
    const nuevos = r.rows.filter(x => x.nuevo).length;
    return { nuevos, vistos: r.rowCount - nuevos };
  } catch (e) {
    if (sinTablas(e)) return null;
    throw e;
  }
}

module.exports = { guardarStateLogs, ultimoLog, guardarVehiculos };
