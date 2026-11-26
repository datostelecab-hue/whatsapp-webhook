// ============================================================
// LAS VARIABLES DE A3 — el SQL (módulo 4, db/300)
// ============================================================
// El catálogo de conceptos (`nomina_concepto`) y las líneas de cada mes de
// nómina (`nomina_linea`).
'use strict';

const db = require('../../services/db');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla(cli = null) {
  const r = await q(cli, `SELECT to_regclass('public.nomina_linea') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

async function conceptos(cli = null) {
  const r = await q(cli, `SELECT codigo, nombre, cabecera, tipo, origen, orden, activo FROM nomina_concepto ORDER BY orden, codigo`);
  return r.rows;
}

async function guardarConcepto(cli, c, nuevo) {
  if (nuevo) {
    await q(cli, `INSERT INTO nomina_concepto (codigo, nombre, cabecera, tipo, origen, orden, activo) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [c.codigo, c.nombre, c.cabecera, c.tipo, c.origen, c.orden, c.activo]);
  } else {
    await q(cli, `UPDATE nomina_concepto SET nombre = $2, cabecera = $3, tipo = $4, origen = $5, orden = $6, activo = $7 WHERE codigo = $1`,
      [c.codigo, c.nombre, c.cabecera, c.tipo, c.origen, c.orden, c.activo]);
  }
}

/**
 * Lo que se descuenta en un mes, por persona y concepto: lo ya descontado al
 * cerrarlo (descuento_aplicacion) y lo aprobado o aplazado a él que aún no.
 * Vacío si los descuentos no existen (db/298).
 */
async function descuentosDelMes(cli, periodo) {
  const hay = (await q(cli, `SELECT to_regclass('public.descuento_nomina') IS NOT NULL AS hay`)).rows[0].hay;
  if (!hay) return [];
  const r = await q(cli,
    `SELECT conductor_id::text AS conductor_id, concepto, sum(importe)::float AS importe, count(*)::int AS n
       FROM (SELECT d.conductor_id, d.concepto, LEAST(COALESCE(d.a_descontar, d.saldo), d.saldo) AS importe
               FROM descuento_nomina d WHERE d.periodo = $1 AND d.estado IN ('aprobado', 'aplazado')
             UNION ALL
             SELECT d.conductor_id, d.concepto, a.importe
               FROM descuento_aplicacion a JOIN descuento_nomina d ON d.id = a.descuento_id WHERE a.periodo = $1) x
      GROUP BY 1, 2 HAVING sum(importe) > 0`, [periodo]);
  return r.rows;
}

/** Quita las líneas que salen del ERP de un mes (se rehacen al preparar). */
async function borrarAutomaticas(cli, periodo) {
  const r = await q(cli, `DELETE FROM nomina_linea WHERE periodo = $1 AND origen <> 'manual' AND anulado_at IS NULL`, [periodo]);
  return r.rowCount;
}

async function insertar(cli, l) {
  const r = await q(cli,
    `INSERT INTO nomina_linea (periodo, conductor_id, concepto, importe, origen, detalle, motivo, creado_por)
     VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8) RETURNING id::text AS id`,
    [l.periodo, l.conductorId, l.concepto, l.importe, l.origen, l.detalle || null, l.motivo || null, l.creadoPor || null]);
  return r.rows[0].id;
}

async function anular(cli, id, { motivo, usuarioId }) {
  const r = await q(cli,
    `UPDATE nomina_linea SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1 AND origen = 'manual' AND anulado_at IS NULL RETURNING id`, [id, usuarioId || null, motivo]);
  return r.rowCount > 0;
}

const nombreDe = a => `NULLIF(btrim(COALESCE(${a}.nombre, '') || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), '')), '')`;
const SELECT = `
  SELECT l.id::text AS id, l.periodo, l.conductor_id::text AS conductor_id, l.concepto, l.importe::float AS importe,
         l.origen, l.detalle, l.motivo,
         to_char(l.creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS creado, ${nombreDe('u')} AS creado_por_nombre,
         btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.legajo, c.empleo_vigente AS de_alta,
         k.nombre AS concepto_nombre, k.tipo
    FROM nomina_linea l
    JOIN conductor c ON c.id = l.conductor_id
    JOIN nomina_concepto k ON k.codigo = l.concepto
    LEFT JOIN usuario u ON u.id = l.creado_por`;

/** Las líneas vivas de unos meses. */
async function lista(periodos) {
  return (await db.consulta(`${SELECT} WHERE l.anulado_at IS NULL AND l.periodo = ANY($1::text[]) ORDER BY l.periodo DESC, nombre, k.orden`, [periodos])).rows;
}

async function porId(id) {
  return (await db.consulta(`${SELECT} WHERE l.id = $1`, [id])).rows[0] || null;
}

async function delMes(cli, periodo) {
  return (await q(cli, `${SELECT} WHERE l.anulado_at IS NULL AND l.periodo = $1 ORDER BY nombre, k.orden`, [periodo])).rows;
}

async function cuantasDelMes(cli, periodo) {
  if (!await hayTabla(cli)) return null;
  const r = await q(cli, `SELECT count(*)::int AS n FROM nomina_linea WHERE periodo = $1 AND anulado_at IS NULL`, [periodo]);
  return r.rows[0].n;
}

module.exports = { hayTabla, conceptos, guardarConcepto, descuentosDelMes, borrarAutomaticas, insertar, anular, lista, porId, delMes, cuantasDelMes };
