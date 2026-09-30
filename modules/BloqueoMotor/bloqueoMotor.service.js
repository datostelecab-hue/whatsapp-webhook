// ============================================================
// CICLO DE BLOQUEO DE MOTOR — el servicio
// ============================================================
// Camilo, 30/09/2026:
//   «Deisy coge el XXX4544 hoy, entonces al terminar turno se bloquea el
//   XXX4544; solo se desbloquea si va a volver a trabajar al otro día o si tiene
//   compañero correturno que lo vaya a coger —Lionar—: Lionar debe iniciar turno
//   también y así continúa el ciclo. Si alguien debe dejar el coche en el
//   taller, debe decírselo a Tráfico y desde el módulo nuevo soltarlo: ya no se
//   bloquea más hasta que nos lo entreguen de nuevo, un conductor inicie turno y
//   termine, y de nuevo empieza el ciclo. El sistema no bloquea nada sino que
//   suelta; los únicos que bloquearán son los conductores.»
//
// EL CICLO DE UN COCHE lo cuentan dos libros y Mapon:
//   · fichaje_turno        quién lo tiene ahora y quién lo dejó;
//   · fichaje_orden_motor  cada bloqueo y cada suelta: del conductor (sin
//                          usuario) al terminar y al empezar, o de Tráfico (con
//                          usuario) desde aquí;
//   · Mapon                cómo está el relé DE VERDAD ahora mismo.
//
// LOS ESTADOS (en `ESTADOS`, con el orden en que salen en la lista):
//   no-corta       Mapon lo da cortado y el coche se mueve sin turno: el relé no
//                  corta. Es de taller.
//   bloqueado      lo bloqueó quien terminó. Lo suelta el siguiente al empezar,
//                  o Tráfico desde aquí.
//   no-bloqueado   al terminar NO se pudo bloquear (sin cobertura, sin relé…).
//                  Está libre, y ya no hay repaso que lo reintente.
//   cortado-fuera  Mapon lo da cortado y no fue ningún conductor al terminar (el
//                  repaso que ya no existe, o alguien desde Mapon).
//   suelto-fuera   lo bloqueamos y Mapon lo da libre: lo soltaron por fuera.
//   en-turno       lo lleva alguien con el bloqueo (o un viaje): se bloqueará al
//                  terminar, o se quedará libre si un compañero no lo tiene.
//   fuera          lo soltó Tráfico (el taller): fuera del ciclo hasta que alguien
//                  vuelva a empezar y terminar un turno en él.
//
// Los coches de otra sede ni aparecen (services/otraSede.js).

const fichaje = require('../../services/fichaje');
const repo = require('../../services/repo/fichajeTurno');
const mapon = require('../../services/mapon');
const otraSede = require('../../services/otraSede');

const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const iso = seg => (seg ? new Date(seg * 1000).toISOString() : null);
// Cuánto sigue en la lista un coche que soltó Tráfico. Pasado eso, si nadie lo ha
// vuelto a coger, deja de ser noticia.
const FUERA_DIAS = 30;

const ESTADOS = ['no-corta', 'bloqueado', 'no-bloqueado', 'cortado-fuera', 'suelto-fuera', 'en-turno', 'fuera'];

/** Cómo está el relé según Mapon, en palabras. */
function estadoRele(rel) {
  if (!rel) return 'sin datos';
  if (rel.cortado === null) return 'sin relé';
  return rel.cortado ? 'cortado' : 'libre';
}

/**
 * Los coches del ciclo, uno por fila. Pregunta a Mapon por el relé de toda la
 * flota una vez; si Mapon no contesta la lista sale igual, con el relé «sin
 * datos» y el aviso en `errorMapon`.
 */
