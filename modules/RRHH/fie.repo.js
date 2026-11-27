// ============================================================
// EL FICHERO FIE — el SQL (db/312)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));
const fecha = c => `to_char(${c}, 'YYYY-MM-DD')`;

async function hayTabla(cli = null) {
  return (await q(cli, `SELECT to_regclass('public.fie_proceso') IS NOT NULL AS hay`)).rows[0].hay;
}

/**
 * Guarda lo que dice el FIE de un proceso. Si ya estaba, solo lo pisa un FIE
 * del mismo día o posterior; si cambia algo, vuelve a «pendiente». → 'nuevo' | 'cambia' | 'igual' | 'viejo'
 */
async function guardar(cli, p, ficheroId) {
  const r = await q(cli,
    `INSERT INTO fie_proceso (dni, naf, nombre, fecha_baja, fecha_fin, causa_fin, contingencia, recaida, proceso_inicial,
                              duracion_estimada, revision, confirmacion, baja_anulada, alta_anulada, registro, fichero_id)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9::date, $10, $11::date, $12::date, $13, $14, $15::date, $16)
     ON CONFLICT (dni, fecha_baja) DO UPDATE SET
       naf = EXCLUDED.naf, nombre = EXCLUDED.nombre, fecha_fin = EXCLUDED.fecha_fin, causa_fin = EXCLUDED.causa_fin,
       contingencia = EXCLUDED.contingencia, recaida = EXCLUDED.recaida, proceso_inicial = EXCLUDED.proceso_inicial,
       duracion_estimada = EXCLUDED.duracion_estimada, revision = EXCLUDED.revision, confirmacion = EXCLUDED.confirmacion,
       baja_anulada = EXCLUDED.baja_anulada, alta_anulada = EXCLUDED.alta_anulada, registro = EXCLUDED.registro,
       fichero_id = EXCLUDED.fichero_id, actualizado_at = now(),
       estado = CASE WHEN (fie_proceso.fecha_fin, fie_proceso.revision, fie_proceso.baja_anulada, fie_proceso.alta_anulada, fie_proceso.contingencia)
                     IS DISTINCT FROM (EXCLUDED.fecha_fin, EXCLUDED.revision, EXCLUDED.baja_anulada, EXCLUDED.alta_anulada, EXCLUDED.contingencia)
                     THEN 'pendiente' ELSE fie_proceso.estado END
     WHERE fie_proceso.registro IS NULL OR EXCLUDED.registro IS NULL OR EXCLUDED.registro >= fie_proceso.registro
     RETURNING (xmax = 0) AS nuevo, estado`,
    [p.dni, p.naf, p.nombre, p.fechaBaja, p.fechaFin, p.causaFin, p.contingencia, p.recaida, p.procesoInicial,
      p.duracion, p.revision, p.confirmacion, p.bajaAnulada, p.altaAnulada, p.registro, ficheroId]);
  if (!r.rows.length) return 'viejo';
  return r.rows[0].nuevo ? 'nuevo' : (r.rows[0].estado === 'pendiente' ? 'cambia' : 'igual');
}

const SELECT = `
  SELECT f.id::text AS id, f.dni, f.naf, f.nombre, ${fecha('f.fecha_baja')} AS fecha_baja, ${fecha('f.fecha_fin')} AS fecha_fin,
         f.causa_fin, f.contingencia, f.recaida, ${fecha('f.revision')} AS revision, f.duracion_estimada,
         f.baja_anulada, f.alta_anulada, ${fecha('f.registro')} AS registro, f.estado, f.nota,
         f.conductor_id::text AS conductor_id, fi.nombre AS fichero,
         to_char(f.aplicado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS aplicado
    FROM fie_proceso f LEFT JOIN fichero_importado fi ON fi.id = f.fichero_id`;

async function todos(cli = null) {
  return (await q(cli, `${SELECT} ORDER BY f.dni, f.fecha_baja`)).rows;
}

async function marcar(cli, id, { estado, nota, conductorId = null }) {
  await q(cli, `UPDATE fie_proceso SET estado = $2::text, nota = $3, conductor_id = COALESCE($4::bigint, conductor_id),
                  aplicado_at = CASE WHEN $2::text IN ('aplicado', 'al_dia') THEN now() ELSE aplicado_at END, actualizado_at = now()
                 WHERE id = $1`, [id, estado, nota || null, conductorId]);
}

/** Las fichas por documento (sin las de pruebas). → Map(documento normalizado → { id, nombre, tipo }) */
async function fichasPorDni(cli = null) {
  const r = await q(cli,
    `SELECT c.id::text AS id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.dni_nie
       FROM conductor c WHERE NOT c.es_centinela AND NULLIF(btrim(c.dni_nie), '') IS NOT NULL${await pruebas.fuera('c')}`);
  return r.rows;
}

/** Las bajas médicas de esas personas, de la más vieja a la más nueva. */
async function bajasDe(cli, conductorIds) {
  if (!conductorIds.length) return [];
  return (await q(cli,
    `SELECT h.id::text AS id, h.conductor_id::text AS conductor_id, ${fecha('h.desde')} AS desde, ${fecha('h.hasta')} AS hasta,
            ${fecha('h.hasta_previsto')} AS prevista
       FROM conductor_estado_hist h
      WHERE h.estado = 'baja_medica' AND h.conductor_id = ANY($1::bigint[])
      ORDER BY h.conductor_id, h.desde`, [conductorIds])).rows;
}

/** Las bajas de la plantilla propia desde ese día, para ver cuáles no salen en ningún FIE. */
async function bajasDesde(cli, desde) {
  return (await q(cli,
    `SELECT h.id::text AS id, h.conductor_id::text AS conductor_id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre,
            c.dni_nie, ${fecha('h.desde')} AS desde, ${fecha('h.hasta')} AS hasta
       FROM conductor_estado_hist h JOIN conductor c ON c.id = h.conductor_id AND NOT c.es_centinela${await pruebas.fuera('c')}
      WHERE h.estado = 'baja_medica' AND COALESCE(h.hasta, 'infinity') >= $1::date
        AND EXISTS (SELECT 1 FROM conductor_periodo_empleo p WHERE p.conductor_id = c.id AND p.tipo = 'propia'
                     AND p.alta <= COALESCE(h.hasta, CURRENT_DATE) AND COALESCE(p.baja, 'infinity') >= h.desde)
      ORDER BY h.desde DESC`, [desde])).rows;
}

module.exports = { hayTabla, guardar, todos, marcar, fichasPorDni, bajasDe, bajasDesde };
