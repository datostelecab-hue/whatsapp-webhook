// ============================================================
// EL BANCO DE KM — los km fuera de BOLT, con su límite (db/267, 18/11/2026)
// ============================================================
// Camilo: «Va a haber un banco de KM por así decirlo por fuera, en el cual va
// por conductor y un resumen de matrículas por semana. La idea es que tengan
// un límite de 17,5 km por fuera desconectado al día, por cada uno; si
// descansa no se le suma al límite. Por ejemplo, si es una persona que está
// programada para trabajar en el planificador 5 días, entonces tiene 87,5 km
// de límite a la semana, pero si se programó otro día de la nada entonces son
// 6 días y el límite sube a 105; esto también aplica a los NN».
//
// LAS REGLAS (las eligió Camilo el mismo día)
//   · LOS KM QUE GASTAN BANCO: todos los de fuera de BOLT, desconectado y en
//     descanso. Son los de la columna «KM fuera BOLT» del reporte de horas de
//     Control, con su misma regla: si tenía el coche fichado por WhatsApp, son
//     suyos (aunque se olvidara de terminar el turno); si nadie lo tenía
//     fichado, del último que estuvo en BOLT con él. Se calculan con el MISMO
//     código (Control/reporteHoras.repo.reporteDia): dos cuentas distintas del
//     mismo dato acabarían discrepando.
//   · EL LÍMITE (desde el 18/11/2026, db/268): cada hora DE VIAJE en BOLT
//     genera 8,8 km (banco_km.km_hora_viaje), con un tope de 53 km al día
//     (banco_km.tope_dia). La espera no genera. Camilo: «cada hora de viaje en
//     BOLT genera 8,8 km por fuera en el banco, con un límite de 53 km al día».
//     Antes (db/267) eran 17,5 km por cada día que le tocaba en el
//     planificador; todo el banco se rehízo con la regla nueva (VERSION 2).
//   · LOS KM JUSTIFICADOS (db/268): una justificación de KM aprobada (llave
//     «/justificantes/km») resta de sus km fuera de ese día, nunca por debajo de
//     cero. Van «por fuera del límite y de los km generados». La pendiente se
//     enseña pero no resta. Se leen en vivo, no en la foto: aprobar una no
//     obliga a recalcular nada.
//   · LA SEMANA: de lunes a domingo, y empieza de cero.
//   · LA JORNADA: la del reporte de Control (el turno de día y el de noche de
//     ese día). Se calcula CERRADA: después de las 12:00 del día siguiente, que
//     es cuando el reporte deja de ser parcial. Hoy no cuenta.
//
// EL DESGLOSE (18/11/2026): en la ficha de una persona, cada día dice de dónde
// salen sus km: en descanso, desconectado, por no terminar el turno (tenía el
// coche fichado y lo llevaba otro) o fichado sin conectarse. Camilo:
// «Necesitamos decirles: ey, por no haber desfichado, mira los KM que se te
// imputan». Se calcula al abrir la ficha, solo con sus coches de esa semana
// (bancoKm.desglose.js), y se escala a los km de la foto.
//
// CÓMO: una foto por jornada (km_banco_dia y km_banco_coche). La hace la tarea
// programada «banco_km.dia» (como mucho tres jornadas por vuelta, la más nueva
// primero, desde el lunes 26/10/2026, cuando entró en el ciclo de bloqueo toda
// la plantilla) y se puede rehacer una semana a mano («Recalcular»). Las
// pantallas solo leen la foto.
'use strict';

const repo = require('./bancoKm.repo');
const parametros = require('../../services/parametros');
const tareasProgramadas = require('../../services/tareasProgramadas');
const calendario = require('../../services/calendario');
const desg = require('./bancoKm.desglose');

/** El primer día del banco: el lunes en que toda la plantilla entró en el ciclo de bloqueo (db/219). */
const DESDE = process.env.BANCO_KM_DESDE || '2026-10-26';
/** Margen tras el cierre de la jornada, para que entre lo último de BOLT y Mapon. */
const MARGEN_MS = 60 * 60 * 1000;
const POR_VUELTA = 3;
/**
 * La regla con la que se calcula la foto. Un día de otra versión se rehace.
 *   2 = por horas de viaje (db/268)
 *   3 = además, el desglose por causa de cada coche (db/269)
 */
