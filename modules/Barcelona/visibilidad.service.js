// ============================================================
// BARCELONA · VISIBILIDAD — las horas de su flota, con las métricas de Madrid
// ============================================================
// Camilo, 07/10/2026: «A Barcelona también hazle la Visibilidad con las mismas
// métricas». Es LA MISMA PANTALLA que la de Madrid (views/visibilidad.ejs) y LAS
// MISMAS CUENTAS (services/visibilidad.js: metricas, sliceDeTurno, armarSerie);
// lo único que cambia es de dónde salen los datos:
//
//   · Las horas, de sus apuntes de BOLT (sede_bolt_state_log), pasados a ratos
//     como en el reporte (barcelona.horas.js). Madrid las lee de Flota viva.
//   · El neto y los viajes, de sus pedidos (sede_bolt_order, db/182).
//   · Los turnos, por el plan de SU planificador (sede_asignacion): quien no
//     tiene plaza va por su hora de inicio, como los NN de Madrid.
//   · La configuración (capacidad, meta, coches), en su propia fila de
//     visibilidad_config ('parametros_barcelona').
//
// Madrid guarda una foto diaria (visibilidad_dia) porque Flota viva es grande;
// Barcelona son una veintena de conductores y su mes entero se calcula al vuelo.

const repo = require('./barcelona.repo');
const H = require('./barcelona.horas');
const R = require('../../services/flotaViva/repartoTurnos');
const V = require('../../services/visibilidad');
const T = require('../../services/visibilidadTendencia');

const SEDE = 'barcelona';
const CON_DESCANSO = new Set(['viaje', 'espera', 'descanso']);
const MS_DIA = 86400000;
const r1 = x => Math.round(x * 10) / 10;

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const horaMadrid = () => Number(new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date())) % 24;
const diasEnMes = (anio, mes) => new Date(anio, mes, 0).getDate();
const inicioDe = fecha => R.instante(fecha, 0);

// ── La configuración ─────────────────────────────────────────────────────────
// Sin meta de partida: no hay una meta de Barcelona que copiar, y una inventada
// pintaría un ideal y una brecha que no significan nada. Hasta que se ponga en
// Config, la pantalla enseña las horas sin objetivo. Los coches, si no se dicen,
// son los que se pueden planificar (activos en BOLT, o en Vehículos y aún no en BOLT).
const CLAVES = ['capacidad_diaria_h', 'meta', 'vehiculos', 'dias_del_mes', 'meta_turno_dia_h', 'meta_turno_noche_h'];
const DEFECTO = { capacidad_diaria_h: 16, meta: null, vehiculos: null, dias_del_mes: null, meta_turno_dia_h: null, meta_turno_noche_h: null };

async function leerConfig() {
  const [guardada, coches] = await Promise.all([
    repo.leerConfigVisibilidad(SEDE).catch(() => null),
    repo.coches(SEDE).catch(() => []),
  ]);
  const c = { ...DEFECTO, ...(guardada || {}) };
  if (c.vehiculos == null) c.vehiculos = coches.filter(require('./barcelona.service').cocheActivo).length || null;
  return c;
}

async function guardarConfig(patch = {}) {
  const actual = { ...DEFECTO, ...((await repo.leerConfigVisibilidad(SEDE).catch(() => null)) || {}) };
  const limpio = {};
  CLAVES.forEach(k => {
    if (patch[k] === undefined) { limpio[k] = actual[k]; return; }
    if (patch[k] === null || patch[k] === '') { limpio[k] = null; return; }
    const n = Number(patch[k]);
    limpio[k] = Number.isFinite(n) ? n : actual[k];
  });
  await repo.guardarConfigVisibilidad(SEDE, limpio);
  return leerConfig();
}

// ── Los datos ────────────────────────────────────────────────────────────────

/** Los ratos (viaje, espera y descanso) de [iniMs, finMs), con un día de apuntes por detrás. */
async function ratos(iniMs, finMs) {
  const [apuntes, mapa] = await Promise.all([repo.apuntesEntre(SEDE, iniMs - MS_DIA, finMs), repo.situaciones()]);
  return H.intervalos(apuntes, e => mapa.get(e) || 'otro', iniMs, finMs, { situaciones: CON_DESCANSO });
}

