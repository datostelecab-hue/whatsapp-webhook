// ============================================================
// PARÁMETROS DE NEGOCIO — el SQL (db/243)
// ============================================================
// Solo datos: el catálogo, la validación y los valores por defecto están en
// services/parametros.js.
'use strict';

const db = require('../db');

/** Todos los cambios de todos los parámetros, con quién los hizo, por clave y desde. */
async function cambios() {
  const r = await db.consulta(
    `SELECT c.id, c.clave, c.valor, c.desde, c.motivo, c.usuario_id, c.creado_at,
            btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')) AS quien
       FROM parametro_cambio c
       LEFT JOIN usuario u ON u.id = c.usuario_id
      ORDER BY c.clave, c.desde, c.id`);
  return r.rows;
}

/** Un cambio nuevo (el historial no se toca: lo impide un disparador). */
async function insertarCambio({ clave, valorJson, motivo, usuarioId }) {
  await db.consulta(
    `INSERT INTO parametro_cambio (clave, valor, motivo, usuario_id) VALUES ($1, $2::jsonb, $3, $4)`,
    [clave, valorJson, motivo, usuarioId]);
}

module.exports = { cambios, insertarCambio };
