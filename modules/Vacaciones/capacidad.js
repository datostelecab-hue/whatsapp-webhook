// ============================================================
// LA CAPACIDAD Y LAS FECHAS BLOQUEADAS DE LAS VACACIONES (módulo 2, db/302)
// ============================================================
// Camilo, 26/11/2026 («cupos de vacaciones»):
//   «Siempre tiene que haber un promedio de 32.000 horas de mes previsto… si
//   me pide un conductor vacaciones del 25 de mayo al 5 de junio, tengo que ver
//   que la capacidad instalada de conductores sea de 32.000 horas al mes… si
//   hay festivos en ese tramo, esa capacidad crece un 3 % por cada festivo…
//   viendo siempre quién viene de vacaciones, baja médica, permisos, etc…
//   no son 8 horas por cada conductor, sino las horas en promedio del mes que
//   estén haciendo: si uno me hace 12 horas en promedio y otro 6, la capacidad
//   instalada es de 18 horas».
//
// LA CUENTA de un tramo (desde..hasta), día a día:
//   CAPACIDAD  la suma del promedio de horas (el de la casa,
//              bitacora.service.promedioHoras, de los últimos 30 días) de cada
//              conductor que trabaja ese día según el planificador
//              (f_cobertura, que ya quita a los que están de vacaciones, de
//              baja, de permiso…), SIN quien pide las vacaciones. El promedio
//              es por día trabajado: cada uno suma solo los días que le tocan.
//              Quien aún no tiene promedio (recién llegado), 8 horas.
//   HACE FALTA las horas del mes (`vacaciones.capacidad_horas_mes`, 32.000)
//              repartidas entre los días de ese mes, y un 3 % más
//              (`vacaciones.capacidad_festivo_pct`) por cada festivo del tramo.
// Si la capacidad del tramo queda por debajo de lo que hace falta: «no se
// pueden aprobar más vacaciones», con el porqué. Igual si pisa una fecha
// bloqueada. Aplicarlas igual pide un motivo, que queda en la ausencia.
'use strict';

const db = require('../../services/db');
const libro = require('../../services/libro');
const parametros = require('../../services/parametros');
const calendario = require('../../services/calendario');

