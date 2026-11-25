// ============================================================
// LAS AUSENCIAS QUE VALIDA RR. HH. — el SQL (módulo 1, db/289)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla() {
  const r = await db.consulta(`SELECT to_regclass('public.ausencia_rrhh') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

/**
 * De esos pares (persona, día), los de PLANTILLA PROPIA ese día (un contrato
 * propio que lo cubre), sin fichas de pruebas ni centinelas. → Set('id|dia')
 */
async function dePlantillaPropia(cli, pares) {
  if (!pares.length) return new Set();
  const r = await q(cli,
    `SELECT DISTINCT x.cid::text AS cid, to_char(x.dia, 'YYYY-MM-DD') AS dia
       FROM unnest($1::bigint[], $2::date[]) AS x(cid, dia)
       JOIN conductor c ON c.id = x.cid AND NOT c.es_centinela${await pruebas.fuera('c')}
       JOIN conductor_periodo_empleo e ON e.conductor_id = x.cid AND e.tipo = 'propia'
                                     AND e.alta <= x.dia AND (e.baja IS NULL OR e.baja >= x.dia)`,
    [pares.map(p => p.conductorId), pares.map(p => p.dia)]);
  return new Set(r.rows.map(x => `${x.cid}|${x.dia}`));
}

/**
 * La baja médica o el permiso que cubre cada par (persona, día), si lo hay.
 * → Map('id|dia' → { id, estado, desde, hasta, tipo })
 */
async function situacionesEn(cli, pares) {
  if (!pares.length) return new Map();
  const r = await q(cli,
    `SELECT x.cid::text AS cid, to_char(x.dia, 'YYYY-MM-DD') AS dia, h.id::text AS id, h.estado,
            to_char(h.desde, 'YYYY-MM-DD') AS desde, to_char(h.hasta, 'YYYY-MM-DD') AS hasta, lt.name AS tipo
       FROM unnest($1::bigint[], $2::date[]) AS x(cid, dia)
       JOIN conductor_estado_hist h ON h.conductor_id = x.cid AND h.estado IN ('baja_medica', 'permiso')
                                   AND h.desde <= x.dia AND (h.hasta IS NULL OR h.hasta >= x.dia)
       LEFT JOIN leave_type lt ON lt.leave_type_code = h.leave_type_code`,
    [pares.map(p => p.conductorId), pares.map(p => p.dia)]);
  return new Map(r.rows.map(x => [`${x.cid}|${x.dia}`, x]));
}

/** Las que ya hay desde `desde`, para comparar con lo que dice la bitácora. */
async function desde(cli, dia) {
  const r = await q(cli,
    `SELECT id::text AS id, conductor_id::text AS conductor_id, to_char(dia, 'YYYY-MM-DD') AS dia, estado,
            situacion_id::text AS situacion_id, automatica, to_char(detectada_el, 'YYYY-MM-DD') AS detectada_el
       FROM ausencia_rrhh WHERE dia >= $1::date`, [dia]);
  return r.rows;
}

/** Las nuevas, de una vez. → cuántas */
async function insertar(cli, pares, detectadaEl) {
  if (!pares.length) return 0;
  const r = await q(cli,
    `INSERT INTO ausencia_rrhh (conductor_id, dia, detectada_el)
     SELECT x.cid, x.dia, $3::date FROM unnest($1::bigint[], $2::date[]) AS x(cid, dia)
     ON CONFLICT (conductor_id, dia) DO NOTHING`,
    [pares.map(p => p.conductorId), pares.map(p => p.dia), detectadaEl]);
  return r.rowCount;
}

/**
 * Cambia el estado de una. Volver a «pendiente» la deja sin resolver y con el
 * día en que se volvió a ver (`detectadaEl`), que es la tarjeta que la recoge.
 */
async function cambiar(cli, id, { estado, nota = null, situacionId = null, resueltaPor = null, automatica = false, detectadaEl = null }) {
  const r = await q(cli,
    `UPDATE ausencia_rrhh
        SET estado = $2::varchar, nota = $3, situacion_id = $4,
            resuelta_at = CASE WHEN $2::varchar = 'pendiente' THEN NULL ELSE now() END,
            resuelta_por = CASE WHEN $2::varchar = 'pendiente' THEN NULL ELSE $5::int END,
            automatica = $6,
            detectada_el = COALESCE($7::date, detectada_el)
      WHERE id = $1
      RETURNING id::text AS id, to_char(detectada_el, 'YYYY-MM-DD') AS detectada_el`,
    [id, estado, nota, situacionId, resueltaPor, automatica, detectadaEl]);
  return r.rows[0] || null;
}

/** Las de una persona en un tramo (para resolverlas juntas al abrir una baja o un permiso). */
async function deEntre(cli, conductorId, desdeDia, hastaDia) {
  const r = await q(cli,
    `SELECT id::text AS id, estado, to_char(dia, 'YYYY-MM-DD') AS dia, to_char(detectada_el, 'YYYY-MM-DD') AS detectada_el
       FROM ausencia_rrhh
      WHERE conductor_id = $1 AND dia >= $2::date AND ($3::date IS NULL OR dia <= $3::date)
      FOR UPDATE`, [conductorId, desdeDia, hastaDia || null]);
  return r.rows;
}

/** ¿Quedan pendientes de ese día de detección? */
async function quedanDe(cli, detectadaEl) {
  const r = await q(cli, `SELECT count(*)::int AS n FROM ausencia_rrhh WHERE estado = 'pendiente' AND detectada_el = $1::date`, [detectadaEl]);
  return r.rows[0].n;
}

async function pendientes() {
  return (await db.consulta(`SELECT count(*)::int AS n FROM ausencia_rrhh WHERE estado = 'pendiente'`)).rows[0].n;
}

const SELECT = `
  SELECT a.id::text AS id, a.conductor_id::text AS conductor_id, to_char(a.dia, 'YYYY-MM-DD') AS dia,
         EXTRACT(ISODOW FROM a.dia)::int AS dow, a.estado, a.nota, a.automatica,
         a.situacion_id::text AS situacion_id,
         to_char(a.detectada_el, 'YYYY-MM-DD') AS detectada_el,
         to_char(a.resuelta_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS resuelta,
         NULLIF(btrim(COALESCE(r.nombre, '') || ' ' || COALESCE(NULLIF(r.apellidos, '.'), '')), '') AS resuelta_por_nombre,
         btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.legajo,
         h.estado AS situacion_estado, to_char(h.desde, 'YYYY-MM-DD') AS situacion_desde,
         to_char(h.hasta, 'YYYY-MM-DD') AS situacion_hasta, lt.name AS situacion_tipo
    FROM ausencia_rrhh a
    JOIN conductor c ON c.id = a.conductor_id
    LEFT JOIN usuario r ON r.id = a.resuelta_por
    LEFT JOIN conductor_estado_hist h ON h.id = a.situacion_id
    LEFT JOIN leave_type lt ON lt.leave_type_code = h.leave_type_code`;

async function lista() {
  return (await db.consulta(`${SELECT} ORDER BY a.dia DESC, nombre`)).rows;
}

async function porId(id, cli = null) {
  return (await q(cli, `${SELECT} WHERE a.id = $1`, [id])).rows[0] || null;
}

async function variasPorId(cli, ids) {
  return (await q(cli, `${SELECT} WHERE a.id = ANY($1::bigint[]) FOR UPDATE OF a`, [ids])).rows;
}

/**
 * EL % DE PLANTILLA DE BAJA, día a día: plantilla propia de alta ese día y
 * cuántos de ellos tenían una baja médica abierta. → [{ dia, alta, baja }]
 */
async function plantillaDeBaja(desdeDia, hastaDia) {
  const r = await db.consulta(
    `WITH d AS (SELECT g::date AS dia FROM generate_series($1::date, $2::date, interval '1 day') g)
     SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
            count(DISTINCT e.conductor_id)::int AS alta,
            count(DISTINCT e.conductor_id) FILTER (WHERE EXISTS (
              SELECT 1 FROM conductor_estado_hist h
               WHERE h.conductor_id = e.conductor_id AND h.estado = 'baja_medica'
                 AND h.desde <= d.dia AND (h.hasta IS NULL OR h.hasta >= d.dia)))::int AS baja
       FROM d
       JOIN conductor_periodo_empleo e ON e.tipo = 'propia' AND e.alta <= d.dia AND (e.baja IS NULL OR e.baja >= d.dia)
       JOIN conductor c ON c.id = e.conductor_id AND NOT c.es_centinela${await pruebas.fuera('c')}
      GROUP BY d.dia ORDER BY d.dia`, [desdeDia, hastaDia]);
  return r.rows;
}

module.exports = {
  hayTabla, pendientes, dePlantillaPropia, situacionesEn, desde, insertar, cambiar, deEntre, quedanDe,
  lista, porId, variasPorId, plantillaDeBaja,
};
