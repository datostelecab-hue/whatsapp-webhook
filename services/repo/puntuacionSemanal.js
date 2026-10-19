// ============================================================
// PUNTUACIÓN SEMANAL — la nota de cada semana, sellada (db/210)
// ============================================================
// Lo que ve cada conductor en su portal (conductorestelecab.es). Camilo,
// 19/10/2026: «la puntuación que llevan semana tras semana … toca que no se
// reinicien los puntajes … desde septiembre no más». Eligió que cada semana
// tenga su propia nota.
//
//   · LA SEMANA es de lunes a domingo, por jornadas operativas (05→05). La
//     primera es la del 31/08/2026, contada desde el 01/09/2026 (DESDE).
//   · LA CUENTA es la de la letra, sin cambiar nada: `calificacion.calcular` con
//     el periodo de esa semana y el promedio de horas de la casa. Las mismas
//     tablas, bandas, topes y el mismo «menos de 5 días → N/E».
//   · SE SELLA y ya no cambia: el disparador de db/210 no deja actualizar una
//     fila. Sale en la pasada del mediodía (app.js), cuando la jornada de ayer
//     está cerrada para todo el mundo, y solo semanas cuyo domingo ya cerró.
//   · SE RELLENA SOLA. Cada pasada sella las semanas cerradas que falten desde
//     DESDE. La primera vez, en un servidor recién actualizado, hace todas las
//     de septiembre en adelante; después, una cada lunes. Si un lunes falla, la
//     pasada siguiente la recoge.
//
// El conductor ve los puntos, no sus horas: `semanasDe` no devuelve ni el
// promedio de horas ni la utilización.

const db = require('../db');
const cal = require('./calificacion');

const DESDE = '2026-09-01';

const sumarDias = (iso, n) =>
  new Date(Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** El lunes de la semana de `iso` (las semanas empiezan en lunes). */
function lunesDe(iso) {
  const dow = (new Date(String(iso).slice(0, 10) + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return sumarDias(iso, -dow);
}

/** Los lunes de las semanas ya CERRADAS: su domingo es `ultimoDiaCerrado` o antes. */
function semanasCerradas(ultimoDiaCerrado) {
  const res = [];
  for (let l = lunesDe(DESDE); sumarDias(l, 6) <= ultimoDiaCerrado; l = sumarDias(l, 7)) res.push(l);
  return res;
}

/** Lo que se cuenta de una semana: del lunes (o de DESDE, la primera) al domingo. */
const periodoDe = lunes => ({ desde: lunes < DESDE ? DESDE : lunes, hasta: sumarDias(lunes, 6) });

const COLS = ['conductor_id', 'semana_lunes', 'periodo_inicio', 'periodo_fin', 'letra', 'letra_por_puntos',
  'tope_aplicado', 'motivo', 'total', 'pts_horas', 'pts_utilizacion', 'pts_velocidad', 'horas_prom',
  'util_prom', 'excesos_total', 'dias_trabajados', 'dias_utilizacion', 'dias_telemetria', 'version_modelo'];
const nul = v => (v == null ? null : v);

/**
 * SELLA las semanas cerradas que falten. `promedioHoras(desde, hasta)` es el de
 * la casa (lo pasa bitacora.service.sellarPuntuacionSemanal) y
 * `ultimoDiaCerrado` la última jornada cerrada para todos (ayer, al mediodía).
 *
 * Una semana se da por hecha en cuanto tiene filas. Insertar es ON CONFLICT DO
 * NOTHING: lo sellado no se pisa nunca. Devuelve lo que selló, semana a semana.
 */
async function sellar({ promedioHoras, ultimoDiaCerrado, maxSemanas = 60 } = {}) {
  if (typeof promedioHoras !== 'function') {
    throw new Error('La puntuación semanal se calcula con el promedio de la casa: séllala con bitacora.service.sellarPuntuacionSemanal');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ultimoDiaCerrado || ''))) throw new Error('Falta la última jornada cerrada');

  const hechas = new Set((await db.consulta(
    `SELECT DISTINCT semana_lunes::text AS l FROM conductor_puntuacion_semana`)).rows.map(r => r.l));
  const faltan = semanasCerradas(ultimoDiaCerrado).filter(l => !hechas.has(l));
  const selladas = [];

  for (const lunes of faltan.slice(0, maxSemanas)) {
    const p = periodoDe(lunes);
    const r = await cal.calcular(p.hasta, promedioHoras, { desde: p.desde });
    if (!r.filas.length) { selladas.push({ lunes, filas: 0 }); continue; }
    const n = await db.transaccion(async cli => {
      let insertadas = 0;
      const TAM = 300, N = COLS.length;
      for (let i = 0; i < r.filas.length; i += TAM) {
        const t = r.filas.slice(i, i + TAM);
        const vals = t.map((_, k) => '(' + COLS.map((__, j) => `$${k * N + j + 1}`).join(',') + ')').join(',');
        const q = await cli.query(
          `INSERT INTO conductor_puntuacion_semana (${COLS.join(', ')}) VALUES ${vals}
           ON CONFLICT (conductor_id, semana_lunes) DO NOTHING`,
          t.flatMap(f => [
            f.conductorId, lunes, p.desde, p.hasta, f.letra, f.letraPorPuntos || null, !!f.topeAplicado,
            f.motivo || null, nul(f.total), nul(f.ptsHoras), nul(f.ptsUtilizacion), nul(f.ptsVelocidad),
            nul(f.horasProm), nul(f.utilProm), nul(f.excesosTotal), f.diasTrabajados || 0,
            f.diasUtilizacion || 0, nul(f.diasTelemetria), f.versionModelo,
          ]));
        insertadas += q.rowCount;
      }
      return insertadas;
    });
    selladas.push({
      lunes, filas: n, conLetra: r.filas.filter(f => f.letra !== 'N/E').length,
      telemetriaCompleta: r.telemetria.completa,
    });
  }
  return { selladas, quedan: Math.max(0, faltan.length - maxSemanas) };
}

/**
 * Las semanas de UNA persona, de la más reciente a la más antigua, para su
 * portal. Solo lo que se le enseña: la nota, la letra, los puntos de cada parte
 * y los excesos que le cuentan (ya se le avisaron por WhatsApp). Ni horas ni
 * porcentajes.
 */
async function semanasDe(conductorId) {
  const r = await db.consulta(
    `SELECT to_char(semana_lunes, 'YYYY-MM-DD') AS lunes, to_char(periodo_inicio, 'YYYY-MM-DD') AS desde,
            to_char(periodo_fin, 'YYYY-MM-DD') AS hasta, letra, letra_por_puntos, tope_aplicado, motivo,
            total::float AS total, pts_horas, pts_utilizacion, pts_velocidad, excesos_total
       FROM conductor_puntuacion_semana
      WHERE conductor_id = $1
      ORDER BY semana_lunes DESC`, [conductorId]);
  return r.rows.map(x => ({
    lunes: x.lunes, desde: x.desde, hasta: x.hasta, letra: x.letra,
    letraPorPuntos: x.letra_por_puntos, topeAplicado: !!x.tope_aplicado, motivo: x.motivo,
    total: x.total, ptsHoras: x.pts_horas, ptsUtilizacion: x.pts_utilizacion,
    ptsVelocidad: x.pts_velocidad, excesos: x.excesos_total,
  }));
}

module.exports = { DESDE, lunesDe, semanasCerradas, periodoDe, sellar, semanasDe, MODELO: cal.MODELO };
