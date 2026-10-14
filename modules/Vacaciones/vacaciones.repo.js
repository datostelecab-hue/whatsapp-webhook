// ============================================================
// VACACIONES — repositorio: lo que el saldo necesita leer de la base
// ============================================================
// No calcula nada: trae las piezas (contratos, ausencias, festivos y las horas
// de cada festivo) y el servicio hace la cuenta. Las fechas salen ya como
// 'AAAA-MM-DD' con to_char: un DATE leído como Date en Madrid da el día anterior.

const db = require('../../services/db');

const ESTADOS = ['vacaciones', 'permiso', 'suspendido', 'suspension_permiso'];

/** Quien tiene el contrato abierto (o una persona, con `id`). */
async function personas({ id = null } = {}) {
  const r = await db.consulta(
    `SELECT c.id::text AS id,
            btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS nombre,
            c.dni_nie,
            to_char(e.alta, 'YYYY-MM-DD') AS alta,
            e.tipo, e.ett_nombre
       FROM conductor_periodo_empleo e
       JOIN conductor c ON c.id = e.conductor_id
      WHERE e.baja IS NULL AND NOT c.es_centinela
        AND ($1::bigint IS NULL OR c.id = $1::bigint)
      ORDER BY lower(btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')))`, [id]);
  return r.rows;
}

/** Vacaciones, permisos y suspensiones de esas personas que tocan el periodo. */
async function tramos(ids, desde) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT h.id::text AS fila, h.conductor_id::text AS id, h.estado,
            to_char(h.desde, 'YYYY-MM-DD') AS desde, to_char(h.hasta, 'YYYY-MM-DD') AS hasta,
            h.motivo, h.leave_type_code, lt.name AS tipo_permiso
       FROM conductor_estado_hist h
       LEFT JOIN leave_type lt ON lt.leave_type_code = h.leave_type_code
      WHERE h.conductor_id = ANY($1::bigint[])
        AND h.estado = ANY($2::text[])
        AND (h.hasta IS NULL OR h.hasta >= $3::date)
      ORDER BY h.conductor_id, h.desde`, [ids, ESTADOS, desde]);
  return r.rows;
}

/** El calendario entero, con si sus horas están calculadas. */
async function festivos() {
  const r = await db.consulta(
    `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, ambito, norma,
            horas_at, horas_fuente
       FROM festivo ORDER BY fecha`);
  return r.rows;
}

/** Las horas de esas personas en los festivos. */
async function horasFestivos(ids) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT conductor_id::text AS id, to_char(fecha, 'YYYY-MM-DD') AS fecha, segundos
       FROM festivo_horas WHERE conductor_id = ANY($1::bigint[])`, [ids]);
  return r.rows;
}

/**
 * Los festivos cuyas horas hay que (re)calcular desde `fv_tramo`: los que ya
 * pasaron desde `desde`, sin calcular o calculados antes de que BOLT terminara
 * de mandar ese día (menos de `margen` días después del festivo).
 */
async function festivosPorSellar(desde, hoy, margen) {
  const r = await db.consulta(
    `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha FROM festivo
      WHERE fecha >= $1::date AND fecha < $2::date
        AND (horas_at IS NULL
             OR horas_at < ((fecha + $3::int)::timestamp AT TIME ZONE 'Europe/Madrid'))
      ORDER BY fecha`, [desde, hoy, margen]);
  return r.rows.map(x => x.fecha);
}

/** Guarda las horas de un festivo (Map conductor → segundos), de una vez. */
async function guardarHorasFestivo(fecha, horas, fuente) {
  const ids = [], segs = [];
  horas.forEach((s, cid) => { if (s > 0) { ids.push(Number(cid)); segs.push(Math.round(s)); } });
  return db.transaccion(async cli => {
    await cli.query('DELETE FROM festivo_horas WHERE fecha = $1::date', [fecha]);
    const r = await cli.query(
      `INSERT INTO festivo_horas (conductor_id, fecha, segundos)
       SELECT v.cid, $1::date, v.seg
         FROM unnest($2::bigint[], $3::int[]) AS v (cid, seg)
         JOIN conductor c ON c.id = v.cid`, [fecha, ids, segs]);
    await cli.query(
      `UPDATE festivo SET horas_at = now(), horas_fuente = $2 WHERE fecha = $1::date`, [fecha, fuente]);
    return r.rowCount;
  });
}

module.exports = { ESTADOS, personas, tramos, festivos, horasFestivos, festivosPorSellar, guardarHorasFestivo };
