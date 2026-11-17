// ============================================================
// TAREAS PROGRAMADAS DE NEGOCIO — el SQL (db/246)
// ============================================================
// Solo datos: cuándo toca, cuántas veces se reintenta y qué se guarda lo decide
// services/tareasProgramadas.js.
'use strict';

const db = require('../db');

/**
 * El cerrojo de (tarea, periodo) para esta transacción. Lo suelta la base al
 * acabarla, también si el proceso muere: nadie se queda «en curso» para siempre.
 */
async function bloquear(cli, tarea, periodo) {
  const r = await cli.query(`SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS ok`, [tarea, periodo]);
  return r.rows[0].ok === true;
}

async function estaHecha(cli, tarea, periodo) {
  const r = await cli.query(
    `SELECT 1 FROM tarea_programada_vez WHERE tarea = $1 AND periodo = $2 AND estado = 'hecha' LIMIT 1`, [tarea, periodo]);
  return r.rows.length > 0;
}

/** Cuántas veces ha fallado esta vez y hace cuántos minutos el último fallo. */
async function fallos(cli, tarea, periodo) {
  const r = await cli.query(
    `SELECT count(*)::int AS n,
            EXTRACT(EPOCH FROM clock_timestamp() - max(acabada_at)) / 60 AS minutos
       FROM tarea_programada_vez
      WHERE tarea = $1 AND periodo = $2 AND estado = 'fallida'`, [tarea, periodo]);
  return { n: r.rows[0].n, minutos: r.rows[0].minutos == null ? null : Number(r.rows[0].minutos) };
}

/** Apunta la vez como hecha, DENTRO de la transacción de su trabajo. */
async function apuntarHecha(cli, { tarea, periodo, empezada, resultado, instancia }) {
  await cli.query(
    `INSERT INTO tarea_programada_vez (tarea, periodo, estado, empezada_at, acabada_at, resultado, instancia)
     VALUES ($1, $2, 'hecha', $3, clock_timestamp(), $4::jsonb, $5)`,
    [tarea, periodo, empezada, resultado, instancia]);
}

/** Apunta un intento fallido, fuera de la transacción que se deshizo. */
async function apuntarFallida({ tarea, periodo, empezada, error, instancia }) {
  await db.consulta(
    `INSERT INTO tarea_programada_vez (tarea, periodo, estado, empezada_at, acabada_at, error, instancia)
     VALUES ($1, $2, 'fallida', $3, clock_timestamp(), $4, $5)`,
    [tarea, periodo, empezada, error, instancia]);
}

/** Los últimos intentos (de una tarea o de todas), del más nuevo al más viejo. */
async function ultimas({ tarea, limite }) {
  const r = await db.consulta(
    `SELECT id, tarea, periodo, estado, empezada_at, acabada_at, resultado, error, instancia
       FROM tarea_programada_vez
      WHERE $1::text IS NULL OR tarea = $1
      ORDER BY empezada_at DESC, id DESC
      LIMIT $2`, [tarea, limite]);
  return r.rows.map(f => ({ ...f, id: Number(f.id) }));
}

module.exports = { bloquear, estaHecha, fallos, apuntarHecha, apuntarFallida, ultimas };