const VERSION = 3;
const kmj = require('../../services/repo/kmJustificacion');

function error(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const esDia = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
const r1 = v => Math.round((Number(v) || 0) * 10) / 10;
const sumarDias = calendario.sumarDias;
/** El lunes de la semana de un día. */
function lunesDe(dia) {
  const d = new Date(`${dia}T12:00:00Z`);
  return sumarDias(dia, -((d.getUTCDay() + 6) % 7));
}

// El reporte y su cierre, perezosos: así las pruebas los pueden sustituir.
let _reporte = null;
const reporte = () => (_reporte || (_reporte = require('../Control/reporteHoras.service').reporteDia));
const cierreDe = dia => +require('../../services/flotaViva/repartoTurnos').cierreDe(dia);

/** La última jornada cerrada (con su margen) a una hora dada. */
function ultimaCerrada(ahora = new Date()) {
  let d = calendario.partesMadrid(ahora).fecha;
  while (cierreDe(d) + MARGEN_MS > +ahora) d = sumarDias(d, -1);
  return d;
}

// ── Una jornada ─────────────────────────────────────────────────────────────
/**
 * Lo que genera un día: `kmHora` por hora de viaje, con `tope`. Puro.
 * 3 h de viaje a 8,8 = 26,4 km; 7 h = 61,6, que se quedan en 53.
 */
const generado = (horasViaje, { kmHora, tope }) => Math.min(tope, r1((Number(horasViaje) || 0) * kmHora));

/** La regla de ahora, de los parámetros. */
async function regla() {
  const [kmHora, tope] = await Promise.all([parametros.valor('banco_km.km_hora_viaje'), parametros.valor('banco_km.tope_dia')]);
  return { kmHora: Number.isFinite(Number(kmHora)) ? Number(kmHora) : 8.8, tope: Number.isFinite(Number(tope)) ? Number(tope) : 53 };
}

/**
 * De las filas del reporte de un día, lo que se guarda. Puro.
 * `r`: la regla ({ kmHora, tope }).
 */
function filasDelDia(filasReporte, r) {
  const filas = [], coches = [];
  const vistas = new Set();
  for (const f of filasReporte) {
    // Los de otra sede (todos sus coches de Barcelona) no son de este banco.
    if (f.otraSede) continue;
    if (!f.persona || vistas.has(f.persona)) continue;
    vistas.add(f.persona);
    const oficina = !!f.deOficina;
    const programado = !!f.debiaSalir;
    const trabajo = (Number(f.horas) || 0) > 0;
    const horasViaje = Math.round((Number(f.horasViaje) || 0) * 100) / 100;
    const km = typeof f.kmDesc === 'number' ? r1(f.kmDesc) : 0;
    const porCoche = Object.entries(f.kmFueraPorCoche || {}).filter(([, k]) => k > 0);
    if (!programado && !trabajo && !km && !porCoche.length) continue;
    filas.push({
      persona: f.persona, conductor_id: f.conductorId || null, nombre: String(f.nombre || '').slice(0, 200),
      turno: String(f.turno || '').slice(0, 16), programado, trabajo, horas: r1(f.horas), oficina,
      justificado: !!f.esJ,
      // La oficina no tiene banco: sus km salen solo en las matrículas.
      limite_km: oficina ? 0 : generado(horasViaje, r), horas_viaje: horasViaje,
      km_fuera: km, revisar: f.kmDesc === 'REVISAR',
      fichaje: String(f.fichaje || '').slice(0, 300), sin_fichar: !!f.sinFichar,
    });
    porCoche.forEach(([matricula, k]) => coches.push({ persona: f.persona, matricula: String(matricula).slice(0, 16), km_fuera: r1(k) }));
  }
  return { filas, coches };
}

/**
 * Calcula y guarda una jornada CERRADA. `cli`: la transacción donde se guarda
 * (la de la tarea, o una propia). Lanza si la jornada no está cerrada o si los
 * km con el fichaje no salieron (se reintenta luego: sin el fichaje, los km de
 * quien tenía el coche fichado se los llevaría otro).
 */
async function calcularDia(dia, { cli, usuarioId = null, ahora = new Date() } = {}) {
  if (!esDia(dia)) throw error('Ese día no se entiende');
  if (dia < DESDE) throw error(`El banco de KM empieza el ${DESDE.split('-').reverse().join('/')}`);
  if (dia > ultimaCerrada(ahora)) throw error('Esa jornada aún no está cerrada: se calcula después de las 12:00 del día siguiente');
  const t0 = Date.now();
  const rep = await reporte()(dia, { conKmFuera: true });
  if (rep.parcial) throw error('Esa jornada aún no está cerrada');
  if (rep.sinFichaje) throw error(`Los km con el fichaje no salieron (${rep.sinFichaje}): se reintenta más tarde`);
  const { filas, coches } = filasDelDia(rep.filas || [], await regla());
  // DE DÓNDE SALE CADA KM (db/269), coche a coche: lo mismo que la ficha, para
  // toda la jornada de una vez. Si no sale, el día se guarda igual, sin él
  // (NULL): los km fuera de BOLT siguen valiendo.
  try {
    const porCoche = await desglosarDia(dia, filas, coches);
    coches.forEach((c, i) => Object.assign(c, porCoche[i]));
  } catch (e) {
    console.warn(`⚠️ [Banco de KM] ${dia}: sin el desglose por causa (${e.message})`);
  }
  const guardar = c => repo.guardarDia(c, dia, { filas, coches, milisegundos: Date.now() - t0, usuarioId, version: VERSION });
  if (cli) await guardar(cli);
  else await require('../../services/db').transaccion(guardar);
  return { personas: filas.length, km: r1(filas.reduce((s, f) => s + f.km_fuera, 0)) };
}

/** Las jornadas cerradas que faltan, la más nueva primero. */
async function pendientes(ahora = new Date()) {
  const hasta = ultimaCerrada(ahora);
  if (hasta < DESDE) return [];
  let hechos;
  try { hechos = await repo.calculados(DESDE, hasta); } catch (e) { if (repo.faltaMigracion(e)) return []; throw e; }
  const faltan = [];
  // Los que faltan, y los calculados con una regla anterior (se rehacen).
  for (let d = hasta; d >= DESDE; d = sumarDias(d, -1)) if ((hechos.get(d) || 0) < VERSION) faltan.push(d);
  return faltan;
}

tareasProgramadas.registrar({
  clave: 'banco_km.dia',
  descripcion: 'Banco de KM: la foto de cada jornada cerrada (los km fuera de BOLT y el límite de cada uno)',
  desde: DESDE,
  // Como mucho tres por vuelta, la más nueva primero: la de ayer sale enseguida
  // y el histórico se rellena poco a poco, sin cargar la base de golpe. El
  // periodo lleva la versión de la regla («2026-11-16#v2»): un día ya hecho con
  // la anterior es OTRO periodo para la tarea, y así se rehace.
  //
  // La más nueva siempre; las otras dos, rotando por la lista con cada vuelta:
  // si un día falla una y otra vez (la tarea lo deja tras cinco fallos), no
  // tapa a los que vienen detrás.
  toca: async ahora => {
    const p = await pendientes(ahora);
    if (p.length <= POR_VUELTA) return p.map(d => `${d}#v${VERSION}`);
    const resto = p.slice(1);
    const giro = Math.floor(+ahora / (10 * 60 * 1000)) % resto.length;
    const elegidos = [p[0], ...resto.slice(giro), ...resto.slice(0, giro)].slice(0, POR_VUELTA);
    return elegidos.map(d => `${d}#v${VERSION}`);
  },
  hacer: ({ periodo, cli }) => calcularDia(String(periodo).slice(0, 10), { cli }),
});

// ── Recalcular una semana a mano ────────────────────────────────────────────
// En segundo plano y de una en una: siete reportes seguidos no pueden hacer
// esperar a una petición, ni dos personas lanzar lo mismo a la vez.
let recalculando = null;
function recalcular(lunes, usuarioId) {
  if (!esDia(lunes)) throw error('Esa semana no se entiende');
  const l = lunesDe(lunes);
  if (recalculando) throw error(`Ya se está recalculando la semana del ${recalculando.lunes.split('-').reverse().join('/')}: espera a que acabe`, 409);
  const hasta = ultimaCerrada();
  const dias = [...Array(7).keys()].map(i => sumarDias(l, i)).filter(d => d >= DESDE && d <= hasta);
  if (!dias.length) throw error('Esa semana no tiene ninguna jornada cerrada que calcular');
  recalculando = { lunes: l, hechos: 0, total: dias.length, errores: [] };
  (async () => {
    for (const d of dias) {
      try { await calcularDia(d, { usuarioId }); } catch (e) { recalculando.errores.push(`${d}: ${e.message}`); console.error(`❌ [Banco de KM] ${d}:`, e.message); }
      recalculando.hechos++;
    }
  })().finally(() => { recalculando = null; });
  return { enMarcha: true, dias: dias.length };
}
const recalculo = () => (recalculando ? { ...recalculando } : null);

// ── Mirar una semana ────────────────────────────────────────────────────────
const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/**
 * Una semana: los conductores con su banco y las matrículas con sus km.
 * Solo jornadas cerradas y calculadas; la pantalla dice cuáles faltan.
 */
async function semana(lunesPedido) {
  const hoyLunes = lunesDe(calendario.partesMadrid(new Date()).fecha);
  const lunes = esDia(lunesPedido) ? lunesDe(lunesPedido) : lunesDe(ultimaCerrada());
  const domingo = sumarDias(lunes, 6);
  const cerrada = ultimaCerrada();
  let datos, calc;
  let just;
  try {
    [datos, calc] = await Promise.all([repo.dias(lunes, domingo), repo.calculos(lunes, domingo)]);
  } catch (e) { if (repo.faltaMigracion(e)) return { sinMigracion: true }; throw e; }
  try { just = await kmj.porConductorYDia(lunes, domingo); } catch (e) { if (kmj.faltaMigracion(e)) just = new Map(); else throw e; }
  const r = await regla();
  const dias = [...Array(7).keys()].map(i => {
    const d = sumarDias(lunes, i);
    return { dia: d, corto: DIAS_CORTOS[i], cerrada: d <= cerrada && d >= DESDE, calculada: calc.has(d) };
  });

  // Coches por persona y día.
  const cochesDe = new Map();
  datos.coches.forEach(c => {
    const k = `${c.dia}|${c.persona}`;
    if (!cochesDe.has(k)) cochesDe.set(k, []);
    cochesDe.get(k).push({ matricula: c.matricula, km: c.km, kmDescanso: c.kmDescanso, kmDesconectado: c.kmDesconectado,
      kmFichadoSinBolt: c.kmFichadoSinBolt, kmNoDesfichar: c.kmNoDesfichar });
  });

  // ── Por conductor ──
  const porPersona = new Map();
  datos.personas.filter(p => !p.oficina).forEach(p => {
    if (!porPersona.has(p.persona)) {
      porPersona.set(p.persona, { persona: p.persona, conductorId: p.conductorId, nombre: p.nombre, turno: p.turno,
        sinFicha: !p.conductorId, programados: 0, extra: 0, limite: 0, km: 0, revisar: false, sinFichar: 0, dias: [],
        horasViaje: 0, kmFuera: 0, justificados: 0, pendientes: 0,
        // De dónde salen (db/269): suyos (desconectado, descanso o fichado sin
        // BOLT) y por no desfichar; `kmDesglosado`, la suma de los dos (los %
        // son de ahí: lo que quedó «sin desglose», menos del 1 %, no cuenta).
        kmSuyos: 0, kmNoDesfichar: 0, kmDesglosado: 0 });
    }
    const x = porPersona.get(p.persona);
    // Lo justificado de ese día (solo las de un conductor de la plantilla).
    const j = p.conductorId ? just.get(`${p.conductorId}|${p.dia}`) : null;
    const aprobados = Math.min(p.km, j ? j.aprobados : 0);
    const gasto = r1(p.km - aprobados);
    x.nombre = p.nombre || x.nombre;
    if (p.turno) x.turno = p.turno;
    if (p.programado) x.programados++;
    else if (p.trabajo) x.extra++;
    x.limite = r1(x.limite + p.limite);
    // `km` es lo que GASTA: los km fuera de BOLT menos lo justificado y aprobado.
    x.km = r1(x.km + gasto);
    x.kmFuera = r1(x.kmFuera + p.km);
    x.justificados = r1(x.justificados + aprobados);
    x.pendientes = r1(x.pendientes + (j ? j.pendientes : 0));
    x.horasViaje = Math.round((x.horasViaje + p.horasViaje) * 100) / 100;
    (cochesDe.get(`${p.dia}|${p.persona}`) || []).forEach(c => {
      if (c.kmNoDesfichar == null) return;
      x.kmSuyos = r1(x.kmSuyos + c.kmDescanso + c.kmDesconectado + c.kmFichadoSinBolt);
      x.kmNoDesfichar = r1(x.kmNoDesfichar + c.kmNoDesfichar);
      x.kmDesglosado = r1(x.kmDesglosado + c.kmDescanso + c.kmDesconectado + c.kmFichadoSinBolt + c.kmNoDesfichar);
    });
    if (p.revisar) x.revisar = true;
    if (p.sinFichar) x.sinFichar++;
    x.dias.push({ dia: p.dia, programado: p.programado, trabajo: p.trabajo, justificado: p.justificado, horas: p.horas,
      horasViaje: p.horasViaje, limite: p.limite, kmFuera: p.km, km: gasto, revisar: p.revisar, fichaje: p.fichaje, sinFichar: p.sinFichar,
      justificados: aprobados, pendientes: j ? j.pendientes : 0, justificaciones: j ? j.lista : [],
      coches: cochesDe.get(`${p.dia}|${p.persona}`) || [] });
  });
  const conductores = [...porPersona.values()]
    .filter(x => x.limite > 0 || x.kmFuera > 0)
    .map(x => {
      const saldo = r1(x.limite - x.km);
      const estado = x.km > x.limite ? 'pasado' : x.limite > 0 && x.km >= x.limite * 0.8 ? 'cerca' : 'dentro';
      // Las matrículas de la semana, la de más km primero.
      const mats = new Map();
      x.dias.forEach(d => d.coches.forEach(c => mats.set(c.matricula, r1((mats.get(c.matricula) || 0) + c.km))));
      // Los % de sus km fuera (db/269): de lo desglosado (casi siempre, todo).
      const pctDe = k => (x.kmDesglosado > 0 ? Math.round(k / x.kmDesglosado * 100) : null);
      return { ...x, saldo, estado, pct: x.limite > 0 ? Math.round(x.km / x.limite * 100) : null,
        pctSuyos: pctDe(x.kmSuyos), pctNoDesfichar: pctDe(x.kmNoDesfichar),
        matriculas: [...mats.entries()].sort((a, b) => b[1] - a[1]).map(([matricula, km]) => ({ matricula, km })) };
    })
    .sort((a, b) => a.saldo - b.saldo || a.nombre.localeCompare(b.nombre, 'es'));

  // ── Por matrícula ──
  const nombreDe = new Map(datos.personas.map(p => [p.persona, { nombre: p.nombre, oficina: p.oficina }]));
  const porCoche = new Map();
  datos.coches.forEach(c => {
    if (!porCoche.has(c.matricula)) porCoche.set(c.matricula, { matricula: c.matricula, km: 0, personas: new Map(), dias: new Map() });
    const x = porCoche.get(c.matricula);
    x.km = r1(x.km + c.km);
    const quien = nombreDe.get(c.persona) || { nombre: c.persona };
    const pp = x.personas.get(c.persona) || { persona: c.persona, nombre: quien.nombre, oficina: !!quien.oficina, km: 0 };
    pp.km = r1(pp.km + c.km);
    x.personas.set(c.persona, pp);
    const dd = x.dias.get(c.dia) || [];
    dd.push({ persona: c.persona, nombre: quien.nombre, km: c.km });
    x.dias.set(c.dia, dd);
  });
  const coches = [...porCoche.values()].map(x => ({
    matricula: x.matricula, km: x.km,
    personas: [...x.personas.values()].sort((a, b) => b.km - a.km)
      .map(p => ({ ...p, pct: x.km > 0 ? Math.round(p.km / x.km * 100) : 0 })),
    dias: [...x.dias.entries()].sort().map(([dia, quienes]) => ({ dia, quienes: quienes.sort((a, b) => b.km - a.km) })),
    diasConKm: x.dias.size,
  })).sort((a, b) => b.km - a.km);

  return {
    lunes, domingo, desde: DESDE, enCurso: lunes === hoyLunes, anterior: lunes > DESDE ? sumarDias(lunes, -7) : null,
    siguiente: lunes < hoyLunes ? sumarDias(lunes, 7) : null, dias, kmHora: r.kmHora, tope: r.tope,
    faltan: dias.filter(d => d.cerrada && !d.calculada).map(d => d.dia),
    calculadaAt: [...calc.values()].reduce((m, c) => (!m || c.at > m ? c.at : m), null),
    recalculando: recalculo(), conductores, coches,
  };
}

/** Las últimas semanas de una persona (su historia, en la ficha). */
async function historia(persona, hasta) {
  if (!/^[a-z][^\u0000-\u001f]{1,79}$/i.test(String(persona || ''))) throw error('Esa persona no se entiende');
  const fin = esDia(hasta) ? sumarDias(lunesDe(hasta), 6) : ultimaCerrada();
  const ini = sumarDias(lunesDe(fin), -7 * 7);
  const semanas = await repo.semanasDe(persona, ini < DESDE ? DESDE : ini, fin);
  return { semanas: semanas.map(s => ({ ...s, saldo: r1(s.limite - s.km) })) };
}

// ── Justificar km desde la ficha (db/268) ───────────────────────────────────
/**
 * Apunta una justificación de KM de un conductor y un día, desde su ficha del
 * banco. Nace pendiente: la aprueba quien tiene la llave «/justificantes/km».
 */
async function justificar({ persona, dia, km, matricula, motivo } = {}, usuarioId) {
  const m = /^c(\d+)$/.exec(String(persona || ''));
  if (!m) throw error('Solo se justifican km de un conductor de la plantilla');
  if (!esDia(dia) || dia < DESDE || dia > ultimaCerrada()) throw error('Ese día no está en el banco');
  return kmj.poner({ conductorId: Number(m[1]), dia, km, matricula, motivo, origen: 'banco_km', usuarioId });
}

// ── El desglose de una persona ──────────────────────────────────────────────
/**
 * La ventana de una persona en una jornada, la del reporte de Control por su
 * turno: de noche, de 12:00 a 12:00 del día siguiente; quien hace los dos, de
 * 00:00 a 12:00 del día siguiente; de día (o sin turno), el día natural.
 */
function ventana(dia, turno) {
  const t = String(turno || '').trim();
  const [h0, mas, h1] = t === 'Noche' ? [12, 1, 12] : t === 'TodoTurno' ? [0, 1, 12] : [0, 1, 0];
  return [+calendario.instante(dia, h0 * 60), +calendario.instante(sumarDias(dia, mas), h1 * 60)];
}
const PERSONA = /^[a-z][^\u0000-\u001f]{1,79}$/i;

/**
 * EL REPARTO POR CAUSA de unos km: `items` = [{ dia, persona, matricula, km,
 * turno }], con los datos crudos de esos coches ya leídos (repo.crudoDesglose).
 * Devuelve, en el mismo orden, la lista de causas de cada uno, escalada a sus
 * km (bancoKm.desglose.js). Lo usan la ficha (una persona, una semana) y la
 * foto (toda la jornada).
 */
function repartir(items, crudo, ahora = Date.now()) {
  const fines = desg.finesKm(crudo.tramos, ahora);
  const agrupar = (lista, k) => {
    const m = new Map();
    lista.forEach(x => { if (!m.has(x[k])) m.set(x[k], []); m.get(x[k]).push(x); });
    return m;
  };
  const tramosDe = agrupar(crudo.tramos.map(t => ({ ...t, fin: fines.get(t.id) })), 'vehiculo');
  const odo = agrupar(crudo.odometro, 'unit'), rut = agrupar(crudo.rutas, 'unit');
  const vehDe = new Map(crudo.vehiculos.map(v => [v.matricula, v]));
  // Quién es cada cuenta un día (las prestadas, de quien la usaba) y su nombre.
  const base = new Map(crudo.cuentas.map(c => [c.cuenta, c]));
  const prestada = (cuenta, dia) => crudo.fantasmas.find(f => f.cuenta === cuenta && f.desde <= dia && (!f.hasta || f.hasta >= dia));
  const personaDe = (cuenta, dia) => {
    const p = prestada(cuenta, dia);
    if (p) return `c${p.conductorId}`;
    const b = base.get(cuenta);
    return b && b.conductorId ? `c${b.conductorId}` : `b${cuenta}`;
  };
  const nombreDe = dia => cuenta => {
    const p = prestada(cuenta, dia);
    return (p && p.nombre) || (base.get(cuenta) || {}).nombre || 'otra cuenta de BOLT';
  };
  return items.map(it => {
    const v = vehDe.get(it.matricula);
    if (!v) return desg.escalar(new Map(), it.km);
    const [a, b] = ventana(it.dia, it.turno);
    const tz = desg.trozos({ odometro: odo.get(v.unit) || [], rutas: rut.get(v.unit) || [] }, a, b);
    const delCoche = tramosDe.get(v.uuid) || [];
    const suyas = new Set(delCoche.map(t => t.cuenta).filter(cu => personaDe(cu, it.dia) === it.persona));
    const fichajes = crudo.fichajes.filter(f => (v.unit && f.unit === v.unit) || f.matricula === it.matricula);
    return desg.escalar(desg.clasificar(tz, { tramos: delCoche, fichajes, persona: it.persona, suyas, nombreDe: nombreDe(it.dia), ahora }), it.km);
  });
}

/**
 * Las cuatro columnas de la foto (db/269) de una lista de causas. Puro. Si no
 * hay nada desglosado (solo «sin desglose»), las cuatro van a null: no es un 0 %.
 */
function columnasDeCausas(causas) {
  const de = c => r1(causas.filter(x => x.causa === c).reduce((s, x) => s + x.km, 0));
  if (!causas.some(x => x.causa !== 'sin_desglose' && x.km > 0)) {
    return { km_descanso: null, km_desconectado: null, km_fichado_sin_bolt: null, km_no_desfichar: null };
  }
  return { km_descanso: de('descanso'), km_desconectado: de('desconectado'),
    km_fichado_sin_bolt: de('fichado_sin_bolt'), km_no_desfichar: de('fichaje_abierto') };
}

/**
 * El desglose de una jornada entera, para la foto: por cada coche de `coches`
 * (las filas de km_banco_coche), sus cuatro columnas. Una lectura de los datos
 * crudos de todos los coches del día, de las 00:00 a las 12:00 del día siguiente
 * (lo que cubren las ventanas de todos los turnos).
 */
async function desglosarDia(dia, filas, coches) {
  const conKm = coches.filter(c => c.km_fuera > 0);
  if (!conKm.length) return coches.map(() => ({}));
  const turnoDe = new Map(filas.map(f => [f.persona, f.turno]));
  const crudo = await repo.crudoDesglose({
    matriculas: [...new Set(conKm.map(c => c.matricula))],
    ini: +calendario.instante(dia, 0), fin: +calendario.instante(sumarDias(dia, 1), 12 * 60),
  });
  const items = coches.map(c => ({ dia, persona: c.persona, matricula: c.matricula, km: c.km_fuera, turno: turnoDe.get(c.persona) }));
  const reparto = repartir(items.filter(x => x.km > 0), crudo);
  let i = 0;
  return items.map(x => (x.km > 0 ? columnasDeCausas(reparto[i++]) : {}));
}

/**
 * De dónde salen los km fuera de BOLT de una persona en una semana, día a día y
 * coche a coche. Solo lee: sus días de la foto y los datos crudos de sus coches.
 */
async function desglose(persona, lunesPedido) {
  if (!PERSONA.test(String(persona || ''))) throw error('Esa persona no se entiende');
  const lunes = esDia(lunesPedido) ? lunesDe(lunesPedido) : lunesDe(ultimaCerrada());
  const domingo = sumarDias(lunes, 6);
  const foto = await repo.diasDe(persona, lunes, domingo);
  const conKm = foto.coches.filter(c => c.km > 0);
  const etiquetas = Object.fromEntries(desg.CAUSAS.map(c => [c.codigo, c.etiqueta]));
  if (!conKm.length) return { lunes, dias: [], semana: [], fichajes: {}, causas: desg.CAUSAS };

  const turnoDe = new Map(foto.dias.map(d => [d.dia, d.turno]));
  const ventanas = new Map(conKm.map(c => [c.dia, ventana(c.dia, turnoDe.get(c.dia))]));
  const ini = Math.min(...[...ventanas.values()].map(v => v[0]));
  const fin = Math.max(...[...ventanas.values()].map(v => v[1]));
  const crudo = await repo.crudoDesglose({ matriculas: [...new Set(conKm.map(c => c.matricula))], ini, fin });

  const repartos = repartir(conKm.map(c => ({ dia: c.dia, persona, matricula: c.matricula, km: c.km, turno: turnoDe.get(c.dia) })), crudo);

  const dias = new Map();
  const usados = new Set();
  conKm.forEach((c, i) => {
    const causas = repartos[i];
    causas.forEach(x => { if (x.fichajeId) usados.add(x.fichajeId); });
    if (!dias.has(c.dia)) dias.set(c.dia, { dia: c.dia, km: 0, coches: [] });
    const d = dias.get(c.dia);
    d.km = r1(d.km + c.km);
    d.coches.push({ matricula: c.matricula, km: c.km, causas: causas.map(x => ({ ...x, etiqueta: etiquetas[x.causa] })) });
  });

  // La semana, por causa (y, por no terminar el turno, con quién llevaba el coche).
  const sem = new Map();
  [...dias.values()].forEach(d => d.coches.forEach(c => c.causas.forEach(x => {
    const k = x.causa === 'fichaje_abierto' ? `${x.causa}|${x.con || ''}` : x.causa;
    const y = sem.get(k) || { causa: x.causa, etiqueta: etiquetas[x.causa], con: x.causa === 'fichaje_abierto' ? x.con : null, km: 0 };
    y.km = r1(y.km + x.km);
    sem.set(k, y);
  })));
  const fichajes = {};
  crudo.fichajes.filter(f => usados.has(f.id)).forEach(f => {
    fichajes[f.id] = { inicio: new Date(f.inicio).toISOString(), fin: f.fin ? new Date(f.fin).toISOString() : null, estado: f.estado, matricula: f.matricula };
  });
  return {
    lunes, dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    semana: [...sem.values()].sort((a, b) => b.km - a.km), fichajes, causas: desg.CAUSAS,
  };
}

module.exports = {
  semana, historia, recalcular, calcularDia, pendientes, desglose, justificar, DESDE, VERSION,
  _generado: generado, _columnasDeCausas: columnasDeCausas, _desglosarDia: desglosarDia,
  // Para las pruebas:
  _filasDelDia: filasDelDia, _lunesDe: lunesDe, _ultimaCerrada: ultimaCerrada,
  _conReporte: fn => { _reporte = fn; },
};
