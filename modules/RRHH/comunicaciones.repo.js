// ============================================================
// LA COMUNICACIÓN SEMANAL DE HORAS — el SQL (db/294)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

/** Plantilla propia con contrato en la semana: su jornada y las fechas del contrato. */
async function propiaEnSemana(lunes, domingo) {
  const r = await db.consulta(
    `SELECT e.conductor_id::text AS conductor_id, e.jornada_horas,
            to_char(e.alta, 'YYYY-MM-DD') AS alta, to_char(e.baja, 'YYYY-MM-DD') AS baja
       FROM conductor_periodo_empleo e
       JOIN conductor c ON c.id = e.conductor_id AND NOT c.es_centinela${await pruebas.fuera('c')}
      WHERE e.tipo = 'propia' AND e.alta <= $2::date AND (e.baja IS NULL OR e.baja >= $1::date)
      ORDER BY e.conductor_id, e.alta`, [lunes, domingo]);
  return r.rows;
}

/** Los días que RR. HH. dio por justificados (o eran baja o permiso) en Ausencias. → Map(conductorId → Set(días)) */
async function justificadas(lunes, domingo) {
  try {
    const r = await db.consulta(
      `SELECT conductor_id::text AS cid, to_char(dia, 'YYYY-MM-DD') AS dia FROM ausencia_rrhh
        WHERE dia BETWEEN $1::date AND $2::date AND estado IN ('justificada', 'baja_medica', 'permiso')`, [lunes, domingo]);
    const m = new Map();
    r.rows.forEach(x => { if (!m.has(x.cid)) m.set(x.cid, new Set()); m.get(x.cid).add(x.dia); });
    return m;
  } catch (e) { if (e.code === '42P01') return new Map(); throw e; }
}

/** Cuántas comunicaciones de esa semana siguen por aprobar. */
async function porAprobarDe(cli, lunes) {
  const r = await cli.query(
    `SELECT count(*)::int AS n FROM firma_envio WHERE origen = 'semana' AND origen_id LIKE $1 AND estado = 'borrador'`, [`${lunes}|%`]);
  return r.rows[0].n;
}

module.exports = { propiaEnSemana, justificadas, porAprobarDe };