/** El dinero de una ventana; sin db/182, cero (las horas no dependen de él). */
const dinero = (iniMs, finMs) => repo.dineroEntre(SEDE, iniMs, finMs).catch(e => {
  if (repo.faltaMigracion(e)) return { neto: 0, viajes: 0 };
  throw e;
});

/** Las métricas de Madrid de una ventana. */
async function slice(ivs, iniMs, finMs) {
  return V.metricas(H.sumaVentana(ivs, iniMs, Math.min(finMs, Date.now())), await dinero(iniMs, finMs));
}

/** Envuelve una lectura: sin db/181, la pantalla lo dice. */
async function conTablas(fn) {
  try {
    return await fn();
  } catch (e) {
    if (repo.faltaMigracion(e)) return { faltaMigracion: true };
    throw e;
  }
}

// ── Lo que pide la pantalla ──────────────────────────────────────────────────

/**
 * LAS TARJETAS: por día natural (hoy, ayer, esta semana; el mes, para el
 * panel) y por turno (el día y la noche que tocan, y la jornada de ayer), como
 * `resumen()` de Madrid.
 */
function resumen() {
  return conTablas(async () => {
    const hoy = hoyMadrid();
    const ayer = R.sumarDias(hoy, -1);
    const [Y, M] = hoy.split('-').map(Number);
    const primeroMes = `${Y}-${String(M).padStart(2, '0')}-01`;
    const dow = (new Date(hoy + 'T12:00:00Z').getUTCDay() + 6) % 7;     // 0 = lunes
    const lunes = R.sumarDias(hoy, -dow);
    // Antes de las 05:00 la jornada que se mira es la de anteayer (como Madrid).
    const ayerJornada = horaMadrid() < 5 ? R.sumarDias(hoy, -2) : ayer;
    const t = V.ventanaTurnos();
    const fechaDia = t.dia.v[0], fechaNoche = t.noche.v[0];

    const ahora = Date.now();
    const desde = [primeroMes, lunes, R.sumarDias(ayerJornada, -1)].sort()[0];
    const iniMs = inicioDe(desde);
    const [ivs, asignaciones, config] = await Promise.all([
      ratos(iniMs, ahora),
      repo.asignacionesEntre(SEDE, R.sumarDias(desde, -1), R.sumarDias(hoy, 1)),
      leerConfig(),
    ]);

    // Los turnos, por el plan del planificador (los sin plaza, por su hora de inicio).
    const efectivos = ivs.filter(x => H.EFECTIVAS.has(x.situacion)).map(x => ({ ...x, persona: x.uuid }));
    const { porClave } = R.repartir(efectivos, H.planDesde(asignaciones));
    const VACIO = { viajeSeg: 0, esperaSeg: 0, personas: new Set(), nnSeg: 0, nnPersonas: new Set() };
    const turno = (fecha, tt) => porClave.get(R.clave(fecha, tt)) || VACIO;
    const jD = turno(ayerJornada, 'dia'), jN = turno(ayerJornada, 'noche');
    const ayerJor = V.sliceDeTurno({
      viajeSeg: jD.viajeSeg + jN.viajeSeg, esperaSeg: jD.esperaSeg + jN.esperaSeg,
      personas: new Set([...jD.personas, ...jN.personas]),
      nnSeg: jD.nnSeg + jN.nnSeg, nnPersonas: new Set([...jD.nnPersonas, ...jN.nnPersonas]),
    });
    const jornadaAbierta = ahora < R.cierreDe(ayerJornada);

    const [mes, dia, ayerDia, semana] = await Promise.all([
      slice(ivs, inicioDe(primeroMes), inicioDe(R.sumarDias(primeroMes, diasEnMes(Y, M)))),
      slice(ivs, inicioDe(hoy), inicioDe(R.sumarDias(hoy, 1))),
      slice(ivs, inicioDe(ayer), inicioDe(hoy)),
      slice(ivs, inicioDe(lunes), inicioDe(R.sumarDias(lunes, 7))),
    ]);
    return {
      hoyISO: hoy,
      mes: { ...mes, etq: 'Este mes' },
      dia: { ...dia, etq: 'Hoy' },
      ayer: { ...ayerDia, etq: 'Ayer' },
      semana: { ...semana, etq: 'Esta semana' },
      turnoDia: { ...V.sliceDeTurno(turno(fechaDia, 'dia')), etq: t.dia.etq, dia: fechaDia },
      turnoNoche: { ...V.sliceDeTurno(turno(fechaNoche, 'noche')), etq: t.noche.etq, dia: fechaNoche },
      ayerJornada: { ...ayerJor, dia: ayerJornada, parcial: jornadaAbierta,
        etq: jornadaAbierta ? 'Ayer · jornada (se cierra a las 12:00)' : 'Ayer · jornada completa' },
      config,
    };
  });
}

