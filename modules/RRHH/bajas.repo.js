// ============================================================
// LAS BAJAS MÉDICAS Y SUS PARTES — el SQL (módulo 1, db/303)
// ============================================================
'use strict';

const db = require('../../services/db');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla(cli = null) {
  return (await q(cli, `SELECT to_regclass('public.baja_parte') IS NOT NULL AS hay`)).rows[0].hay;
}

const nombre = a => `btrim(COALESCE(${a}.apellidos || ', ', '') || ${a}.nombre)`;
const SITUACION = `
  SELECT h.id::text AS id, h.conductor_id::text AS conductor_id, ${nombre('c')} AS nombre, c.legajo, c.empleo_vigente AS de_alta,
         to_char(h.desde, 'YYYY-MM-DD') AS desde, to_char(h.hasta, 'YYYY-MM-DD') AS hasta,
         to_char(h.hasta_previsto, 'YYYY-MM-DD') AS prevista, h.motivo,
         (SELECT count(*)::int FROM baja_parte p WHERE p.situacion_id = h.id AND p.anulado_at IS NULL) AS partes,
         (SELECT p.contingencia FROM baja_parte p WHERE p.situacion_id = h.id AND p.anulado_at IS NULL AND p.contingencia IS NOT NULL ORDER BY p.id LIMIT 1) AS contingencia,
         (SELECT json_build_object('tipo', p.tipo, 'fecha', to_char(p.fecha, 'YYYY-MM-DD'))
            FROM baja_parte p WHERE p.situacion_id = h.id AND p.anulado_at IS NULL ORDER BY p.fecha DESC, p.id DESC LIMIT 1) AS ultimo
    FROM conductor_estado_hist h
    JOIN conductor c ON c.id = h.conductor_id
   WHERE h.estado = 'baja_medica'`;

/** Las bajas abiertas y las cerradas en los últimos `dias`. */
async function lista(dias = 60) {
  return (await db.consulta(`${SITUACION} AND (h.hasta IS NULL OR h.hasta >= CURRENT_DATE - $1::int) ORDER BY (h.hasta IS NULL) DESC, h.desde DESC`, [dias])).rows;
}

async function situacion(cli, id) {
  return (await q(cli, `${SITUACION} AND h.id = $1`, [id])).rows[0] || null;
}

/** La baja abierta de una persona que cubre ese día (o null). */
async function abiertaDe(cli, conductorId, dia) {
  return (await q(cli, `${SITUACION} AND h.conductor_id = $1 AND h.desde <= $2::date AND (h.hasta IS NULL OR h.hasta >= $2::date) LIMIT 1`,
    [conductorId, dia])).rows[0] || null;
}

async function partesDe(situacionId) {
  const r = await db.consulta(
    `SELECT p.id::text AS id, p.tipo, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, to_char(p.prevista, 'YYYY-MM-DD') AS prevista,
            p.contingencia, p.origen, p.nota,
            to_char(p.creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS creado,
            NULLIF(btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(NULLIF(u.apellidos, '.'), '')), '') AS por
       FROM baja_parte p LEFT JOIN usuario u ON u.id = p.creado_por
      WHERE p.situacion_id = $1 AND p.anulado_at IS NULL ORDER BY p.id`, [situacionId]);
  return r.rows;
}

async function insertarParte(cli, x) {
  const r = await q(cli,
    `INSERT INTO baja_parte (conductor_id, situacion_id, tipo, fecha, prevista, contingencia, origen, nota, creado_por)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9) RETURNING id::text AS id`,
    [x.conductorId, x.situacionId, x.tipo, x.fecha, x.prevista || null, x.contingencia || null, x.origen || 'manual', x.nota || null, x.creadoPor || null]);
  return r.rows[0].id;
}

async function ponerPrevista(cli, situacionId, prevista) {
  await q(cli, `UPDATE conductor_estado_hist SET hasta_previsto = $2::date WHERE id = $1`, [situacionId, prevista || null]);
}

/** Los partes de los últimos días, por tipo: el resumen de arriba. */
async function recientes(dias = 7) {
  const r = await db.consulta(
    `SELECT tipo, count(*)::int AS n FROM baja_parte WHERE anulado_at IS NULL AND creado_at >= now() - ($1::int || ' days')::interval GROUP BY 1`, [dias]);
  return Object.fromEntries(r.rows.map(x => [x.tipo, x.n]));
}

/** ¿Está en el planificador ese día? (para dar por visto el aviso de su vuelta). */
async function planificadoEl(cli, conductorId, dia) {
  const r = await q(cli, `SELECT 1 FROM f_cobertura($2::date, $2::date) WHERE conductor_id = $1 LIMIT 1`, [conductorId, dia]);
  return r.rowCount > 0;
}

module.exports = { hayTabla, lista, situacion, abiertaDe, partesDe, insertarParte, ponerPrevista, recientes, planificadoEl };
