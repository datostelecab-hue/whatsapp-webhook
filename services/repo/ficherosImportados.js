// ============================================================
// LOS FICHEROS IMPORTADOS — el SQL (db/284)
// ============================================================
// Solo datos: qué se hace con cada fichero lo decide el módulo que lo carga, y
// la puerta común está en services/ficherosImportados.js.
'use strict';

const db = require('../db');

const QUIEN = col => `NULLIF(btrim(COALESCE(${col}.nombre, '') || ' ' || COALESCE(NULLIF(${col}.apellidos, '.'), '')), '')`;

const SELECT = `
  SELECT f.id::text AS id, f.tipo, f.periodo, f.nombre, f.sha256, f.bytes, f.adjunto_id::text AS adjunto_id,
         f.estructura, f.resultado, f.incidencias, f.estado, f.subido_por,
         ${QUIEN('u')} AS subido_por_nombre,
         to_char(f.creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS cuando,
         f.creado_at
    FROM fichero_importado f
    LEFT JOIN usuario u ON u.id = f.subido_por`;

/** La carga viva de ese fichero (mismo tipo y misma huella), o null. */
async function cargaViva(tipo, sha256, cli = null) {
  const q = `${SELECT} WHERE f.tipo = $1 AND f.sha256 = $2 AND f.estado = 'cargado'`;
  const r = cli ? await cli.query(q, [tipo, sha256]) : await db.consulta(q, [tipo, sha256]);
  return r.rows[0] || null;
}

async function insertar(cli, { tipo, periodo, nombre, sha256, bytes, estructura, resultado, incidencias, subidoPor }) {
  const r = await cli.query(
    `INSERT INTO fichero_importado (tipo, periodo, nombre, sha256, bytes, estructura, resultado, incidencias, subido_por)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9) RETURNING id::text AS id`,
    [tipo, periodo || null, nombre, sha256, bytes || null, JSON.stringify(estructura || null),
      JSON.stringify(resultado || null), incidencias || 0, subidoPor || null]);
  return r.rows[0].id;
}

async function ponerAdjunto(id, adjuntoId) {
  await db.consulta('UPDATE fichero_importado SET adjunto_id = $2 WHERE id = $1', [id, adjuntoId]);
}

async function porId(id) {
  const r = await db.consulta(`${SELECT} WHERE f.id = $1`, [id]);
  return r.rows[0] || null;
}

/** Las últimas cargas de un tipo, de la más nueva a la más vieja. */
async function deTipo(tipo, { limite = 20 } = {}) {
  const r = await db.consulta(`${SELECT} WHERE f.tipo = $1 ORDER BY f.creado_at DESC, f.id DESC LIMIT $2`, [tipo, limite]);
  return r.rows;
}

/** ¿Existe la tabla? (db/284 sin aplicar: el módulo lo dice, no se rompe). */
async function hayTabla() {
  const r = await db.consulta(`SELECT to_regclass('public.fichero_importado') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

module.exports = { cargaViva, insertar, ponerAdjunto, porId, deTipo, hayTabla };
