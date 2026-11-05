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
const FALTA_COLUMNA = '42703';   // la columna aún no existe: falta una migración (db/230)
const sinTablas = e => e && e.code === FALTA_TABLA;
// Un importe que BOLT puede no mandar: null, no cero (cero es un precio).
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

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

/**
 * Guarda los pedidos de una empresa de otra sede (db/182). Un pedido madura
 * durante horas: si ya estaba, se actualiza su estado y su dinero. Devuelve
 * cuántos ha tocado, o null sin db/182.
 */
async function guardarPedidos(sede, companyId, pedidos) {
  const porClave = new Map();
  for (const o of pedidos || []) {
    const driver = o.driver_uuid || null;
    const creado = Number(o.order_created_timestamp);
    if (!driver || !creado) continue;
    const p = o.order_price || {};
    porClave.set(`${driver}|${creado}`, {
      ref: String(o.id || o.order_id || o.order_reference || '').slice(0, 64) || null,
      driver, creado,
      fin: Number(o.order_finished_timestamp) || 0,
      estado: o.order_status ? String(o.order_status).slice(0, 24) : null,
      mat: String(o.vehicle_license_plate || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16) || null,
      neto: Number(p.net_earnings) || 0, propina: Number(p.tip) || 0, peaje: Number(p.toll_fee) || 0,
      // EL PAGO (db/230, 05/11/2026): lo que pide la recaudación de Barcelona,
      // igual que bolt_order en Madrid. '' = leído y BOLT no lo dice; NULL (en la
      // base) = un pedido de antes de db/230 que todavía no se ha releído.
      pago: o.payment_method ? String(o.payment_method).slice(0, 16) : '',
      precio: num(p.ride_price), dto: num(p.cash_discount), reserva: num(p.booking_fee),
    });
  }
  const filas = [...porClave.values()];
  if (!filas.length) return 0;
  const base = [filas.map(x => x.ref), filas.map(x => x.driver), filas.map(x => x.mat), filas.map(x => x.estado),
    filas.map(x => x.creado), filas.map(x => x.fin), filas.map(x => x.neto), filas.map(x => x.propina),
    filas.map(x => x.peaje), sede, companyId];
  try {
    const r = await db.consulta(
      `INSERT INTO sede_bolt_order
         (sede, company_id, order_ref, driver_uuid, matricula, estado, creado_ts, finalizado_ts, neto, propina, peaje,
          metodo_pago, precio, dto_efectivo, tarifa_reserva)
       SELECT $10, $11, x.ref, x.driver, x.mat, x.estado, to_timestamp(x.creado),
              CASE WHEN x.fin > 0 THEN to_timestamp(x.fin) END, x.neto, x.propina, x.peaje,
              x.pago, x.precio, x.dto, x.reserva
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bigint[], $6::bigint[],
                     $7::numeric[], $8::numeric[], $9::numeric[],
                     $12::text[], $13::numeric[], $14::numeric[], $15::numeric[])
              AS x(ref, driver, mat, estado, creado, fin, neto, propina, peaje, pago, precio, dto, reserva)
       ON CONFLICT (driver_uuid, creado_ts) DO UPDATE SET
         estado = EXCLUDED.estado,
         finalizado_ts = COALESCE(EXCLUDED.finalizado_ts, sede_bolt_order.finalizado_ts),
         matricula = COALESCE(EXCLUDED.matricula, sede_bolt_order.matricula),
         neto = EXCLUDED.neto, propina = EXCLUDED.propina, peaje = EXCLUDED.peaje,
         -- Lo que BOLT diga ahora manda; si esta vez no lo dice, se queda lo que había.
         metodo_pago = COALESCE(NULLIF(EXCLUDED.metodo_pago, ''), sede_bolt_order.metodo_pago, EXCLUDED.metodo_pago),
         precio = COALESCE(EXCLUDED.precio, sede_bolt_order.precio),
         dto_efectivo = COALESCE(EXCLUDED.dto_efectivo, sede_bolt_order.dto_efectivo),
         tarifa_reserva = COALESCE(EXCLUDED.tarifa_reserva, sede_bolt_order.tarifa_reserva),
         actualizado_at = now()
       RETURNING id`,
      [...base, filas.map(x => x.pago), filas.map(x => x.precio), filas.map(x => x.dto), filas.map(x => x.reserva)]);
    return r.rowCount;
  } catch (e) {
    if (sinTablas(e)) return null;
    // Sin db/230 todavía (el código llega a Render antes de que se aplique):
    // se guarda como hasta hoy, sin el pago, para que la Visibilidad de
    // Barcelona no se quede sin datos. Los pedidos se releerán con su pago
    // cuando esté (ver `primerPedidoSinPago`).
    if (!(e && e.code === FALTA_COLUMNA)) throw e;
  }
  try {
    const r = await db.consulta(
      `INSERT INTO sede_bolt_order
         (sede, company_id, order_ref, driver_uuid, matricula, estado, creado_ts, finalizado_ts, neto, propina, peaje)
       SELECT $10, $11, x.ref, x.driver, x.mat, x.estado, to_timestamp(x.creado),
              CASE WHEN x.fin > 0 THEN to_timestamp(x.fin) END, x.neto, x.propina, x.peaje
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bigint[], $6::bigint[],
                     $7::numeric[], $8::numeric[], $9::numeric[])
              AS x(ref, driver, mat, estado, creado, fin, neto, propina, peaje)
       ON CONFLICT (driver_uuid, creado_ts) DO UPDATE SET
         estado = EXCLUDED.estado,
         finalizado_ts = COALESCE(EXCLUDED.finalizado_ts, sede_bolt_order.finalizado_ts),
         matricula = COALESCE(EXCLUDED.matricula, sede_bolt_order.matricula),
         neto = EXCLUDED.neto, propina = EXCLUDED.propina, peaje = EXCLUDED.peaje,
         actualizado_at = now()
       RETURNING id`, base);
    return r.rowCount;
  } catch (e) {
    if (sinTablas(e)) return null;
    throw e;
  }
}

