// ============================================================
// STAGING — aterrizar lo que dice BOLT, sin interpretarlo
// ============================================================
// La cara de escritura de la puerta unica. Coge lo que contesto un endpoint de
// BOLT y lo guarda: el crudo en ingesta_descarga (para auditar y reprocesar) y
// los eventos ya en columnas en bolt_state_log (la fuente de la jornada).
//
// AQUI NO SE DECIDE NADA. No se dice que es trabajo ni que supuesto es: eso es
// services/repo/jornada.js, que lee de bolt_state_log. Aqui solo se guarda lo
// que paso, tal como llego. Esa separacion es la que deja reprocesar el pasado
// sin volver a llamar a BOLT.

const db = require('../db');

/**
 * Registra una descarga y devuelve su id, para colgar de el los eventos.
 * El payload es lo que contesto la API, entero; se podara luego.
 */
async function registrarDescarga({ fuente, endpoint, params, payload, filas, ms, error }) {
  const r = await db.consulta(
    `INSERT INTO ingesta_descarga (fuente, endpoint, params, payload, filas, ms, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [fuente, endpoint,
     params ? JSON.stringify(params) : null,
     payload ? JSON.stringify(payload) : null,
     filas ?? null, ms ?? null, error || null]);
  return r.rows[0].id;
}

/**
 * Aterriza los eventos de estado de BOLT en bolt_state_log, sin duplicar.
 *
 * `logs` es lo que da getFleetStateLogs: [{ driver_uuid, vehicle_uuid, state,
 * created }] con `created` en epoch de segundos. Idempotente por (driver,
 * hora, estado): reingerir una ventana solapada no crea nada nuevo.
 *
 * Devuelve cuantos eventos NUEVOS entraron.
 */
async function guardarStateLogs(logs, descargaId = null) {
  let nuevos = 0;
  for (const l of logs || []) {
    const driver = l.driver_uuid || null;
    const t = Number(l.created);
    const estado = l.state || null;
    if (!driver || !t || !estado) continue;      // sin driver no hay jornada que derivar
    const r = await db.consulta(
      `INSERT INTO bolt_state_log (driver_uuid, vehiculo_uuid, estado, ocurrido_at, descarga_id)
       VALUES ($1, $2, $3, to_timestamp($4), $5)
       ON CONFLICT (driver_uuid, ocurrido_at, estado) WHERE driver_uuid IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [driver, l.vehicle_uuid || null, estado, t, descargaId]);
    if (r.rowCount) nuevos++;
  }
  return nuevos;
}

/**
 * Los eventos de un conductor NUESTRO en un dia, listos para derivar la jornada.
 *
 * Cruza el driver_uuid de BOLT con nuestro conductor por conductor_externo, que
 * es el enlace duro por id (no por nombre). Devuelve [{ t, estado }] en epoch de
 * segundos, que es lo que espera jornada.tramosDeLogs.
 *
 * Se pide un poco antes del dia para poder cerrar el primer tramo con el estado
 * en que se venia: el dia no empieza en el vacio.
 */
async function logsDeConductorDia(conductorId, dia) {
  const r = await db.consulta(
    `SELECT EXTRACT(EPOCH FROM b.ocurrido_at)::bigint AS t, b.estado
       FROM bolt_state_log b
       JOIN conductor_externo ce
         ON ce.sistema = 'bolt' AND ce.externo_id = b.driver_uuid
      WHERE ce.conductor_id = $1
        AND b.ocurrido_at >= ($2::date - INTERVAL '1 day')
        AND b.ocurrido_at <  ($2::date + INTERVAL '1 day')
      ORDER BY b.ocurrido_at`,
    [conductorId, dia]);
  return r.rows.map(x => ({ t: Number(x.t), estado: x.estado }));
}

/** Los conductores con eventos en un dia. Para saber a quien derivar. */
async function conductoresConLogs(dia) {
  const r = await db.consulta(
    `SELECT DISTINCT ce.conductor_id
       FROM bolt_state_log b
       JOIN conductor_externo ce
         ON ce.sistema = 'bolt' AND ce.externo_id = b.driver_uuid
      WHERE b.ocurrido_at >= $1::date AND b.ocurrido_at < ($1::date + INTERVAL '1 day')`,
    [dia]);
  return r.rows.map(x => x.conductor_id);
}

module.exports = {
  registrarDescarga, guardarStateLogs, logsDeConductorDia, conductoresConLogs,
};
