// ============================================================
// LA ORGANIZACIÓN — el SQL (db/248)
// ============================================================
// Solo datos: quién es superior de quién, qué hace falta para cada función y
// qué se valida está en services/organizacion.js.
'use strict';

const db = require('../db');

const NOMBRE = `btrim(u.nombre || ' ' || COALESCE(NULLIF(u.apellidos, '.'), ''))`;

// Las lecturas aceptan la conexión de una transacción (`cli`): las escrituras
// de la organización leen y deciden DENTRO de la suya, tras el candado.
const consulta = (cli, sql, vals) => (cli ? cli.query(sql, vals) : db.consulta(sql, vals));

/**
 * Pone en fila las escrituras de la organización (dentro de su transacción):
 * dos cambios a la vez no pueden cerrar entre los dos un círculo de superiores
 * ni dar a dos personas una función que es de una sola.
 */
async function bloquear(cli) {
  await cli.query(`SELECT pg_advisory_xact_lock(hashtext('organizacion'))`);
}

/** Las áreas, con su responsable. */
async function areas(cli = null) {
  const r = await consulta(cli, 
    `SELECT a.codigo, a.etiqueta, a.orden, a.activa, a.responsable_id,
            CASE WHEN u.id IS NULL THEN NULL ELSE ${NOMBRE} END AS responsable
       FROM cat_area a
       LEFT JOIN usuario u ON u.id = a.responsable_id
      ORDER BY a.orden, a.etiqueta`);
  return r.rows;
}

/** Las personas (usuarios), con su rol, área, superior escrito y estado. */
async function personas({ conBloqueados = false, cli = null } = {}) {
  const r = await consulta(cli, 
    `SELECT u.id, ${NOMBRE} AS nombre, u.email, u.estado, r.codigo AS rol, r.etiqueta AS rol_etiqueta,
            u.area_codigo, u.superior_id
       FROM usuario u
       JOIN rol r ON r.id = u.rol_id
      WHERE $1 OR u.estado <> 'bloqueado'
      ORDER BY u.nombre, u.apellidos`, [conBloqueados]);
  return r.rows;
}

/** Las funciones vigentes (o todas, con las anuladas), con quién las tiene. */
async function funciones({ conAnuladas = false, cli = null } = {}) {
  const r = await consulta(cli, 
    `SELECT f.id, f.usuario_id, f.funcion, f.suplente, f.nota, f.creado_at,
            f.anulado_at, f.anulado_motivo,
            ${NOMBRE} AS nombre, u.estado,
            btrim(COALESCE(c.nombre, '') || ' ' || COALESCE(NULLIF(c.apellidos, '.'), '')) AS dada_por
       FROM usuario_funcion f
       JOIN usuario u ON u.id = f.usuario_id
       LEFT JOIN usuario c ON c.id = f.creado_por
      WHERE $1 OR f.anulado_at IS NULL
      ORDER BY f.funcion, f.suplente, u.nombre`, [conAnuladas]);
  return r.rows.map(x => ({ ...x, id: Number(x.id) }));
}

async function ponerAreaYSuperior(cli, usuarioId, area, superiorId) {
  const r = await cli.query(
    `UPDATE usuario SET area_codigo = $2, superior_id = $3 WHERE id = $1 RETURNING id`,
    [usuarioId, area, superiorId]);
  return r.rowCount > 0;
}

async function ponerResponsable(cli, area, usuarioId) {
  const r = await cli.query(`UPDATE cat_area SET responsable_id = $2 WHERE codigo = $1`, [area, usuarioId]);
  return r.rowCount > 0;
}

/** Deja de ser responsable de las áreas que lleve, salvo de `salvo` (o de todas, con null). */
async function soltarResponsable(cli, usuarioId, salvo) {
  await cli.query(
    `UPDATE cat_area SET responsable_id = NULL WHERE responsable_id = $1 AND codigo IS DISTINCT FROM $2`,
    [usuarioId, salvo]);
}

async function darFuncion(cli, { usuarioId, funcion, suplente, nota, creadoPor }) {
  const r = await cli.query(
    `INSERT INTO usuario_funcion (usuario_id, funcion, suplente, nota, creado_por)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [usuarioId, funcion, suplente, nota, creadoPor]);
  return Number(r.rows[0].id);
}

async function anularFuncion(cli, { id, motivo, anuladoPor }) {
  const r = await cli.query(
    `UPDATE usuario_funcion SET anulado_at = now(), anulado_por = $3, anulado_motivo = $2
      WHERE id = $1 AND anulado_at IS NULL RETURNING id`, [id, motivo, anuladoPor]);
  return r.rowCount > 0;
}

module.exports = {
  bloquear, areas, personas, funciones, ponerAreaYSuperior, ponerResponsable, soltarResponsable, darFuncion, anularFuncion,
};
