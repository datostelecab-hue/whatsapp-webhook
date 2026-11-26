// ============================================================
// LA PROFORMA DE A3 — el SQL (módulo 4, db/296)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla() {
  const r = await db.consulta(`SELECT to_regclass('public.proforma_caso') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

/**
 * Las fichas con legajo o con algún contrato en el mes (sin las de pruebas),
 * con sus contratos y sus bajas y suspensiones que tocan el mes.
 */
async function personasDelMes(desde, hasta) {
  const r = await db.consulta(
    `SELECT c.id::text AS id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.nombre_ss, c.legajo,
       COALESCE((SELECT json_agg(json_build_object('tipo', e.tipo, 'alta', to_char(e.alta, 'YYYY-MM-DD'), 'baja', to_char(e.baja, 'YYYY-MM-DD')) ORDER BY e.alta)
          FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id AND e.alta <= $2::date AND (e.baja IS NULL OR e.baja >= $1::date)), '[]') AS empleos,
       COALESCE((SELECT json_agg(json_build_object('estado', s.estado, 'desde', to_char(s.desde, 'YYYY-MM-DD'), 'hasta', to_char(s.hasta, 'YYYY-MM-DD')) ORDER BY s.desde)
          FROM conductor_estado_hist s WHERE s.conductor_id = c.id AND s.estado IN ('baja_medica', 'suspendido', 'suspension_permiso')
           AND s.desde <= $2::date AND COALESCE(s.hasta, $2::date) >= $1::date), '[]') AS situaciones
     FROM conductor c
    WHERE NOT c.es_centinela${await pruebas.fuera('c')}
      AND (c.legajo IS NOT NULL OR EXISTS (SELECT 1 FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id
            AND e.alta <= $2::date AND (e.baja IS NULL OR e.baja >= $1::date - 90)))`, [desde, hasta]);
  return r.rows;
}

/** Los casos de un mes: clave → { id, decision }. */
async function delMes(cli, periodo) {
  const r = await q(cli, `SELECT id::text AS id, clave, decision FROM proforma_caso WHERE periodo = $1`, [periodo]);
  return new Map(r.rows.map(x => [x.clave, x]));
}

async function insertar(cli, { periodo, clave, tipo, conductorId, legajo, nombreA3, detalle, ficheroId }) {
  await q(cli,
    `INSERT INTO proforma_caso (periodo, clave, tipo, conductor_id, legajo, nombre_a3, detalle, fichero_id, ultimo_fichero_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)`,
    [periodo, clave, tipo, conductorId || null, legajo || null, nombreA3 || null, JSON.stringify(detalle || {}), ficheroId]);
}

/** Sigue saliendo: se refresca lo que dice (si ya no salía, vuelve a estar por decidir). */
async function sigue(cli, id, { detalle, nombreA3, ficheroId }) {
  await q(cli,
    `UPDATE proforma_caso SET detalle = $2::jsonb, nombre_a3 = COALESCE($3, nombre_a3), ultimo_fichero_id = $4,
            decision = CASE WHEN decision = 'ya_no_sale' THEN 'pendiente' ELSE decision END,
            decidido_at = CASE WHEN decision = 'ya_no_sale' THEN NULL ELSE decidido_at END,
            decidido_por = CASE WHEN decision = 'ya_no_sale' THEN NULL ELSE decidido_por END
      WHERE id = $1`, [id, JSON.stringify(detalle || {}), nombreA3 || null, ficheroId]);
}

/** Ya no sale en la proforma nueva: si estaba por decidir, se cierra sola. */
async function yaNoSale(cli, id, nota) {
  const r = await q(cli, `UPDATE proforma_caso SET decision = 'ya_no_sale', nota = $2, decidido_at = now()
    WHERE id = $1 AND decision = 'pendiente'`, [id, nota]);
  return r.rowCount > 0;
}

async function decidir(cli, ids, { decision, nota, usuarioId }) {
  const r = await q(cli,
    `UPDATE proforma_caso SET decision = $2::varchar, nota = COALESCE($3::text, nota),
            decidido_at = CASE WHEN $2::varchar = 'pendiente' THEN NULL ELSE now() END, decidido_por = $4::int,
            enviada_at = CASE WHEN $2::varchar = 'a3' THEN enviada_at ELSE NULL END
      WHERE id = ANY($1::bigint[]) RETURNING id::text AS id, periodo`, [ids, decision, nota || null, usuarioId]);
  return r.rows;
}

async function marcarEnviadas(cli, ids, usuarioId) {
  const r = await q(cli, `UPDATE proforma_caso SET enviada_at = now(), enviada_por = $2
    WHERE id = ANY($1::bigint[]) AND decision = 'a3'`, [ids, usuarioId]);
  return r.rowCount;
}

const SELECT = `
  SELECT k.id::text AS id, k.periodo, k.clave, k.tipo, k.conductor_id::text AS conductor_id, k.legajo, k.nombre_a3, k.detalle,
         k.decision, k.nota,
         btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre_erp,
         to_char(k.creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS detectado,
         to_char(k.decidido_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS decidido,
         to_char(k.enviada_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS enviada,
         NULLIF(btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(NULLIF(u.apellidos, '.'), '')), '') AS decidido_por_nombre,
         fu.nombre AS ultimo_fichero
    FROM proforma_caso k
    LEFT JOIN conductor c ON c.id = k.conductor_id
    LEFT JOIN usuario u ON u.id = k.decidido_por
    LEFT JOIN fichero_importado fu ON fu.id = k.ultimo_fichero_id`;

/** Los casos de los últimos meses (de los tres últimos con proforma). */
async function lista() {
  return (await db.consulta(`${SELECT}
    WHERE k.periodo IN (SELECT DISTINCT periodo FROM proforma_caso ORDER BY periodo DESC LIMIT 3)
    ORDER BY k.periodo DESC, k.tipo, nombre_erp NULLS LAST, k.nombre_a3`)).rows;
}

async function porId(id, cli = null) {
  return (await q(cli, `${SELECT} WHERE k.id = $1`, [id])).rows[0] || null;
}

async function quedanDe(cli, periodo) {
  const r = await q(cli, `SELECT count(*)::int AS n FROM proforma_caso WHERE periodo = $1 AND decision = 'pendiente'`, [periodo]);
  return r.rows[0].n;
}

async function pendientes() {
  const r = await db.consulta(`SELECT count(*)::int AS n FROM proforma_caso WHERE decision = 'pendiente'`);
  return r.rows[0].n;
}

/** La última proforma subida de un mes (la que se vuelve a cruzar), con su original guardado. */
async function ultimaCarga(periodo) {
  const r = await db.consulta(
    `SELECT id::text AS id, nombre, adjunto_id::text AS adjunto_id FROM fichero_importado
      WHERE tipo = 'proforma_a3' AND periodo = $1 AND estado = 'cargado' ORDER BY id DESC LIMIT 1`, [periodo]);
  return r.rows[0] || null;
}

module.exports = { ultimaCarga, hayTabla, personasDelMes, delMes, insertar, sigue, yaNoSale, decidir, marcarEnviadas, lista, porId, quedanDe, pendientes };
