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

/**
 * ¿QUIÉN PUEDE ABRIR UNA PUERTA? El teléfono desde el que escriben.
 *
 * Dos caminos:
 *
 *   1. UN CONDUCTOR DE ALTA, por el número con el que se le dio de alta. Quien
 *      ya causó baja deja de abrir.
 *
 *   2. UNA PERSONA DEL SISTEMA con el permiso `/puertas`. Se da una a una en
 *      /usuarios y no lo trae ningún rol —ni los que llevan el catálogo
 *      entero—: una puerta es física, y quién la abre no se decide por
 *      descarte.
 *
 * ── LO QUE AQUÍ NO SE MIRA: BOLT ────────────────────────────────────────────
 * Durante unas horas del 15/09/2026 esto exigió también tener la cuenta de
 * BOLT activa, y se echó atrás el mismo día por una razón que no se ve desde el
 * código: a quien BOLT le suspende la cuenta SE LE DA OTRA, y entre una y otra
 * sigue viniendo a trabajar. Cerrarle la puerta en ese hueco es cerrársela a
 * alguien que está de alta y en el turno.
 *
 * Eran 12 personas de 215. Queda escrito para que no se vuelva a «arreglar».
 *
 * Devuelve también POR QUÉ no, cuando no. «No estás autorizado» a secas deja a
 * la persona sin saber si le falta el alta o si se equivocó de número; y a
 * quien lo mire desde aquí, igual.
 *
 * El número NO se valida. Se comparan los nueve últimos dígitos y ya: quien
 * tenga uno raro apuntado simplemente no casa, y no hay riesgo en ello —desde
 * un número inventado no se escribe por WhatsApp—.
 */
async function quienPuedeAbrir(phone) {
  const t = String(phone || '').replace(/\D/g, '');
  if (t.length < 9) return { puede: false, motivo: 'sin_numero' };
  const s9 = t.slice(-9);

  const c = (await db.consulta(
    `SELECT c.id, c.empleo_vigente,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                     btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre
       FROM conductor_telefono t
       JOIN conductor c ON c.id = t.conductor_id
      WHERE t.vigente_hasta IS NULL AND t.sufijo9 = $1
      LIMIT 1`, [s9])).rows[0];

  if (c) {
    if (!c.empleo_vigente) return { puede: false, motivo: 'sin_alta', nombre: c.nombre };
    return { puede: true, tipo: 'conductor', conductorId: String(c.id), nombre: c.nombre };
  }

  // No es conductor: ¿es alguien del sistema con el permiso?
  const u = (await db.consulta(
    `SELECT u.id, u.estado,
            btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')) AS nombre,
            EXISTS (SELECT 1 FROM usuario_permiso p
                     WHERE p.usuario_id = u.id AND p.clave = '/puertas') AS tiene
       FROM usuario u
      WHERE right(regexp_replace(COALESCE(u.telefono, ''), '[^0-9]', '', 'g'), 9) = $1
        AND length(regexp_replace(COALESCE(u.telefono, ''), '[^0-9]', '', 'g')) >= 9
      ORDER BY (u.estado = 'activo') DESC, u.id
      LIMIT 1`, [s9])).rows[0];

  if (!u)                    return { puede: false, motivo: 'no_esta' };
  if (u.estado !== 'activo') return { puede: false, motivo: 'bloqueado', nombre: u.nombre };
  if (!u.tiene)              return { puede: false, motivo: 'sin_permiso', nombre: u.nombre };
  return { puede: true, tipo: 'usuario', usuarioId: u.id, nombre: u.nombre || 'Usuario ' + u.id };
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

module.exports = { registrar, historial, porConductor, quienPuedeAbrir };
