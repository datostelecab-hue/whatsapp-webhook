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

/** ¿Está aplicada db/265? Sin ella, Ruedas no avisa (la pantalla sí se ve). */
const faltaMigracion = e => e && (e.code === '42P01' || /ruedas_aviso/.test(String(e.message || '')));

module.exports = { candidatos, responsablesTaller, avisados, apuntarAviso, faltaMigracion };