/**
 * DESDE CUÁNDO SE COBRA EL EFECTIVO EN CADA SEDE (db/230). Barcelona: desde el
 * 1 de noviembre de 2026 (lo eligió Camilo el 05/11/2026). Es también el corte
 * de su recaudación (modules/Barcelona/recaudacion.service.js), así que esta es
 * la única fecha que hay que mirar.
 */
const PAGO_DESDE = { barcelona: '2026-11-01' };

/**
 * El primer pedido TERMINADO de una sede que aún no se ha leído con su pago
 * (metodo_pago NULL: entró antes de db/230), desde PAGO_DESDE y como mucho de
 * los últimos 31 días. Es por donde tiene que empezar a releer la ingesta para
 * que la recaudación tenga el efectivo de esos días. Epoch en segundos, o null
 * si no queda ninguno o falta db/230.
 */
async function primerPedidoSinPago(sede) {
  const desde = PAGO_DESDE[sede];
  if (!desde) return null;
  try {
    const r = await db.consulta(
      `SELECT extract(epoch FROM min(creado_ts))::bigint AS t
         FROM sede_bolt_order
        WHERE sede = $1 AND estado = 'finished' AND metodo_pago IS NULL
          AND creado_ts >= ($2::date::timestamp AT TIME ZONE 'Europe/Madrid')
          AND creado_ts >= now() - interval '31 days'`, [sede, desde]);
    return r.rows[0] && r.rows[0].t != null ? Number(r.rows[0].t) : null;
  } catch (e) {
    if (sinTablas(e) || (e && e.code === FALTA_COLUMNA)) return null;
    throw e;
  }
}

/** El pedido más reciente guardado de una sede (epoch en segundos), o null si no hay o falta db/182. */
async function ultimoPedido(sede) {
  try {
    const r = await db.consulta(
      `SELECT extract(epoch FROM max(creado_ts))::bigint AS t FROM sede_bolt_order WHERE sede = $1`, [sede]);
    return r.rows[0] && r.rows[0].t != null ? Number(r.rows[0].t) : null;
  } catch (e) {
    if (sinTablas(e)) return null;
    throw e;
  }
}

module.exports = { guardarStateLogs, ultimoLog, guardarVehiculos, guardarPedidos, ultimoPedido,
  PAGO_DESDE, primerPedidoSinPago };