async function lista() {
  const [ordenes, ultimos, abiertos, sedes, flota] = await Promise.all([
    repo.ultimaOrdenPorCoche(), repo.ultimoTurnoPorCoche(), repo.abiertos(),
    otraSede.cochesDeOtraSede(),
    mapon.relesDeFlota().catch(e => ({ error: e.message, vehiculos: [] })),
  ]);
  const ajena = x => otraSede.sedeAjenaEn(sedes, x);

  // El relé de verdad, por equipo y por matrícula. Con dos equipos para una
  // matrícula manda el que tiene relé.
  const porUnit = new Map(), porMat = new Map();
  (flota.vehiculos || []).forEach(v => {
    const r = (v.reles || []).find(x => x.tipo === 'engine_block' && x.habilitado);
    const rel = {
      unitId: String(v.unitId), matricula: v.matricula,
      cortado: r ? Number(r.activo) === fichaje.RELE_BLOQUEADO : null,
      anda: v.estado === 'driving' || Number(v.velocidad) > 0,
      velocidad: Number(v.velocidad) || 0,
    };
    porUnit.set(rel.unitId, rel);
    const m = normMat(v.matricula);
    if (!porMat.has(m) || (rel.cortado !== null && porMat.get(m).cortado === null)) porMat.set(m, rel);
  });
  const releDe = x => porUnit.get(String(x.unitId || '')) || porMat.get(normMat(x.matricula)) || null;
  const ultimoDe = new Map(ultimos.map(t => [normMat(t.matricula), t]));

  const filas = new Map();
  const poner = f => {
    const rel = releDe(f);
    f.rele = estadoRele(rel);
    // UN CORTE QUE NO CORTA: el relé dice cortado y el coche anda sin nadie en
    // turno. Es la instalación, y no hay orden que lo arregle: se nombra.
    if (rel && rel.cortado === true && rel.anda && f.estado !== 'en-turno') {
      f.estado = 'no-corta';
      f.detalle = `Mapon lo da con el motor cortado y va a ${rel.velocidad} km/h: el corte no corta. Que lo mire el taller.`;
    }
    filas.set(normMat(f.matricula), f);
  };

  // 1 · En turno ahora, de quien tiene el bloqueo o de un viaje. Los demás
  // turnos no entran: al terminarlos no se bloquea nada.
  const decisiones = await Promise.all(abiertos.map(t => (ajena(t) ? null : fichaje.decidirBloqueo(t))));
  abiertos.forEach((t, i) => {
    const dec = decisiones[i];
    if (!dec || dec.sinControl) return;
    poner({
      matricula: t.matricula, unitId: t.unitId, estado: 'en-turno', desde: iso(t.inicio),
      quien: t.nombre, tipo: t.tipo,
      detalle: dec.bloquear
        ? `Al terminar ${t.tipo === 'viaje' ? 'el viaje' : 'su turno'} se bloqueará.`
        : `Al terminar se quedará libre: ${dec.faltan.join(', ')} también lo lleva y no tiene el bloqueo.`,
      puedeSoltar: false,
    });
  });

  // 2 · Lo demás lo dice la última orden de cada coche.
  const limiteFuera = Date.now() - FUERA_DIAS * 864e5;
  for (const o of ordenes) {
    const m = normMat(o.matricula);
    if (filas.has(m) || ajena(o)) continue;
    const rel = releDe(o);
    const t = ultimoDe.get(m);
    const base = { matricula: o.matricula, unitId: o.unitId, desde: o.cuando, quien: t ? t.nombre : '' };
    if (o.accion === 'bloquear' && o.hecho) {
      if (rel && rel.cortado === false) {
        poner({ ...base, estado: 'suelto-fuera', puedeSoltar: false,
          detalle: 'Se bloqueó al terminar y Mapon lo da libre: lo soltaron fuera del ERP. Está fuera del ciclo hasta que alguien vuelva a terminar un turno en él.' });
      } else {
        poner({ ...base, estado: 'bloqueado', puedeSoltar: true,
          detalle: 'Lo suelta quien empiece el siguiente turno. Si se queda en el taller, se suelta desde aquí.' });
      }
    } else if (o.accion === 'bloquear') {
      poner({ ...base, estado: 'no-bloqueado', puedeSoltar: !!(rel && rel.cortado === true),
        detalle: `Al terminar no se pudo bloquear (${o.respuesta || 'sin respuesta'}). Está libre.` });
    } else if (o.deTrafico && Date.parse(o.cuando) >= limiteFuera) {
      poner({ ...base, estado: 'fuera', quien: o.usuario || 'Tráfico', puedeSoltar: !!(rel && rel.cortado === true),
        detalle: `Lo soltó ${o.usuario || 'Tráfico'}: ${o.motivo}. No se vuelve a bloquear hasta que alguien empiece y termine un turno en él.` });
    }
    // Una suelta del conductor al empezar sin nada detrás: se cerró sin bloquear
    // (no tenía el bloqueo). Ese coche no está en el ciclo.
  }

  // 3 · Lo que Mapon da cortado y no está en el ciclo.
  for (const rel of porUnit.values()) {
    if (rel.cortado !== true || ajena(rel) || filas.has(normMat(rel.matricula))) continue;
    poner({ matricula: rel.matricula, unitId: rel.unitId, estado: 'cortado-fuera', desde: null, quien: '',
      puedeSoltar: true,
      detalle: 'Mapon lo da con el motor cortado y no lo cortó ningún conductor al terminar: el repaso que ya no existe, o alguien desde Mapon.' });
  }

  // 4 · Quién lo coge hoy o mañana, para los que esperan a alguien.
  const esperan = [...filas.values()].filter(f => f.estado === 'bloqueado' || f.estado === 'no-bloqueado');
  const cogen = await Promise.all(esperan.map(f => repo.quienesLlevan(f.matricula).catch(() => null)));
  esperan.forEach((f, i) => { f.cogen = cogen[i]; });

  const orden = e => { const i = ESTADOS.indexOf(e); return i < 0 ? 99 : i; };
  return {
    filas: [...filas.values()].sort((a, b) => orden(a.estado) - orden(b.estado)
      || String(a.matricula).localeCompare(String(b.matricula))),
    bloqueoActivo: fichaje.BLOQUEO_ACTIVO,
    errorMapon: flota.error || null,
  };
}

