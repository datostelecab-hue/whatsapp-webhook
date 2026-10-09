// ============================================================
// PORTAL DEL CONDUCTOR — la capa de datos
// ============================================================
// Solo lee de la ficha de la persona (`conductor`) y de su teléfono vigente, y
// apunta los intentos de entrar (db/189). No escribe nada más: el portal es
// para MIRAR lo suyo.

const db = require('../../services/db');

const NOMBRE = `COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                         NULLIF(btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')), ''))`;

/**
 * Quién tiene ese teléfono vigente (por sus nueve últimas cifras, `sufijo9`).
 * Puede salir más de uno en teoría; hoy los teléfonos vigentes no se repiten.
 */
async function porTelefono(sufijo9) {
  const r = await db.consulta(
    `SELECT c.id, c.dni_nie, c.empleo_vigente, c.es_centinela,
            c.nombre, c.apellidos, c.nombre_bolt
       FROM conductor_telefono t
       JOIN conductor c ON c.id = t.conductor_id
      WHERE t.sufijo9 = $1 AND t.vigente_hasta IS NULL`, [sufijo9]);
  return r.rows;
}

/** Lo que enseña la portada, y si sigue pudiendo entrar. */
async function datos(conductorId) {
  const r = await db.consulta(
    `SELECT c.id, ${NOMBRE} AS nombre, c.nombre AS nombre_ficha, c.apellidos, c.nombre_bolt,
            c.empleo_vigente, c.es_centinela,
            (SELECT e164 FROM conductor_telefono WHERE conductor_id = c.id AND vigente_hasta IS NULL
              ORDER BY principal DESC, id LIMIT 1) AS telefono
       FROM conductor c WHERE c.id = $1`, [conductorId]);
  return r.rows[0] || null;
}

/** Apunta un intento de entrar. Si la tabla aún no existe (db/189), no pasa nada. */
async function apuntarAcceso({ conductorId, ok, motivo, telFinal, ip, agente }) {
  await db.consulta(
    `INSERT INTO conductor_acceso (conductor_id, ok, motivo, tel_final, ip, agente)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [conductorId || null, !!ok, motivo, telFinal || null,
     String(ip || '').slice(0, 64) || null, String(agente || '').slice(0, 300) || null]);
}

module.exports = { porTelefono, datos, apuntarAcceso };
