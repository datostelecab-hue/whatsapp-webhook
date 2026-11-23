// ============================================================
// PLAZAS RESERVADAS — el SQL (db/277, 23/11/2026)
// ============================================================
// Desde fuera se entra por reservas.service.js. Aquí solo se lee y se escribe.
'use strict';

const db = require('../../services/db');

const q = (cli, sql, vals) => (cli ? cli.query(sql, vals) : db.consulta(sql, vals));
const NOMBRE = a => `COALESCE(NULLIF(btrim(${a}.nombre_bolt), ''), btrim(${a}.nombre || ' ' || COALESCE(${a}.apellidos, '')))`;

/**
 * EL DÍA QUE LLEGA una persona: su alta si ya se la dieron con fecha (el
 * contrato abierto), y si no, el inicio previsto de su candidatura viva.
 */
const LLEGA = a => `COALESCE(
  (SELECT min(pe.alta) FROM conductor_periodo_empleo pe WHERE pe.conductor_id = ${a} AND pe.baja IS NULL),
  (SELECT cd.inicio_previsto FROM candidatura cd WHERE cd.conductor_id = ${a} AND cd.cerrado_at IS NULL
    ORDER BY cd.id DESC LIMIT 1))`;

/** ¿Está aplicada db/277? Sin ella, el planificador se ve como siempre, sin reservas. */
const falta = e => e && e.code === '42P01' && /plaza_reserva/.test(String(e.message || ''));

/** Las reservas abiertas, con su persona y el día que llega. [] sin db/277. */
async function abiertas(cli = null) {
  try {
    const r = await q(cli,
      `SELECT r.id, r.plaza_id, r.conductor_id, r.nota, r.asignacion_id, r.creado_at,
              ${NOMBRE('c')} AS nombre,
              to_char(${LLEGA('r.conductor_id')}, 'YYYY-MM-DD') AS llega,
              (SELECT CASE WHEN cd.canal = 'bolsa_ett' OR upper(COALESCE(cd.tipo_contrato, '')) = 'ETT' THEN 'ett' ELSE 'propia' END
                 FROM candidatura cd WHERE cd.conductor_id = r.conductor_id ORDER BY cd.id DESC LIMIT 1) AS tipo,
              to_char(a.desde, 'YYYY-MM-DD') AS planificada_desde,
              btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS por
         FROM plaza_reserva r
         LEFT JOIN conductor c ON c.id = r.conductor_id
         LEFT JOIN asignacion a ON a.id = r.asignacion_id
         LEFT JOIN usuario u ON u.id = r.creado_por
        WHERE r.cerrada_at IS NULL
        ORDER BY r.id`);
    return r.rows;
  } catch (e) {
    if (falta(e)) return [];
    throw e;
  }
}

async function una(cli, id) {
  const r = await q(cli,
    `SELECT r.*, to_char(${LLEGA('r.conductor_id')}, 'YYYY-MM-DD') AS llega, ${NOMBRE('c')} AS nombre
       FROM plaza_reserva r LEFT JOIN conductor c ON c.id = r.conductor_id WHERE r.id = $1`, [id]);
  return r.rows[0] || null;
}

/**
 * QUIÉN ESTÁ EN PROCESO DE ALTA, para reservarle una plaza: las candidaturas
 * vivas (ETT o propia) que no han salido ni están ya colocadas, y quien ya tiene
 * el alta dada con fecha futura. Con el día que llega, si se sabe.
 */
async function enProceso() {
  const r = await db.consulta(
    `WITH gente AS (
       SELECT cd.conductor_id,
              CASE WHEN cd.canal = 'bolsa_ett' OR upper(COALESCE(cd.tipo_contrato, '')) = 'ETT' THEN 'ett' ELSE 'propia' END AS tipo,
              e.etiqueta AS estado
         FROM candidatura cd JOIN cat_estado_candidatura e ON e.codigo = cd.estado
        WHERE cd.cerrado_at IS NULL AND NOT e.es_salida AND cd.estado <> 'asignado' AND cd.conductor_id IS NOT NULL
       UNION
       SELECT pe.conductor_id, CASE WHEN upper(COALESCE(pe.tipo, '')) = 'ETT' THEN 'ett' ELSE 'propia' END, 'Alta con fecha'
         FROM conductor_periodo_empleo pe
        WHERE pe.baja IS NULL AND pe.alta > (now() AT TIME ZONE 'Europe/Madrid')::date)
     SELECT DISTINCT ON (g.conductor_id) g.conductor_id AS id, ${NOMBRE('c')} AS nombre, g.tipo, g.estado,
            to_char(${LLEGA('g.conductor_id')}, 'YYYY-MM-DD') AS llega,
            EXISTS (SELECT 1 FROM plaza_reserva r WHERE r.conductor_id = g.conductor_id AND r.cerrada_at IS NULL) AS reservada
       FROM gente g JOIN conductor c ON c.id = g.conductor_id
      ORDER BY g.conductor_id`);
  return r.rows;
}

async function crear(cli, { plazaId, conductorId, nota, usuarioId }) {
  const r = await q(cli,
    `INSERT INTO plaza_reserva (plaza_id, conductor_id, nota, creado_por) VALUES ($1, $2, $3, $4) RETURNING id`,
    [plazaId, conductorId || null, nota || null, usuarioId || null]);
  return Number(r.rows[0].id);
}

async function ponerAsignacion(cli, id, asignacionId) {
  await q(cli, 'UPDATE plaza_reserva SET asignacion_id = $2 WHERE id = $1', [id, asignacionId]);
}

async function cerrar(cli, id, { motivo, usuarioId }) {
  const r = await q(cli,
    `UPDATE plaza_reserva SET cerrada_at = now(), cerrada_por = $2, cerrada_motivo = $3
      WHERE id = $1 AND cerrada_at IS NULL RETURNING id`, [id, usuarioId || null, motivo]);
  return r.rows.length > 0;
}

/** La asignación de esa persona en esa plaza que empieza ese día (la que sale de la reserva). */
async function asignacionDesde(cli, { plazaId, conductorId, desde }) {
  const r = await q(cli,
    `SELECT id FROM asignacion WHERE plaza_id = $1 AND conductor_id = $2 AND desde = $3::date
      ORDER BY id DESC LIMIT 1`, [plazaId, conductorId, desde]);
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

async function asignacion(cli, id) {
  const r = await q(cli, `SELECT id, plaza_id, conductor_id, to_char(desde, 'YYYY-MM-DD') AS desde FROM asignacion WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function plazaExiste(plazaId) {
  const r = await db.consulta('SELECT 1 FROM plaza WHERE id = $1 AND baja_at IS NULL', [plazaId]);
  return r.rows.length > 0;
}

module.exports = { abiertas, una, enProceso, crear, ponerAsignacion, cerrar, asignacionDesde, asignacion, plazaExiste, falta };