/** Lo que ha pasado con un coche, en una sola línea de tiempo: turnos y motor. */
function lineaDeTiempo({ ordenes, turnos }) {
  const ev = [];
  const alCerrar = t => ({
    cerrado: t.tipo === 'viaje' ? 'Termina el viaje' : 'Termina el turno',
    relevado: 'Se lo queda otro (relevo)',
    'auto-cerrado': 'Se cierra solo (14 h)',
  }[t.estado] || t.estado);
  turnos.forEach(t => {
    ev.push({ cuando: iso(t.inicio), que: t.tipo === 'viaje' ? 'Empieza un viaje' : 'Empieza el turno', quien: t.nombre, nota: '' });
    if (t.fin) ev.push({ cuando: iso(t.fin), que: alCerrar(t), quien: t.nombre, nota: t.notas || '' });
  });
  ordenes.forEach(o => ev.push({
    cuando: o.cuando,
    que: o.accion === 'bloquear' ? (o.hecho ? 'Motor bloqueado' : 'No se pudo bloquear')
      : (o.hecho ? 'Motor suelto' : 'No se pudo soltar'),
    quien: o.deTrafico ? (o.usuario || 'Tráfico') : 'el conductor',
    nota: o.deTrafico ? o.motivo : (o.hecho ? '' : o.respuesta),
    motor: true,
  }));
  return ev.filter(e => e.cuando).sort((a, b) => b.cuando.localeCompare(a.cuando)).slice(0, 40);
}

/** La ficha de un coche: dónde está en el ciclo y lo que ha pasado. */
async function ficha(matricula) {
  const m = normMat(matricula);
  if (!m) throw new Error('Falta la matrícula');
  const ajena = await otraSede.sedeAjena({ matricula: m });
  if (ajena) throw new Error(`El ${m} es de ${otraSede.nombreSede(ajena)}: no está en el ciclo`);
  const [l, h] = await Promise.all([lista(), repo.historiaDelCoche(m)]);
  const fila = l.filas.find(f => normMat(f.matricula) === m) || {
    matricula: m, estado: 'sin-ciclo', puedeSoltar: false, rele: '',
    detalle: 'No está en el ciclo: nadie con el bloqueo ha terminado un turno en él, o ya se soltó y nadie lo ha vuelto a coger.',
  };
  return { ...fila, historia: lineaDeTiempo(h), errorMapon: l.errorMapon };
}

/** Soltar a mano: el coche sale del ciclo hasta que alguien empiece y termine un turno. */
async function soltar({ matricula, motivo } = {}, quien = {}) {
  if (!normMat(matricula)) throw new Error('Falta la matrícula');
  return fichaje.soltarCoche({ matricula: normMat(matricula), motivo }, quien);
}

module.exports = { lista, ficha, soltar, ESTADOS, lineaDeTiempo };
