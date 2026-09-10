// ============================================================
// ALERTAS DE MAPON — la capa de datos
// ============================================================
// Guardar lo que trae la ingesta y servir lo que pinta la pantalla. El módulo
// de Operaciones ya no habla con la API de Mapon: habla con esto.

const db = require('../db');

const n1 = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const normPlaca = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Guarda un lote de alertas ya normalizadas por `mapon.leerAlertas()`.
 *
 * Va en UNA sentencia con jsonb_to_recordset, que además resuelve de qué coche
 * nuestro es cada matrícula. Las que ya estaban no se tocan: una alerta es un
 * hecho, y dos pasadas solapadas del cron no pueden reescribirla ni duplicarla.
 */
async function guardar(alertas, descargaId = null) {
  const filas = (alertas || []).filter(a => a && a.id && a.iso).map(a => ({
    clave: txt(a.id, 120),
    ocurrido_at: a.iso,
    tipo: txt(a.tipo, 24) || 'desconocido',
    unit_id: txt(String(a.unitId), 32),
    matricula: normPlaca(a.matricula).slice(0, 16) || null,
    vehiculo: txt(a.vehiculo, 60),
    velocidad: n1(a.velocidad), limite: n1(a.limite), exceso: n1(a.exceso),
    zona: txt(a.zona, 120), sentido: txt(a.sentido, 24),
    severidad: txt(a.severidad, 12), msg: txt(a.msg, 2000),
  }));
  if (!filas.length) return 0;

  const r = await db.consulta(`
    INSERT INTO mapon_alerta (clave, ocurrido_at, tipo, unit_id, matricula, vehiculo_id,
      vehiculo, velocidad, limite, exceso, zona, sentido, severidad, msg, descarga_id)
    SELECT x.clave, x.ocurrido_at::timestamptz, x.tipo, x.unit_id, x.matricula, v.id,
           x.vehiculo, x.velocidad, x.limite, x.exceso, x.zona, x.sentido,
           x.severidad, x.msg, $2
      FROM jsonb_to_recordset($1::jsonb) AS x(
             clave text, ocurrido_at text, tipo text, unit_id text, matricula text,
             vehiculo text, velocidad numeric, limite numeric, exceso numeric,
             zona text, sentido text, severidad text, msg text)
      LEFT JOIN vehiculo v ON v.matricula_norm = x.matricula AND v.baja_at IS NULL
    ON CONFLICT (clave) DO NOTHING
    RETURNING 1`, [JSON.stringify(filas), descargaId]);
  return r.rowCount;
}

/** Las alertas de un rango, lo último primero. Todo el filtrado va en SQL. */
async function listar({ desde, hasta, tipo, matricula, severidad, limite = 1000 } = {}) {
  const par = [desde, hasta];
  let extra = '';
  if (tipo) { par.push(String(tipo)); extra += ` AND a.tipo = $${par.length}`; }
  if (severidad) { par.push(String(severidad)); extra += ` AND a.severidad = $${par.length}`; }
  if (matricula) { par.push(normPlaca(matricula)); extra += ` AND a.matricula = $${par.length}`; }
  par.push(Math.min(Number(limite) || 1000, 5000));

  const r = await db.consulta(`
    SELECT a.clave AS id, a.tipo, a.unit_id, a.matricula, a.vehiculo, a.vehiculo_id,
           to_char(a.ocurrido_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS fecha,
           to_char(a.ocurrido_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI')    AS hora,
           extract(epoch FROM a.ocurrido_at) * 1000                          AS orden,
           to_char(a.ocurrido_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')              AS iso,
           a.velocidad::float8, a.limite::float8, a.exceso::float8,
           a.zona, a.sentido, a.severidad, a.msg
      FROM mapon_alerta a
     WHERE a.ocurrido_at BETWEEN $1::timestamptz AND $2::timestamptz ${extra}
     ORDER BY a.ocurrido_at DESC
     LIMIT $${par.length}`, par);
  return r.rows.map(x => ({ ...x, orden: Number(x.orden) }));
}

/** Cuántas de cada tipo hay en el rango: es lo que colorea los filtros. */
async function porTipo({ desde, hasta } = {}) {
  const r = await db.consulta(`
    SELECT tipo, count(*)::int AS n,
           count(*) FILTER (WHERE severidad = 'grave')::int AS graves
      FROM mapon_alerta
     WHERE ocurrido_at BETWEEN $1::timestamptz AND $2::timestamptz
     GROUP BY 1 ORDER BY 2 DESC`, [desde, hasta]);
  return r.rows;
}

/** Hasta cuándo llega lo que tenemos. La pantalla lo dice: es dato de fiabilidad. */
async function frescura() {
  const r = await db.consulta(`
    SELECT to_char(max(ocurrido_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS ultima,
           to_char(max(creado_at)   AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS leido,
           count(*)::int AS total
      FROM mapon_alerta`);
  return r.rows[0];
}

module.exports = { guardar, listar, porTipo, frescura };
