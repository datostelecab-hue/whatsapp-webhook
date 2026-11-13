// ============================================================
// EL LIBRO DE AUDITORÍA — el SQL (db/245)
// ============================================================
// Solo datos: lo que decide qué se firma y qué se apunta está en
// services/libro.js.
'use strict';

const db = require('../db');

/**
 * Pone la firma en la transacción de `cli` y devuelve si ha quedado puesta:
 * fuera de un BEGIN, `set_config(…, true)` se pierde al acabar la sentencia.
 */
async function firmar(cli, { usuarioId, origen, accion, motivo }) {
  await cli.query(
    `SELECT set_config('telecab.usuario_id', $1, true),
            set_config('telecab.origen', $2, true),
            set_config('telecab.libro_accion', $3, true),
            set_config('telecab.libro_motivo', $4, true),
            set_config('telecab.libro_firmado', '1', true)`,
    [usuarioId, origen, accion, motivo]);
  const r = await cli.query(`SELECT current_setting('telecab.libro_firmado', true) AS firmado`);
  return r.rows[0].firmado === '1';
}

/** Un apunte sin fila. Con `cli`, en su transacción. */
async function insertarApunte({ tabla, registro, accion, usuarioId, origen, motivo, detalle }, cli = null) {
  const q = cli ? (s, p) => cli.query(s, p) : db.consulta;
  const r = await q(
    `INSERT INTO auditoria (tabla, registro, accion, usuario_id, origen, motivo, detalle)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
    [tabla, registro, accion, usuarioId, origen, motivo, detalle]);
  return Number(r.rows[0].id);
}

/** La historia de un registro, de lo más viejo a lo más nuevo. */
async function historial(tabla, registro) {
  const r = await db.consulta(
    `SELECT a.id, a.accion, a.origen, a.motivo, a.cambios, a.detalle, a.en,
            to_char(a.en AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS en_texto,
            btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')) AS quien
       FROM auditoria a
       LEFT JOIN usuario u ON u.id = a.usuario_id
      WHERE a.tabla = $1 AND a.registro = $2
      ORDER BY a.en, a.id`, [tabla, registro]);
  return r.rows;
}

module.exports = { firmar, insertarApunte, historial };
