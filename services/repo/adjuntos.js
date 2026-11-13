// ============================================================
// LOS ADJUNTOS — el SQL (db/249)
// ============================================================
// Solo datos: quién puede ver o adjuntar, dónde van los bytes y cómo se sirven
// está en services/adjuntos.js.
'use strict';

const db = require('../db');

const QUIEN = col => `btrim(COALESCE(${col}.nombre, '') || ' ' || COALESCE(NULLIF(${col}.apellidos, '.'), ''))`;

const SELECT = `
  SELECT a.id, a.dueno_tipo, a.dueno_id, a.almacen, a.ruta, a.nombre, a.mime, a.bytes, a.sha256,
         a.creado_at, a.creado_por, a.anulado_at, a.anulado_por, a.anulado_motivo,
         NULLIF(${QUIEN('c')}, '') AS creado_por_nombre,
         NULLIF(${QUIEN('n')}, '') AS anulado_por_nombre
    FROM adjunto a
    LEFT JOIN usuario c ON c.id = a.creado_por
    LEFT JOIN usuario n ON n.id = a.anulado_por`;

const fila = r => (r ? { ...r, id: Number(r.id), bytes: Number(r.bytes) } : null);

async function insertar(cli, { duenoTipo, duenoId, almacen, ruta, nombre, mime, bytes, sha256, creadoPor }) {
  const r = await cli.query(
    `INSERT INTO adjunto (dueno_tipo, dueno_id, almacen, ruta, nombre, mime, bytes, sha256, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [duenoTipo, duenoId, almacen, ruta, nombre, mime, bytes, sha256, creadoPor]);
  return Number(r.rows[0].id);
}

async function porId(id) {
  const r = await db.consulta(`${SELECT} WHERE a.id = $1`, [id]);
  return fila(r.rows[0]);
}

/** Los de un dueño, del más viejo al más nuevo. */
async function deDueno(duenoTipo, duenoId, { conAnulados = false } = {}) {
  const r = await db.consulta(
    `${SELECT} WHERE a.dueno_tipo = $1 AND a.dueno_id = $2 AND ($3 OR a.anulado_at IS NULL)
      ORDER BY a.creado_at, a.id`, [duenoTipo, duenoId, conAnulados]);
  return r.rows.map(fila);
}

async function anular(cli, { id, motivo, anuladoPor }) {
  const r = await cli.query(
    `UPDATE adjunto SET anulado_at = now(), anulado_motivo = $2, anulado_por = $3
      WHERE id = $1 AND anulado_at IS NULL RETURNING id`, [id, motivo, anuladoPor]);
  return r.rowCount > 0;
}

module.exports = { insertar, porId, deDueno, anular };
