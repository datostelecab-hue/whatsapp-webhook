// ============================================================
// RUEDAS — el SQL (db/265, 18/11/2026)
// ============================================================
// Desde fuera se entra por ruedas.service.js. Aquí solo se lee y se escribe:
// qué es un cambio de ruedas lo decide el servicio.
'use strict';

const db = require('../../services/db');

const q = (cli, sql, params) => (cli ? cli.query(sql, params) : db.consulta(sql, params));

/**
 * Los mantenimientos que PUEDEN ser un cambio de ruedas: los de tipo neumáticos
 * y los que llevan alguna pieza de neumáticos, con esas piezas. Que lo sean de
 * verdad (una cubierta nueva, no un pinchazo) lo decide el servicio.
 */
async function candidatos(cli = null) {
  const r = await q(cli,
    `SELECT m.id, m.vehiculo_id, m.km, to_char(m.fecha, 'YYYY-MM-DD') AS fecha, m.taller, m.referencia,
            m.origen, m.tipo, m.descripcion,
            COALESCE(json_agg(json_build_object('d', p.descripcion, 'c', p.cantidad))
                     FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS piezas
       FROM mantenimiento m
       LEFT JOIN mantenimiento_pieza p ON p.mantenimiento_id = m.id AND p.categoria = 'neumaticos'
      WHERE m.anulado_at IS NULL
        AND (m.tipo = 'neumaticos'
             OR EXISTS (SELECT 1 FROM mantenimiento_pieza x WHERE x.mantenimiento_id = m.id AND x.categoria = 'neumaticos'))
      GROUP BY m.id`);
  return r.rows.map(x => ({ ...x, id: Number(x.id), vehiculo_id: Number(x.vehiculo_id), km: x.km == null ? null : Number(x.km) }));
}

/** Quién recibe los avisos: quien tiene el puesto de responsable de taller (Óscar). */
async function responsablesTaller(cli = null) {
  const r = await q(cli,
    `SELECT u.id FROM usuario u
      WHERE u.puesto_codigo = 'responsable_taller' AND u.estado = 'activo'
      ORDER BY u.id`);
  return r.rows.map(x => Number(x.id));
}

/** Los avisos ya dados: Set('vehiculoId|cambioId'). */
async function avisados(cli = null) {
  const r = await q(cli, 'SELECT vehiculo_id, cambio_id FROM ruedas_aviso');
  return new Set(r.rows.map(x => `${x.vehiculo_id}|${x.cambio_id || 0}`));
}

async function apuntarAviso(cli, { vehiculoId, cambioId, kmDesde, mensajeId }) {
  await q(cli,
    `INSERT INTO ruedas_aviso (vehiculo_id, cambio_id, km_desde, mensaje_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`, [vehiculoId, cambioId || null, kmDesde, mensajeId || null]);
}

// ── Las revisiones (db/275, 23/11/2026) ────────────────────────────────────
// Mirar cómo están y apuntar lo visto. No son cambios: no cuentan para los km.

/** Las revisiones vigentes de toda la flota, de la más nueva a la más vieja. [] sin db/275. */
async function revisiones(cli = null) {
  try {
    const r = await q(cli,
      `SELECT x.id, x.vehiculo_id, to_char(x.fecha, 'YYYY-MM-DD') AS fecha, x.km, x.observacion,
              NULLIF(btrim(concat_ws(' ', u.nombre, u.apellidos)), '') AS por, x.creado_at
         FROM ruedas_revision x LEFT JOIN usuario u ON u.id = x.creado_por
        WHERE x.anulado_at IS NULL
        ORDER BY x.fecha DESC, x.id DESC`);
    return r.rows.map(x => ({ ...x, id: Number(x.id), vehiculo_id: Number(x.vehiculo_id), km: x.km == null ? null : Number(x.km) }));
  } catch (e) {
    if (e && e.code === '42P01') return [];   // db/275 sin aplicar
    throw e;
  }
}

async function apuntarRevision(cli, { vehiculoId, fecha, km, observacion, usuarioId }) {
  const r = await q(cli,
    `INSERT INTO ruedas_revision (vehiculo_id, fecha, km, observacion, creado_por)
     VALUES ($1, $2::date, $3, $4, $5) RETURNING id`, [vehiculoId, fecha, km, observacion, usuarioId || null]);
  return Number(r.rows[0].id);
}

/** La revisión (vigente) con su coche, para comprobar la sede antes de anularla. */
async function revision(cli, id) {
  const r = await q(cli, 'SELECT id, vehiculo_id FROM ruedas_revision WHERE id = $1 AND anulado_at IS NULL', [id]);
  return r.rows[0] ? { id: Number(r.rows[0].id), vehiculoId: Number(r.rows[0].vehiculo_id) } : null;
}

async function anularRevision(cli, { id, motivo, usuarioId }) {
  const r = await q(cli,
    `UPDATE ruedas_revision SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1 AND anulado_at IS NULL RETURNING id`, [id, usuarioId || null, motivo]);
  return r.rows.length > 0;
}

/** ¿Está aplicada db/265? Sin ella, Ruedas no avisa (la pantalla sí se ve). */
const faltaMigracion = e => e && (e.code === '42P01' || /ruedas_aviso/.test(String(e.message || '')));

module.exports = { candidatos, responsablesTaller, avisados, apuntarAviso, faltaMigracion, revisiones, apuntarRevision, revision, anularRevision };
