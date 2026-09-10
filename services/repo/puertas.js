// ============================================================
// PUERTAS — quién abre y cierra qué coche
// ============================================================
// Hasta ahora esto no dejaba rastro: el bot mandaba la orden y ahí acababa la
// historia. Si aparecía un coche abierto de madrugada no había forma de saber
// quién lo abrió, ni desde qué número, ni si la orden llegó a salir.
//
// Se registra el INTENTO, no solo el acierto. Una orden que falla es justo la
// que hay que poder mirar cuando alguien dice "le di y no se abrió".

const db = require('../db');

const normPlaca = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

/**
 * Apunta una orden. NUNCA lanza: que no se pueda escribir el registro no puede
 * impedir que a un conductor se le abra el coche en el que va a trabajar.
 */
async function registrar(o) {
  try {
    await db.consulta(`
      INSERT INTO puerta_comando (telefono, conductor_id, conductor, matricula,
        vehiculo_id, unit_id, comando, ok, respuesta, ms)
      SELECT $1, $2, $3, $4, v.id, $5, $6, $7, $8, $9
        FROM (SELECT 1) z
        LEFT JOIN vehiculo v ON v.matricula_norm = $4 AND v.baja_at IS NULL`,
      [txt(o.telefono, 24), o.conductorId || null, txt(o.conductor, 120),
        normPlaca(o.matricula).slice(0, 16), txt(String(o.unitId ?? ''), 32),
        o.comando, !!o.ok, txt(o.respuesta, 2000),
        o.ms == null ? null : Math.round(o.ms)]);
  } catch (e) {
    console.error('⚠️  [Puertas] no se pudo registrar la orden:', e.message);
  }
}

/** El histórico, lo último primero. Con filtros porque son tres preguntas. */
async function historial({ desde, hasta, matricula, conductorId, soloFallos = false, limite = 500 } = {}) {
  const par = [desde, hasta];
  let extra = '';
  if (matricula) { par.push(normPlaca(matricula)); extra += ` AND p.matricula = $${par.length}`; }
  if (conductorId) { par.push(Number(conductorId)); extra += ` AND p.conductor_id = $${par.length}`; }
  if (soloFallos) extra += ' AND NOT p.ok';
  par.push(Math.min(Number(limite) || 500, 5000));

  const r = await db.consulta(`
    SELECT p.id,
           to_char(p.pedido_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI:SS') AS cuando,
           p.telefono, p.conductor, p.conductor_id, p.matricula, p.vehiculo_id,
           p.comando, p.ok, p.respuesta, p.ms
      FROM puerta_comando p
     WHERE p.pedido_at BETWEEN $1::timestamptz AND $2::timestamptz ${extra}
     ORDER BY p.pedido_at DESC
     LIMIT $${par.length}`, par);
  return r.rows;
}

/** Quién más ha tocado puertas en el rango, y de cuántos coches distintos. */
async function porConductor({ desde, hasta, limite = 100 } = {}) {
  const r = await db.consulta(`
    SELECT COALESCE(p.conductor, p.telefono) AS conductor, p.conductor_id,
           count(*)::int                                        AS ordenes,
           count(*) FILTER (WHERE p.comando = 'open_doors')::int AS aperturas,
           count(*) FILTER (WHERE NOT p.ok)::int                AS fallos,
           count(DISTINCT p.matricula)::int                     AS coches,
           to_char(max(p.pedido_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS ultima
      FROM puerta_comando p
     WHERE p.pedido_at BETWEEN $1::timestamptz AND $2::timestamptz
     GROUP BY 1, 2
     ORDER BY count(*) DESC
     LIMIT $3`, [desde, hasta, Math.min(Number(limite) || 100, 500)]);
  return r.rows;
}

module.exports = { registrar, historial, porConductor };
