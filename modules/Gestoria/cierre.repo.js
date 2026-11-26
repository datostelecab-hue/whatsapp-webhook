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

// ── EL PANEL DEL MES (26/11/2026): lo que ya hay, junto ─────────────────────
const existe = async (cli, tabla) => (await q(cli, `SELECT to_regclass($1) IS NOT NULL AS hay`, [`public.${tabla}`])).rows[0].hay;

/** Lo que dijo la última proforma subida del mes (fichero_importado.resultado). */
async function proformaDelMes(cli, periodo) {
  if (!await existe(cli, 'fichero_importado')) return null;
  const r = await q(cli,
    `SELECT resultado, nombre, to_char(creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS cuando
       FROM fichero_importado WHERE tipo = 'proforma_a3' AND periodo = $1 AND estado = 'cargado' ORDER BY id DESC LIMIT 1`, [periodo])
    .catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

/** Las líneas para A3 del mes, sumadas: lo que se paga, lo que se descuenta, por origen y personas. */
async function lineasDelMes(cli, periodo) {
  if (!await existe(cli, 'nomina_linea')) return null;
  const r = await q(cli,
    `SELECT COALESCE(sum(l.importe) FILTER (WHERE k.tipo = 'devengo'), 0)::float AS pagar,
            COALESCE(sum(l.importe) FILTER (WHERE k.tipo = 'deduccion'), 0)::float AS descontar,
            COALESCE(sum(l.importe) FILTER (WHERE l.origen = 'variable'), 0)::float AS variable,
            COALESCE(sum(l.importe) FILTER (WHERE l.origen = 'manual'), 0)::float AS manual,
            count(*)::int AS lineas, count(DISTINCT l.conductor_id)::int AS personas,
            count(DISTINCT l.conductor_id) FILTER (WHERE c.legajo IS NULL)::int AS sin_codigo
       FROM nomina_linea l JOIN nomina_concepto k ON k.codigo = l.concepto JOIN conductor c ON c.id = l.conductor_id
      WHERE l.periodo = $1 AND l.anulado_at IS NULL`, [periodo]);
  return r.rows[0];
}

/** Los descuentos del mes: por aprobar, por descontar y ya descontados (con su importe). */
async function descuentosDelMes(cli, periodo) {
  if (!await existe(cli, 'descuento_nomina')) return null;
  const r = await q(cli,
    `SELECT count(*) FILTER (WHERE estado = 'pendiente')::int AS por_aprobar,
            COALESCE(sum(saldo) FILTER (WHERE estado = 'pendiente'), 0)::float AS por_aprobar_importe,
            count(*) FILTER (WHERE estado IN ('aprobado', 'aplazado'))::int AS por_descontar,
            COALESCE(sum(LEAST(COALESCE(a_descontar, saldo), saldo)) FILTER (WHERE estado IN ('aprobado', 'aplazado')), 0)::float AS por_descontar_importe,
            (SELECT COALESCE(sum(a.importe), 0)::float FROM descuento_aplicacion a WHERE a.periodo = $1) AS descontado
       FROM descuento_nomina WHERE periodo = $1`, [periodo]);
  return r.rows[0];
}

module.exports = { hayTabla, vivas, deshechas, marcar, deshacer, descuentosAbiertos, proformaDelMes, lineasDelMes, descuentosDelMes };
