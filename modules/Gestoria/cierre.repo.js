// ============================================================
// EL CIERRE DE LA NÓMINA DEL MES — el SQL (módulo 4, db/299)
// ============================================================
'use strict';

const db = require('../../services/db');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla(cli = null) {
  const r = await q(cli, `SELECT to_regclass('public.nomina_cierre_etapa') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

const nombreDe = a => `NULLIF(btrim(COALESCE(${a}.nombre, '') || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), '')), '')`;

/** Las etapas vivas (no deshechas) de un mes: Map(etapa → fila). */
async function vivas(cli, periodo) {
  const r = await q(cli,
    `SELECT e.id::text AS id, e.etapa, e.nota, e.hecho_por,
            to_char(e.hecho_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS hecho,
            ${nombreDe('u')} AS hecho_por_nombre
       FROM nomina_cierre_etapa e LEFT JOIN usuario u ON u.id = e.hecho_por
      WHERE e.periodo = $1 AND e.deshecho_at IS NULL`, [periodo]);
  return new Map(r.rows.map(x => [x.etapa, x]));
}

/** Las que se deshicieron, para la historia del mes. */
async function deshechas(periodo) {
  const r = await db.consulta(
    `SELECT e.etapa, e.deshecho_motivo AS motivo,
            to_char(e.deshecho_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS cuando,
            ${nombreDe('u')} AS por
       FROM nomina_cierre_etapa e LEFT JOIN usuario u ON u.id = e.deshecho_por
      WHERE e.periodo = $1 AND e.deshecho_at IS NOT NULL ORDER BY e.deshecho_at DESC`, [periodo]);
  return r.rows;
}

async function marcar(cli, { periodo, etapa, nota, usuarioId }) {
  const r = await q(cli,
    `INSERT INTO nomina_cierre_etapa (periodo, etapa, nota, hecho_por) VALUES ($1, $2, $3, $4)
     ON CONFLICT (periodo, etapa) WHERE deshecho_at IS NULL DO NOTHING RETURNING id::text AS id`,
    [periodo, etapa, nota || null, usuarioId || null]);
  return r.rows[0] ? r.rows[0].id : null;
}

async function deshacer(cli, { periodo, etapa, motivo, usuarioId }) {
  const r = await q(cli,
    `UPDATE nomina_cierre_etapa SET deshecho_at = now(), deshecho_por = $3, deshecho_motivo = $4
      WHERE periodo = $1 AND etapa = $2 AND deshecho_at IS NULL RETURNING id`,
    [periodo, etapa, usuarioId || null, motivo]);
  return r.rowCount > 0;
}

/**
 * Los descuentos del mes que siguen abiertos (por aprobar, aprobados o
 * aplazados a él): mientras haya, el mes de descuentos no está cerrado.
 * null si los descuentos aún no existen (falta db/298).
 */
async function descuentosAbiertos(cli, periodo) {
  const hay = (await q(cli, `SELECT to_regclass('public.descuento_nomina') IS NOT NULL AS hay`)).rows[0].hay;
  if (!hay) return null;
  const r = await q(cli,
    `SELECT count(*) FILTER (WHERE estado = 'pendiente')::int AS por_aprobar,
            count(*) FILTER (WHERE estado IN ('aprobado', 'aplazado'))::int AS por_descontar,
            (SELECT count(*)::int FROM descuento_aplicacion a WHERE a.periodo = $1) AS descontados
       FROM descuento_nomina WHERE periodo = $1`, [periodo]);
  return r.rows[0];
}

module.exports = { hayTabla, vivas, deshechas, marcar, deshacer, descuentosAbiertos };