/**
 * A ESTA HORA (30/10/2026, Camilo: «ponlo también en la Visibilidad de
 * Barcelona»): hoy contra ayer, anteayer y el mismo día de la semana pasada,
 * cada uno hasta la misma hora, por día natural, por turno y por jornada. La
 * hora, los días y los % son los de Madrid (`momentoAEstaHora`,
 * `armarAEstaHora`); las horas, de sus apuntes, y los turnos, por el plan de SU
 * planificador, cortados a la hora de cada día como en Madrid.
 */
function aEstaHora(ref = {}) {
  return conTablas(async () => {
    const { hoy, hora, hNum, tarde, dias } = V.momentoAEstaHora(ref);
    const ahora = Date.now();
    // Ocho días: la noche del mismo día de la semana pasada puede ser la de la víspera.
    const desde = R.sumarDias(hoy, -8);
    const [ivs, asignaciones] = await Promise.all([
      ratos(inicioDe(desde), ahora),
      repo.asignacionesEntre(SEDE, R.sumarDias(desde, -1), R.sumarDias(hoy, 1)),
    ]);
    const plan = H.planDesde(asignaciones);
    const efectivos = ivs.filter(x => H.EFECTIVAS.has(x.situacion)).map(x => ({ ...x, persona: x.uuid }));
    const horasDe = s => (s.viajeSeg + s.esperaSeg) / 3600;
    const natural = [], turnos = [];
    dias.forEach(({ clave, dia, noche }) => {
      const corte = Math.min(R.instante(dia, hNum), ahora);
      natural.push({ clave, dia, horas: horasDe(H.sumaVentana(ivs, inicioDe(dia), corte)) });
      // Como si fuera esa hora: lo de después no existe todavía.
      const hastaElCorte = efectivos.filter(x => x.ini < corte).map(x => (x.fin > corte ? { ...x, fin: corte } : x));
      const { porClave } = R.repartir(hastaElCorte, plan);
      const h = k => { const x = porClave.get(k); return x ? horasDe(x) : 0; };
      turnos.push({ clave, dia, noche, turnoDia: h(R.clave(dia, 'dia')), turnoNoche: h(R.clave(noche, 'noche')),
        jornada: h(R.clave(dia, 'dia')) + h(R.clave(dia, 'noche')) });
    });
    return V.armarAEstaHora({ hoy, hora, tarde, natural, turnos });
  });
}

// ── LA TENDENCIA: los gráficos largos (25/10/2026) ─────────────────────────
// Las mismas piezas que Madrid (services/visibilidadTendencia.js): el rango con
// su agrupación y su media móvil, «cómo vamos» contra el mes anterior y el
// crecimiento mes a mes. Lo único de aquí es de dónde salen los días: de sus
// apuntes de BOLT, día natural por día natural, calculados al vuelo como el resto
// de su Visibilidad (son una veintena de conductores; no hay fotos que leer).

/**
 * Los días con horas de [desde, hasta] → { dias: Map }, con hoy en vivo (hasta
 * ahora). Empieza en su primer apunte aunque se pida antes: más atrás no hay nada.
 */
