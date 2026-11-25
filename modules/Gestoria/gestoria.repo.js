// ============================================================
// LA PLANTILLA DE LA GESTORÍA — el SQL (módulo 8, db/287)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

/**
 * Las fichas con las que se cruza el listado (sin las de pruebas ni centinelas),
 * con su último periodo de empleo: el abierto o, si no hay, el último cerrado.
 */
async function personas(cli = null) {
  const r = await q(cli,
    `SELECT c.id::text AS id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.nombre_ss,
            c.legajo, c.dni_nie, c.empleo_vigente AS vigente,
            e.tipo, to_char(e.alta, 'YYYY-MM-DD') AS alta, to_char(e.baja, 'YYYY-MM-DD') AS baja
       FROM conductor c
       LEFT JOIN LATERAL (SELECT tipo, alta, baja FROM conductor_periodo_empleo pe
                           WHERE pe.conductor_id = c.id ORDER BY (pe.baja IS NULL) DESC, pe.alta DESC LIMIT 1) e ON TRUE
      WHERE NOT c.es_centinela${await pruebas.fuera('c')}`);
  return r.rows;
}

const SELECT = `
  SELECT d.id::text AS id, d.clave, d.tipo, d.conductor_id::text AS conductor_id, d.legajo, d.nombre_gestoria,
         d.detalle, d.estado, d.nota,
         btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre_erp, c.dni_nie,
         to_char(d.creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS detectada,
         to_char(d.enviada_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS enviada,
         to_char(d.resuelta_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS resuelta,
         NULLIF(btrim(COALESCE(r.nombre, '') || ' ' || COALESCE(NULLIF(r.apellidos, '.'), '')), '') AS resuelta_por_nombre,
         fu.nombre AS ultimo_fichero, fu.periodo AS ultimo_periodo
    FROM gestoria_discrepancia d
    LEFT JOIN conductor c ON c.id = d.conductor_id
    LEFT JOIN usuario r ON r.id = d.resuelta_por
    LEFT JOIN fichero_importado fu ON fu.id = d.ultimo_fichero_id`;

/** Las discrepancias: todas las pendientes y las cerradas de los últimos 90 días. */
async function lista() {
  const r = await db.consulta(`${SELECT}
     WHERE d.estado = 'pendiente' OR d.resuelta_at > now() - interval '90 days'
     ORDER BY (d.estado = 'pendiente') DESC, d.creado_at DESC, d.id DESC`);
  return r.rows;
}

async function porId(id, cli = null) {
  const r = await q(cli, `${SELECT} WHERE d.id = $1`, [id]);
  return r.rows[0] || null;
}

/** Las pendientes, por su clave (para sincronizar con una carga nueva). */
async function vivas(cli) {
  const r = await cli.query(`SELECT id::text AS id, clave FROM gestoria_discrepancia WHERE estado = 'pendiente' FOR UPDATE`);
  return new Map(r.rows.map(x => [x.clave, x.id]));
}

/** Las claves descartadas a mano: no vuelven a salir (alguien decidió que no son un problema). */
async function descartadas(cli) {
  const r = await cli.query(`SELECT DISTINCT clave FROM gestoria_discrepancia WHERE estado = 'descartada'`);
  return new Set(r.rows.map(x => x.clave));
}

async function insertar(cli, { clave, tipo, conductorId, legajo, nombreGestoria, detalle, ficheroId }) {
  await cli.query(
    `INSERT INTO gestoria_discrepancia (clave, tipo, conductor_id, legajo, nombre_gestoria, detalle, fichero_id, ultimo_fichero_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
    [clave, tipo, conductorId, legajo, nombreGestoria, JSON.stringify(detalle || {}), ficheroId]);
}

/** Sigue saliendo: se apunta con qué carga y se refresca lo que dice. */
async function sigue(cli, id, { detalle, nombreGestoria, ficheroId }) {
  await cli.query(
    `UPDATE gestoria_discrepancia SET ultimo_fichero_id = $2, detalle = $3::jsonb, nombre_gestoria = COALESCE($4, nombre_gestoria)
      WHERE id = $1`, [id, ficheroId, JSON.stringify(detalle || {}), nombreGestoria]);
}

/** Cierra una (resuelta o descartada), si sigue pendiente. → true si la cerró. */
async function cerrar(cli, id, { estado, nota, usuarioId = null }) {
  const r = await cli.query(
    `UPDATE gestoria_discrepancia SET estado = $2, nota = $3, resuelta_at = now(), resuelta_por = $4
      WHERE id = $1 AND estado = 'pendiente'`, [id, estado, nota, usuarioId]);
  return r.rowCount > 0;
}

async function marcarEnviadas(cli, ids, usuarioId) {
  const r = await cli.query(
    `UPDATE gestoria_discrepancia SET enviada_at = now(), enviada_por = $2
      WHERE id = ANY($1::bigint[]) AND estado = 'pendiente'`, [ids.map(Number), usuarioId]);
  return r.rowCount;
}

/** ¿Existe la tabla? (db/287 sin aplicar: la pantalla lo dice). */
async function hayTabla() {
  const r = await db.consulta(`SELECT to_regclass('public.gestoria_discrepancia') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

module.exports = { personas, lista, porId, vivas, descartadas, insertar, sigue, cerrar, marcarEnviadas, hayTabla };
