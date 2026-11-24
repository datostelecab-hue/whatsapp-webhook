// ============================================================
// MIS HORAS: EL CRONÓMETRO DEL PORTAL (24/11/2026)
// ============================================================
// Camilo: «el cronómetro de horas en la app, pero desglosada, de viaje, en
// espera y la utilización total, además de sus KM, tanto por BOLT como por
// fuera, es un módulo de ellos a parte, que empiece cuando se vincule el
// coche, que diga "Horas con el coche" y "Horas trabajando". Que le diga su
// estado actual en BOLT, si en espera, si en viaje, si en descanso, etc».
//
//   · EMPIEZA AL VINCULAR el coche (el turno abierto de fichaje) y llega hasta
//     ahora. Sin coche vinculado no cuenta nada: dice que lo vincule.
//   · HORAS CON EL COCHE: desde que lo vinculó. HORAS TRABAJANDO: viaje +
//     espera en BOLT, de sus cuentas, en ese rato (el descanso NO es trabajo,
//     como en todo el ERP: fv_cat_situacion.efectivo). UTILIZACIÓN: viaje entre
//     viaje + espera.
//   · KM con BOLT y fuera de BOLT: los de su coche vinculado en ese rato, según
//     la situación del tramo (viaje o espera = con BOLT; descanso, desconectado
//     o sin clasificar = fuera). Con el coche vinculado, los km son suyos, sea
//     quien sea el que esté en BOLT con él (la regla del banco de KM). Salen del
//     odómetro de cada tramo de Flota Viva; un tramo a medias cuenta su parte.
//     Es la cifra EN VIVO, para que se vea cómo va: el banco de KM del día
//     cierra con su propia cuenta a las 12:00 del día siguiente.
//   · EL ESTADO EN BOLT, el de ahora: de la foto del ahora (la misma que el
//     mapa y Control), de la cuenta suya más reciente.
'use strict';

const repo = require('./portal.repo');

/**
 * LA CUENTA, pura: de los tramos que tocan [iniMs, finMs), lo que va al
 * cronómetro. Segundos y km (con un decimal).
 */
function resumir(tramos, iniMs, finMs) {
  let viaje = 0, espera = 0, descanso = 0, kmBolt = 0, kmFuera = 0;
  for (const t of tramos || []) {
    const a = Math.max(t.desdeMs, iniMs), b = Math.min(t.hastaMs, finMs);
    const dentro = Math.max(0, b - a);
    if (!dentro) continue;
    if (t.suyo) {
      if (t.situacion === 'viaje') viaje += dentro;
      else if (t.situacion === 'espera') espera += dentro;
      else if (t.situacion === 'descanso') descanso += dentro;
    }
    if (t.delCoche && t.odoIni != null && t.odoFin != null && t.odoFin > t.odoIni) {
      const largo = t.hastaMs - t.desdeMs;
      const km = ((t.odoFin - t.odoIni) / 1000) * (largo > 0 ? dentro / largo : 1);
      if (t.efectivo) kmBolt += km; else kmFuera += km;
    }
  }
  const seg = ms => Math.round(ms / 1000);
  const trabajando = viaje + espera;
  return {
    viaje: seg(viaje), espera: seg(espera), descanso: seg(descanso), trabajando: seg(trabajando),
    utilizacion: trabajando > 0 ? Math.round((viaje / trabajando) * 100) : null,
    kmBolt: Math.round(kmBolt * 10) / 10, kmFuera: Math.round(kmFuera * 10) / 10,
  };
}

/** Su estado de BOLT de ahora: de sus cuentas, la de la noticia más reciente. */
async function estadoBolt(uuids) {
  if (!uuids.length) return null;
  let f;
  try { f = await require('../../services/flotaViva/ahora').foto(); }
  catch (e) { console.error('❌ [Portal] estado de BOLT:', e.message); return null; }
  const suyos = uuids.map(u => (f.porConductor || new Map()).get(u)).filter(Boolean);
  if (!suyos.length) return { situacion: 'desconectado', etiqueta: 'Desconectado', desdeMs: null };
  const t = x => (x.desde ? new Date(x.desde).getTime() : 0);
  const x = suyos.sort((a, b) => Number(!!b.conectado) - Number(!!a.conectado) || t(b) - t(a))[0];
  return { situacion: x.situacion || 'otro', etiqueta: x.etiqueta || 'Sin clasificar', desdeMs: x.desde ? t(x) : null };
}

/**
 * EL CRONÓMETRO: { vinculado, matricula, inicioMs, ahoraMs, conCoche (s), viaje,
 * espera, descanso, trabajando, utilizacion, kmBolt, kmFuera, bolt }.
 */
async function cronometro(persona, { ahoraMs = Date.now() } = {}) {
  const coche = await require('./portal.coche').estado(persona);
  const uuids = await repo.cuentasBolt(persona.id);
  const bolt = await estadoBolt(uuids);
  if (!coche.puede) return { puede: false, aviso: coche.aviso, bolt };
  if (!coche.vinculado || !coche.inicioSeg) return { puede: true, vinculado: false, bolt };
  const inicioMs = coche.inicioSeg * 1000;
  const tramos = await repo.tramosDelCronometro({ uuids, matricula: coche.matricula, desdeMs: inicioMs, hastaMs: ahoraMs });
  return {
    puede: true, vinculado: true, matricula: coche.matricula, desde: coche.desde, oficina: !!coche.oficina,
    inicioMs, ahoraMs, conCoche: Math.max(0, Math.round((ahoraMs - inicioMs) / 1000)),
    ...resumir(tramos, inicioMs, ahoraMs), sinCuentaBolt: !uuids.length, bolt,
  };
}

module.exports = { cronometro, resumir, estadoBolt };