async function diasDeLaSede(desde, hasta, primerDia) {
  const dias = new Map();
  const ini = primerDia && primerDia > desde ? primerDia : desde;
  if (ini > hasta) return { dias };
  const ivs = await ratos(inicioDe(ini), Math.min(inicioDe(R.sumarDias(hasta, 1)), Date.now()));
  for (let d = ini; d <= hasta; d = R.sumarDias(d, 1)) {
    const h = H.sumaVentana(ivs, inicioDe(d), inicioDe(R.sumarDias(d, 1)));
    if (h.viajeSeg + h.esperaSeg > 0) {
      dias.set(d, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg, conductores: h.conductores || null, origen: 'sede', fuente: null });
    }
  }
  return { dias };
}

/** El rango que pide la pantalla (?ultimos=N, ?desde, ?hasta, ?agrupar). */
function rango(q = {}) {
  return conTablas(async () => {
    const [primerDia, config] = await Promise.all([repo.primerDiaApuntes(SEDE), leerConfig()]);
    return T.armarRango({ q, hoy: hoyMadrid(), primerDia, meta: Number(config.meta) || 0,
      cargarDias: (a, b) => diasDeLaSede(a, b, primerDia) });
  });
}

/** Mes a mes, desde su primer apunte. */
function crecimiento() {
  return conTablas(async () => {
    const [primerDia, config] = await Promise.all([repo.primerDiaApuntes(SEDE), leerConfig()]);
    return T.armarCrecimiento({ hoy: hoyMadrid(), primerDia, meta: Number(config.meta) || 0,
      cargarDias: (a, b) => diasDeLaSede(a, b, primerDia) });
  });
}

/** La serie del mes con el anterior y la comparación a la misma altura. */
function comoVamos(mesTexto) {
  return conTablas(async () => {
    const pedido = T.mesPedido(mesTexto);
    const ant = T.mesAnterior(pedido);
    const [actual, anterior] = await Promise.all([serieMes(pedido.anio, pedido.mes), serieMes(ant.anio, ant.mes)]);
    if (actual.faltaMigracion || anterior.faltaMigracion) return { faltaMigracion: true };
    return T.armarComoVamos(actual, anterior);
  });
}

/** LA SERIE DEL MES: por día, acumulado, ideal, crítico y brecha (armarSerie de Madrid). */
function serieMes(anio, mes) {
  return conTablas(async () => {
    const config = await leerConfig();
    const dm = Number(config.dias_del_mes) > 0 ? Number(config.dias_del_mes) : diasEnMes(anio, mes);
    const primero = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const hoy = hoyMadrid();
    const [Yh, Mh, Dh] = hoy.split('-').map(Number);
    const esMesActual = Yh === anio && Mh === mes;
    const esFuturo = anio > Yh || (anio === Yh && mes > Mh);
    const ultimoConDatos = esFuturo ? 0 : (esMesActual ? Dh : dm);

    const iniMs = inicioDe(primero), finMs = inicioDe(R.sumarDias(primero, dm));
    const fotos = new Map();
    let din = { neto: 0, viajes: 0 };
    if (!esFuturo) {
      const ivs = await ratos(iniMs, Math.min(finMs, Date.now()));
      for (let d = 1; d <= ultimoConDatos; d++) {
        const f = R.sumarDias(primero, d - 1);
        const h = H.sumaVentana(ivs, inicioDe(f), inicioDe(R.sumarDias(f, 1)));
        fotos.set(d, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg });
      }
      din = await dinero(iniMs, finMs);
    }
    return {
      anio, mes, diasMes: dm, config,
      ultimoConDatos, esMesActual, hoyDia: esMesActual ? Dh : null,
      ...V.armarSerie({ fotos, dm, config, dinero: din }),
    };
  });
}

/** La serie del mes pedido como 'AAAA-MM' (por defecto, el de hoy en Madrid). */
function serie(mesTexto) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mesTexto || '').trim());
  if (m) return serieMes(Number(m[1]), Number(m[2]));
  const [Y, M] = hoyMadrid().split('-').map(Number);
  return serieMes(Y, M);
}

module.exports = { SEDE, resumen, aEstaHora, rango, crecimiento, comoVamos, serieMes, serie, leerConfig, guardarConfig };
