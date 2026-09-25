// ============================================================
// PIEZAS DEL COCHE — consultas contra PostgreSQL
// ============================================================
// El estado de cada pieza de un coche (db/158). Una pieza sin filas está en
// buen estado; el estado de ahora es la última fila de cada pieza.

const db = require('../../services/db');

/** Las piezas y los estados posibles. */
async function catalogo() {
  const [piezas, estados] = await Promise.all([
    db.consulta(`SELECT codigo, nombre, grupo, vista, orden FROM cat_pieza_vehiculo WHERE activa ORDER BY orden`),
    db.consulta(`SELECT codigo, etiqueta, es_mal, parpadea, orden FROM cat_estado_pieza ORDER BY orden`),
  ]);
  return { piezas: piezas.rows, estados: estados.rows };
}

/**
 * El estado de ahora de las piezas de un coche que NO están en buen estado por
 * defecto (las que tienen alguna fila), y los últimos cambios.
 */
async function deVehiculo(vehiculoId) {
  const [actual, historial] = await Promise.all([
    db.consulta(`
      SELECT DISTINCT ON (pe.pieza)
             pe.pieza, pe.estado, pe.observacion, pe.creado_at,
             COALESCE(u.nombre, '') AS usuario
        FROM vehiculo_pieza_estado pe
        LEFT JOIN usuario u ON u.id = pe.usuario_id
       WHERE pe.vehiculo_id = $1
       ORDER BY pe.pieza, pe.id DESC`, [vehiculoId]),
    db.consulta(`
      SELECT pe.id, pe.pieza, pe.estado, pe.observacion, pe.creado_at,
             COALESCE(u.nombre, '') AS usuario
        FROM vehiculo_pieza_estado pe
        LEFT JOIN usuario u ON u.id = pe.usuario_id
       WHERE pe.vehiculo_id = $1
       ORDER BY pe.id DESC
       LIMIT 300`, [vehiculoId]),
  ]);
  return { actual: actual.rows, historial: historial.rows };
}

/** El estado de ahora de UNA pieza, o null si nunca se tocó (buen estado). */
async function actualDe(vehiculoId, pieza) {
  const r = await db.consulta(
    `SELECT estado, observacion FROM vehiculo_pieza_estado
      WHERE vehiculo_id = $1 AND pieza = $2 ORDER BY id DESC LIMIT 1`, [vehiculoId, pieza]);
  return r.rows[0] || null;
}

async function existeVehiculo(vehiculoId) {
  const r = await db.consulta('SELECT 1 FROM vehiculo WHERE id = $1', [vehiculoId]);
  return r.rows.length > 0;
}

/** Apunta un cambio de estado. */
async function apuntar({ vehiculoId, pieza, estado, observacion }, usuarioId) {
  const r = await db.consulta(
    `INSERT INTO vehiculo_pieza_estado (vehiculo_id, pieza, estado, observacion, usuario_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, creado_at`, [vehiculoId, pieza, estado, observacion, usuarioId || null]);
  return r.rows[0];
}

module.exports = { catalogo, deVehiculo, actualDe, existeVehiculo, apuntar };