const SIN_PROMEDIO = 8;
const MAX_DIAS = 62;
const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const esIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const dmy = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const r0 = n => Math.round(n);
// Con punto de miles siempre (el español no agrupa las de cuatro cifras: «7443» junto a «11.695»).
const miles = n => String(r0(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const diasDelMes = iso => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();

async function hayTabla() {
  return (await db.consulta(`SELECT to_regclass('public.vacaciones_bloqueo') IS NOT NULL AS hay`)).rows[0].hay;
}

/** Las fechas bloqueadas vivas que pisan un tramo (o todas las que quedan por llegar). */
async function bloqueos({ desde = null, hasta = null } = {}) {
  if (!await hayTabla()) return [];
  const r = await db.consulta(
    `SELECT b.id::text AS id, to_char(b.desde, 'YYYY-MM-DD') AS desde, to_char(b.hasta, 'YYYY-MM-DD') AS hasta, b.motivo,
            NULLIF(btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(NULLIF(u.apellidos, '.'), '')), '') AS puesto_por
       FROM vacaciones_bloqueo b LEFT JOIN usuario u ON u.id = b.creado_por
      WHERE b.anulado_at IS NULL
        AND ($1::date IS NULL OR b.hasta >= $1::date) AND ($2::date IS NULL OR b.desde <= $2::date)
      ORDER BY b.desde`, [desde, hasta]);
  return r.rows;
}

/**
 * La capacidad de un tramo si `conductorId` se va de vacaciones.
 * → { desde, hasta, recortado, festivos, horasMes, pct, hace_falta, capacidad, falta, alcanza,
 *     peorDia: { dia, capacidad, hace_falta }, sinPromedio, bloqueos, frase }
 */
async function revisar({ conductorId = null, desde, hasta, hoy = calendario.hoy() } = {}) {
  if (!esIso(desde)) throw error('Falta desde cuándo');
  const b0 = esIso(hasta) ? hasta : desde;
  if (b0 < desde) throw error('La vuelta va antes que el primer día');
  const fin = calendario.sumarDias(desde, MAX_DIAS - 1) < b0 ? calendario.sumarDias(desde, MAX_DIAS - 1) : b0;
  const [horasMes, pct, cal, cob, bloq] = await Promise.all([
    parametros.valor('vacaciones.capacidad_horas_mes').then(Number).catch(() => 32000),
    parametros.valor('vacaciones.capacidad_festivo_pct').then(Number).catch(() => 3),
    calendario.de('madrid'),
    db.consulta(`SELECT to_char(dia, 'YYYY-MM-DD') AS dia, conductor_id::text AS conductor_id
                   FROM f_cobertura($1::date, $2::date) GROUP BY 1, 2`, [desde, fin]),
    bloqueos({ desde, hasta: b0 }),
  ]);
  const bitacora = require('../Operaciones/bitacora.service');
  const prom = await bitacora.promedioHoras({ desde: calendario.sumarDias(hoy, -30), hasta: calendario.sumarDias(hoy, -1) })
    .then(x => x.porId).catch(() => new Map());
  const festivos = [];
  for (let d = desde; d <= b0; d = calendario.sumarDias(d, 1)) if (cal.festivos.has(d)) festivos.push(d);
  const factor = 1 + (pct / 100) * festivos.length;
  const porDia = new Map();
  for (let d = desde; d <= fin; d = calendario.sumarDias(d, 1)) porDia.set(d, { capacidad: 0, hace_falta: (horasMes / diasDelMes(d)) * factor });
  const sinPromedio = new Set();
  cob.rows.forEach(x => {
    if (conductorId != null && x.conductor_id === String(conductorId)) return;
    const p = prom.get(x.conductor_id);
    const h = p && p.promedio > 0 ? p.promedio : SIN_PROMEDIO;
    if (!(p && p.promedio > 0)) sinPromedio.add(x.conductor_id);
    const d = porDia.get(x.dia);
    if (d) d.capacidad += h;
  });
  let capacidad = 0, haceFalta = 0, peor = null;
  porDia.forEach((v, dia) => {
    capacidad += v.capacidad; haceFalta += v.hace_falta;
    if (!peor || v.capacidad - v.hace_falta < peor.capacidad - peor.hace_falta) peor = { dia, ...v };
  });
  const falta = Math.max(0, haceFalta - capacidad);
  const alcanza = capacidad >= haceFalta;
  const tramo = `del ${dmy(desde)} al ${dmy(fin)}`;
  const porFestivos = festivos.length ? ` (${miles(horasMes)} al mes, +${r0(pct * festivos.length)} % por ${festivos.length === 1 ? 'un festivo' : festivos.length + ' festivos'})` : ` (${miles(horasMes)} al mes)`;
  const frase = alcanza
    ? `Hay capacidad: ${tramo} hacen falta ${miles(haceFalta)} h${porFestivos} y, con los que trabajan, salen ${miles(capacidad)} h.`
    : `No se pueden aprobar más vacaciones ${tramo}: hacen falta ${miles(haceFalta)} h${porFestivos} y, con los que trabajan, salen ${miles(capacidad)} h; faltan ${miles(falta)} h.`;
  return {
    desde, hasta: fin, recortado: fin !== b0, festivos, horasMes, pct,
    hace_falta: r0(haceFalta), capacidad: r0(capacidad), falta: r0(falta), alcanza,
    peorDia: peor ? { dia: peor.dia, capacidad: r0(peor.capacidad), hace_falta: r0(peor.hace_falta) } : null,
    sinPromedio: sinPromedio.size, bloqueos: bloq, frase,
  };
}

/**
 * Al APLICAR unas vacaciones: si no hay capacidad o pisan una fecha bloqueada,
 * pide un motivo (como el permiso que se pasa del convenio). → null | nota
 */
async function alAplicar(conductorId, { desde, hasta }, motivoExceso) {
  const r = await revisar({ conductorId, desde, hasta });
  const problemas = [];
  if (!r.alcanza) problemas.push(r.frase);
  r.bloqueos.forEach(b => problemas.push(`Pisa una fecha bloqueada: del ${dmy(b.desde)} al ${dmy(b.hasta)} (${b.motivo}).`));
  if (!problemas.length) return null;
  const m = String(motivoExceso || '').trim();
  if (m.length < 3) {
    const e = error(problemas.join(' '));
    e.pide = { tipo: 'capacidad_vacaciones', campo: 'motivoExceso', titulo: 'Vacaciones sin capacidad o en fecha bloqueada',
      texto: `${problemas.join(' ')} Si se aprueban igual, di por qué: queda en la ausencia.` };
    throw e;
  }
  return `Aprobadas sin capacidad o en fecha bloqueada: ${m}`;
}

// ── Las fechas bloqueadas: las pone quien aprueba vacaciones ─────────────────
async function bloquear({ desde, hasta, motivo } = {}, usuarioId) {
  if (!await hayTabla()) throw error('Falta aplicar la migración 302');
  if (!esIso(desde) || !esIso(hasta || desde)) throw error('Faltan las fechas');
  const b = hasta || desde;
  if (b < desde) throw error('El último día va antes que el primero');
  const m = String(motivo || '').trim();
  if (m.length < 3) throw error('Di por qué se bloquean (Navidad, un evento…)');
  return libro.conFirma({ usuarioId, origen: 'vacaciones', accion: 'alta', motivo: `Fechas bloqueadas del ${dmy(desde)} al ${dmy(b)}: ${m}` }, async cli => {
    const r = await cli.query(`INSERT INTO vacaciones_bloqueo (desde, hasta, motivo, creado_por) VALUES ($1::date, $2::date, $3, $4) RETURNING id::text AS id`,
      [desde, b, m.slice(0, 500), usuarioId || null]);
    return { ok: true, id: r.rows[0].id };
  });
}

async function desbloquear(id, { motivo } = {}, usuarioId) {
  if (!await hayTabla()) throw error('Falta aplicar la migración 302');
  const m = String(motivo || '').trim();
  if (m.length < 3) throw error('Di por qué se quita el bloqueo');
  return libro.conFirma({ usuarioId, origen: 'vacaciones', accion: 'baja', motivo: `Se quita un bloqueo de vacaciones: ${m}` }, async cli => {
    const r = await cli.query(`UPDATE vacaciones_bloqueo SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1 AND anulado_at IS NULL RETURNING id`, [Number(id), usuarioId || null, m.slice(0, 500)]);
    if (!r.rowCount) throw error('Ese bloqueo no existe o ya se quitó', 404);
    return { ok: true };
  });
}

module.exports = { revisar, alAplicar, bloqueos, bloquear, desbloquear, hayTabla };
