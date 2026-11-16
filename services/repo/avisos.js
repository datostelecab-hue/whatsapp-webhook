// ============================================================
// LOS AVISOS — el SQL (db/254)
// ============================================================
// Solo consultas. A quién le llega y quién puede qué lo decide services/avisos.js.
// Lo que escribe en `aviso` recibe el `cli` de la transacción firmada
// (libro.conFirma): el aviso y su rastro en el libro entran juntos.
'use strict';

const db = require('../db');

const q = (cli, sql, vals) => (cli || { query: (s, v) => db.consulta(s, v) }).query(sql, vals);

const COLUMNAS = `a.id, a.tipo, a.modulo, a.origen_id, a.titulo, a.texto, a.enlace, a.urgente,
  a.area_codigo, a.usuario_id, a.caduca_at, a.creado_at, a.creado_por, a.estado,
  a.cerrado_at, a.cerrado_por, a.cerrado_solo, a.nota,
  NULLIF(btrim(concat_ws(' ', c.nombre, c.apellidos)), '') AS cerrado_por_nombre`;
const DESDE = 'FROM aviso a LEFT JOIN usuario c ON c.id = a.cerrado_por';
// Abierto y sin caducar: lo que todavía hay que atender.
const VIVO = `a.estado = 'abierto' AND (a.caduca_at IS NULL OR a.caduca_at > now())`;
// De quien mira: a su nombre o a una de sus áreas.
const SUYO = n => `(a.usuario_id = $${n} OR a.area_codigo = ANY($${n + 1}::text[]))`;

async function uno(cli, id, { bloquear = false } = {}) {
  const r = await q(cli, `SELECT ${COLUMNAS} ${DESDE} WHERE a.id = $1${bloquear ? ' FOR UPDATE OF a' : ''}`, [id]);
  return r.rows[0] || null;
}

/** El aviso de una cosa de origen (en cualquier estado), o null. */
async function porOrigen(cli, tipo, origenId) {
  const r = await q(cli, `SELECT ${COLUMNAS} ${DESDE} WHERE a.tipo = $1 AND a.origen_id = $2`, [tipo, String(origenId)]);
  return r.rows[0] || null;
}

async function insertar(cli, x) {
  const r = await q(cli,
    `INSERT INTO aviso (tipo, modulo, origen_id, titulo, texto, enlace, urgente, area_codigo, usuario_id, caduca_at, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [x.tipo, x.modulo, x.origenId == null ? null : String(x.origenId), x.titulo, x.texto || null, x.enlace || null,
      !!x.urgente, x.area || null, x.usuarioId || null, x.caducaAt || null, x.creadoPor || null]);
  return Number(r.rows[0].id);
}

/** Lo cierra (resuelto, caducado o anulado) si sigue abierto. → true si lo cerró. */
async function cerrar(cli, id, { estado, por = null, solo = false, nota = null }) {
  const r = await q(cli,
    `UPDATE aviso SET estado = $2, cerrado_at = now(), cerrado_por = $3, cerrado_solo = $4, nota = $5
      WHERE id = $1 AND estado = 'abierto' RETURNING id`, [id, estado, por, !!solo, nota]);
  return r.rows.length > 0;
}

/**
 * Los vivos de quien mira, con si los ha leído él: los urgentes y los sin leer
 * primero, y dentro, los más nuevos.
 */
async function vivosDe(usuarioId, areas, { limite = 200 } = {}) {
  const r = await db.consulta(
    `SELECT ${COLUMNAS},
            EXISTS (SELECT 1 FROM aviso_lectura l WHERE l.aviso_id = a.id AND l.usuario_id = $1) AS leido
       ${DESDE}
      WHERE ${VIVO} AND ${SUYO(1)}
      ORDER BY a.urgente DESC, leido, a.creado_at DESC
      LIMIT $3`, [usuarioId, areas, limite]);
  return r.rows;
}

/** Cuántos vivos sin leer tiene, por módulo, y cuántos de ellos urgentes. */
async function sinLeer(usuarioId, areas) {
  const r = await db.consulta(
    `SELECT a.modulo, count(*)::int AS n, count(*) FILTER (WHERE a.urgente)::int AS urgentes
       FROM aviso a
      WHERE ${VIVO} AND ${SUYO(1)}
        AND NOT EXISTS (SELECT 1 FROM aviso_lectura l WHERE l.aviso_id = a.id AND l.usuario_id = $1)
      GROUP BY a.modulo`, [usuarioId, areas]);
  return r.rows;
}

/** Apunta que los ha leído (los que no lo estaban). → cuántos nuevos. */
async function leer(usuarioId, ids) {
  if (!ids.length) return 0;
  const r = await db.consulta(
    `INSERT INTO aviso_lectura (aviso_id, usuario_id)
     SELECT x, $1 FROM unnest($2::bigint[]) AS x
     ON CONFLICT (aviso_id, usuario_id) DO NOTHING RETURNING aviso_id`, [usuarioId, ids]);
  return r.rows.length;
}

/** Los ids vivos de quien mira entre los pedidos (para no leer lo que no es suyo). */
async function suyosEntre(usuarioId, areas, ids) {
  const r = await db.consulta(
    `SELECT a.id FROM aviso a WHERE a.id = ANY($3::bigint[]) AND ${VIVO} AND ${SUYO(1)}`, [usuarioId, areas, ids]);
  return r.rows.map(x => Number(x.id));
}

/** Pasa a «caducado» lo que ya pasó su hora. → los que cerró, con su destino. */
async function caducar(cli) {
  const r = await q(cli,
    `UPDATE aviso SET estado = 'caducado', cerrado_at = now(), cerrado_solo = TRUE, nota = 'Pasó su hora'
      WHERE estado = 'abierto' AND caduca_at IS NOT NULL AND caduca_at <= now()
      RETURNING id, area_codigo, usuario_id`);
  return r.rows;
}

// ── Para los tipos que se repasan solos (services/avisos.js → sincronizar) ──
async function abiertosDe(tipo) {
  const r = await db.consulta(
    `SELECT id, origen_id FROM aviso WHERE tipo = $1 AND origen_id IS NOT NULL AND estado = 'abierto'`, [tipo]);
  return r.rows;
}
async function deOrigenes(tipo, origenIds) {
  if (!origenIds.length) return [];
  const r = await db.consulta(
    `SELECT id, origen_id, estado FROM aviso WHERE tipo = $1 AND origen_id = ANY($2::text[])`, [tipo, origenIds.map(String)]);
  return r.rows;
}

module.exports = { uno, porOrigen, insertar, cerrar, vivosDe, sinLeer, leer, suyosEntre, caducar, abiertosDe, deOrigenes };
