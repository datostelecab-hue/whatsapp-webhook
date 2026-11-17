// ============================================================
// LA ORGANIZACIÓN — el SQL (db/248 y los puestos, db/255)
// ============================================================
// DESDE db/255 la organización va POR PUESTOS: de su puesto le vienen a cada
// persona su área, su superior (quien ocupe el puesto al que reporta) y sus
// funciones. Lo que se le pone a mano a una persona (otra área, otro superior,
// una función de más) va encima, como excepción. Aquí se devuelve ya mezclado:
// `area_codigo` es la de verdad (la suya o la de su puesto) y `funciones()`
// trae también las que le vienen del puesto.
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
/**
 * Las áreas, con quién las dirige: `responsables` son los ids de quien ocupe el
 * puesto que la dirige (db/255) y, si se puso a mano, de su responsable
 * (`responsable_id`). Solo gente no bloqueada. `responsable` es el nombre del
 * puesto a mano, como antes.
 */
async function areas(cli = null) {
  const r = await consulta(cli,
    `SELECT a.codigo, a.etiqueta, a.orden, a.activa, a.responsable_id, a.responsable_puesto,
            pz.nombre AS responsable_puesto_nombre,
            CASE WHEN u.id IS NULL THEN NULL ELSE ${NOMBRE} END AS responsable,
            ARRAY(SELECT x.id FROM usuario x
                   WHERE x.estado <> 'bloqueado'
                     AND (x.id = a.responsable_id OR (a.responsable_puesto IS NOT NULL AND x.puesto_codigo = a.responsable_puesto))
                   ORDER BY x.id) AS responsables
       FROM cat_area a
       LEFT JOIN usuario u ON u.id = a.responsable_id
       LEFT JOIN puesto pz ON pz.codigo = a.responsable_puesto
      ORDER BY a.orden, a.etiqueta`);
  return r.rows.map(a => ({ ...a, responsables: (a.responsables || []).map(Number) }));
}

/**
 * Las personas (usuarios), con su rol, su puesto, su área de verdad (la suya o
 * la de su puesto), su superior escrito a mano y su estado.
 */
async function personas({ conBloqueados = false, cli = null } = {}) {
  const r = await consulta(cli,
    `SELECT u.id, ${NOMBRE} AS nombre, u.email, u.estado, r.codigo AS rol, r.etiqueta AS rol_etiqueta,
            COALESCE(u.area_codigo, pz.area_codigo) AS area_codigo, u.area_codigo AS area_propia,
            u.superior_id, u.puesto_codigo, pz.nombre AS puesto, pz.area_codigo AS puesto_area,
            pz.reporta_a AS puesto_reporta_a
       FROM usuario u
       JOIN rol r ON r.id = u.rol_id
       LEFT JOIN puesto pz ON pz.codigo = u.puesto_codigo AND pz.activo
      WHERE $1 OR u.estado <> 'bloqueado'
      ORDER BY u.nombre, u.apellidos`, [conBloqueados]);
  return r.rows;
}

/** El catálogo de puestos, con sus funciones vigentes. */
async function puestos(cli = null) {
  const r = await consulta(cli,
    `SELECT p.codigo, p.nombre, p.area_codigo, p.reporta_a, p.mision, p.orden, p.activo,
            COALESCE((SELECT json_agg(json_build_object('funcion', f.funcion, 'suplente', f.suplente) ORDER BY f.funcion)
                        FROM puesto_funcion f WHERE f.puesto_codigo = p.codigo AND f.anulado_at IS NULL), '[]') AS funciones
       FROM puesto p
      ORDER BY p.orden, p.nombre`);
  return r.rows;
}

/** Pone (o quita, con null) el puesto de una persona. */
async function ponerPuesto(cli, usuarioId, puesto) {
  const r = await cli.query(`UPDATE usuario SET puesto_codigo = $2 WHERE id = $1 RETURNING id`, [usuarioId, puesto]);
  return r.rowCount > 0;
}

/**
 * Las funciones vigentes (o todas, con las anuladas), con quién las tiene: las
 * dadas a mano a una persona (con su `id`) y las que le vienen de su puesto
 * (`id` null y `puesto` con su nombre; no se quitan a la persona, sino al puesto).
 */
async function funciones({ conAnuladas = false, cli = null } = {}) {
  const r = await consulta(cli,
    `SELECT f.id, f.usuario_id, f.funcion, f.suplente, f.nota, f.creado_at,
            f.anulado_at, f.anulado_motivo,
            ${NOMBRE} AS nombre, u.estado,
            btrim(COALESCE(c.nombre, '') || ' ' || COALESCE(NULLIF(c.apellidos, '.'), '')) AS dada_por,
            NULL::varchar AS puesto_codigo, NULL::varchar AS puesto
       FROM usuario_funcion f
       JOIN usuario u ON u.id = f.usuario_id
       LEFT JOIN usuario c ON c.id = f.creado_por
      WHERE $1 OR f.anulado_at IS NULL
     UNION ALL
     SELECT NULL::bigint, u.id, pf.funcion, pf.suplente, NULL, pf.creado_at, NULL, NULL,
            ${NOMBRE}, u.estado, NULL, pz.codigo, pz.nombre
       FROM puesto_funcion pf
       JOIN puesto pz ON pz.codigo = pf.puesto_codigo AND pz.activo
       JOIN usuario u ON u.puesto_codigo = pf.puesto_codigo
      WHERE pf.anulado_at IS NULL
      ORDER BY 3, 4, 9`, [conAnuladas]);
  return r.rows.map(x => ({ ...x, id: x.id == null ? null : Number(x.id) }));
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
  bloquear, areas, personas, puestos, funciones, ponerAreaYSuperior, ponerPuesto, ponerResponsable, soltarResponsable,
  darFuncion, anularFuncion,
};
