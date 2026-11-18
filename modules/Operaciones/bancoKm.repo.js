// ============================================================
// EL BANCO DE KM — el SQL (db/267, 18/11/2026)
// ============================================================
// Desde fuera se entra por bancoKm.service.js. Aquí solo se lee y se escribe la
// foto de cada jornada (km_banco_dia, km_banco_coche, km_banco_calculo).
'use strict';

const db = require('../../services/db');

const q = (cli, sql, params) => (cli ? cli.query(sql, params) : db.consulta(sql, params));
const n1 = v => Math.round((Number(v) || 0) * 10) / 10;

/** Los días ya calculados entre dos fechas: Set('aaaa-mm-dd'). */
async function calculados(desde, hasta, cli = null) {
  const r = await q(cli,
    `SELECT to_char(dia, 'YYYY-MM-DD') AS dia FROM km_banco_calculo WHERE dia BETWEEN $1::date AND $2::date`, [desde, hasta]);
  return new Set(r.rows.map(x => x.dia));
}

/** Cuándo se calculó cada día de un rango: Map(dia → { at, usuario }). */
async function calculos(desde, hasta) {
  const r = await db.consulta(
    `SELECT to_char(k.dia, 'YYYY-MM-DD') AS dia, k.calculado_at, k.usuario_id,
            btrim(u.nombre || COALESCE(' ' || u.apellidos, '')) AS usuario
       FROM km_banco_calculo k LEFT JOIN usuario u ON u.id = k.usuario_id
      WHERE k.dia BETWEEN $1::date AND $2::date`, [desde, hasta]);
  return new Map(r.rows.map(x => [x.dia, { at: x.calculado_at, usuario: x.usuario || null }]));
}

/**
 * Guarda la foto de una jornada: borra la que hubiera y escribe la nueva, todo
 * con `cli` (la transacción de quien la llama). `filas`: las personas del día;
 * `coches`: sus km coche a coche.
 */
async function guardarDia(cli, dia, { filas, coches, milisegundos, usuarioId }) {
  await cli.query('DELETE FROM km_banco_dia WHERE dia = $1::date', [dia]);
  if (filas.length) {
    await cli.query(
      `INSERT INTO km_banco_dia (dia, persona, conductor_id, nombre, turno, programado, trabajo, horas, oficina,
                                 justificado, limite_km, km_fuera, revisar, fichaje, sin_fichar)
       SELECT $1::date, x.persona, c.id, x.nombre, x.turno, x.programado, x.trabajo, x.horas, x.oficina,
              x.justificado, x.limite_km, x.km_fuera, x.revisar, x.fichaje, x.sin_fichar
         FROM jsonb_to_recordset($2::jsonb) AS x(persona text, conductor_id bigint, nombre text, turno text,
              programado boolean, trabajo boolean, horas numeric, oficina boolean, justificado boolean,
              limite_km numeric, km_fuera numeric, revisar boolean, fichaje text, sin_fichar boolean)
         LEFT JOIN conductor c ON c.id = x.conductor_id`,
      [dia, JSON.stringify(filas)]);
  }
  if (coches.length) {
    await cli.query(
      `INSERT INTO km_banco_coche (dia, persona, matricula, km_fuera)
       SELECT $1::date, x.persona, x.matricula, x.km_fuera
         FROM jsonb_to_recordset($2::jsonb) AS x(persona text, matricula text, km_fuera numeric)`,
      [dia, JSON.stringify(coches)]);
  }
  await cli.query(
    `INSERT INTO km_banco_calculo (dia, calculado_at, personas, km_fuera, milisegundos, usuario_id)
     VALUES ($1::date, now(), $2, $3, $4, $5)
     ON CONFLICT (dia) DO UPDATE SET calculado_at = now(), personas = EXCLUDED.personas, km_fuera = EXCLUDED.km_fuera,
                                     milisegundos = EXCLUDED.milisegundos, usuario_id = EXCLUDED.usuario_id`,
    [dia, filas.length, n1(filas.reduce((s, f) => s + (Number(f.km_fuera) || 0), 0)), milisegundos || null, usuarioId || null]);
}

/** Las personas de unos días, con sus coches. */
async function dias(desde, hasta) {
  const [p, c] = await Promise.all([
    db.consulta(
      `SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia, d.persona, d.conductor_id, d.nombre, d.turno, d.programado, d.trabajo,
              d.horas, d.oficina, d.justificado, d.limite_km, d.km_fuera, d.revisar, d.fichaje, d.sin_fichar
         FROM km_banco_dia d
        WHERE d.dia BETWEEN $1::date AND $2::date
        ORDER BY d.dia`, [desde, hasta]),
    db.consulta(
      `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, persona, matricula, km_fuera
         FROM km_banco_coche WHERE dia BETWEEN $1::date AND $2::date ORDER BY dia, km_fuera DESC`, [desde, hasta]),
  ]);
  return {
    personas: p.rows.map(x => ({
      dia: x.dia, persona: x.persona, conductorId: x.conductor_id == null ? null : Number(x.conductor_id), nombre: x.nombre,
      turno: x.turno, programado: x.programado, trabajo: x.trabajo, horas: n1(x.horas), oficina: x.oficina,
      justificado: x.justificado, limite: n1(x.limite_km), km: n1(x.km_fuera), revisar: x.revisar,
      fichaje: x.fichaje, sinFichar: x.sin_fichar,
    })),
    coches: c.rows.map(x => ({ dia: x.dia, persona: x.persona, matricula: x.matricula, km: n1(x.km_fuera) })),
  };
}

/** Las semanas de una persona (lunes → { limite, km, dias }), desde un lunes. */
async function semanasDe(persona, desde, hasta) {
  const r = await db.consulta(
    `SELECT to_char(date_trunc('week', dia)::date, 'YYYY-MM-DD') AS lunes,
            sum(limite_km) AS limite, sum(km_fuera) AS km, count(*) FILTER (WHERE limite_km > 0)::int AS dias
       FROM km_banco_dia
      WHERE persona = $1 AND dia BETWEEN $2::date AND $3::date
      GROUP BY 1 ORDER BY 1 DESC`, [persona, desde, hasta]);
  return r.rows.map(x => ({ lunes: x.lunes, limite: n1(x.limite), km: n1(x.km), dias: x.dias }));
}

const faltaMigracion = e => e && (e.code === '42P01' || /km_banco_/.test(String(e.message || '')));

module.exports = { calculados, calculos, guardarDia, dias, semanasDe, faltaMigracion };
