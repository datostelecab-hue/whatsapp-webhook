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
//   · EL LÍMITE: 17,5 km (el parámetro banco_km.km_dia) por cada día que le
//     tocaba en el planificador, haya salido o no, y por cada día que salió sin
//     tocarle (un NN, un día extra). Vacaciones, baja o libranza no suman.
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
 * De las filas del reporte de un día, lo que se guarda. Puro.
 * `kmDia`: lo que suma al límite cada día que cuenta.
 */
function filasDelDia(filasReporte, kmDia) {
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
    const km = typeof f.kmDesc === 'number' ? r1(f.kmDesc) : 0;
    const porCoche = Object.entries(f.kmFueraPorCoche || {}).filter(([, k]) => k > 0);
    if (!programado && !trabajo && !km && !porCoche.length) continue;
    filas.push({
      persona: f.persona, conductor_id: f.conductorId || null, nombre: String(f.nombre || '').slice(0, 200),
      turno: String(f.turno || '').slice(0, 16), programado, trabajo, horas: r1(f.horas), oficina,
      justificado: !!f.esJ,
      // La oficina no tiene banco: sus km salen solo en las matrículas.
      limite_km: !oficina && (programado || trabajo) ? kmDia : 0,
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
  const kmDia = Number(await parametros.valor('banco_km.km_dia'));
  const { filas, coches } = filasDelDia(rep.filas || [], Number.isFinite(kmDia) ? kmDia : 17.5);
  const guardar = c => repo.guardarDia(c, dia, { filas, coches, milisegundos: Date.now() - t0, usuarioId });
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
  for (let d = hasta; d >= DESDE; d = sumarDias(d, -1)) if (!hechos.has(d)) faltan.push(d);
  return faltan;
}

tareasProgramadas.registrar({
  clave: 'banco_km.dia',
  descripcion: 'Banco de KM: la foto de cada jornada cerrada (los km fuera de BOLT y el límite de cada uno)',
  desde: DESDE,
  // Como mucho tres por vuelta, la más nueva primero: la de ayer sale enseguida
  // y el histórico se rellena poco a poco, sin cargar la base de golpe.
  toca: async ahora => (await pendientes(ahora)).slice(0, POR_VUELTA),
  hacer: ({ periodo, cli }) => calcularDia(periodo, { cli }),
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
  try {
    [datos, calc] = await Promise.all([repo.dias(lunes, domingo), repo.calculos(lunes, domingo)]);
  } catch (e) { if (repo.faltaMigracion(e)) return { sinMigracion: true }; throw e; }
  const kmDia = Number(await parametros.valor('banco_km.km_dia'));
  const dias = [...Array(7).keys()].map(i => {
    const d = sumarDias(lunes, i);
    return { dia: d, corto: DIAS_CORTOS[i], cerrada: d <= cerrada && d >= DESDE, calculada: calc.has(d) };
  });

  // Coches por persona y día.
  const cochesDe = new Map();
  datos.coches.forEach(c => {
    const k = `${c.dia}|${c.persona}`;
    if (!cochesDe.has(k)) cochesDe.set(k, []);
    cochesDe.get(k).push({ matricula: c.matricula, km: c.km });
  });

  // ── Por conductor ──
  const porPersona = new Map();
  datos.personas.filter(p => !p.oficina).forEach(p => {
    if (!porPersona.has(p.persona)) {
      porPersona.set(p.persona, { persona: p.persona, conductorId: p.conductorId, nombre: p.nombre, turno: p.turno,
        sinFicha: !p.conductorId, programados: 0, extra: 0, limite: 0, km: 0, revisar: false, sinFichar: 0, dias: [] });
    }
    const x = porPersona.get(p.persona);
    x.nombre = p.nombre || x.nombre;
    if (p.turno) x.turno = p.turno;
    if (p.programado) x.programados++;
    else if (p.trabajo) x.extra++;
    x.limite = r1(x.limite + p.limite);
    x.km = r1(x.km + p.km);
    if (p.revisar) x.revisar = true;
    if (p.sinFichar) x.sinFichar++;
    x.dias.push({ dia: p.dia, programado: p.programado, trabajo: p.trabajo, justificado: p.justificado, horas: p.horas,
      limite: p.limite, km: p.km, revisar: p.revisar, fichaje: p.fichaje, sinFichar: p.sinFichar,
      coches: cochesDe.get(`${p.dia}|${p.persona}`) || [] });
  });
  const conductores = [...porPersona.values()]
    .filter(x => x.limite > 0 || x.km > 0)
    .map(x => {
      const saldo = r1(x.limite - x.km);
      const estado = x.km > x.limite ? 'pasado' : x.limite > 0 && x.km >= x.limite * 0.8 ? 'cerca' : 'dentro';
      // Las matrículas de la semana, la de más km primero.
      const mats = new Map();
      x.dias.forEach(d => d.coches.forEach(c => mats.set(c.matricula, r1((mats.get(c.matricula) || 0) + c.km))));
      return { ...x, saldo, estado, pct: x.limite > 0 ? Math.round(x.km / x.limite * 100) : null,
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
    siguiente: lunes < hoyLunes ? sumarDias(lunes, 7) : null, dias, kmDia: Number.isFinite(kmDia) ? kmDia : 17.5,
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

  const ahora = Date.now();
  const fines = desg.finesKm(crudo.tramos, ahora);
  const tramos = crudo.tramos.map(t => ({ ...t, fin: fines.get(t.id) }));
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

  const dias = new Map();
  const usados = new Set();
  for (const c of conKm) {
    const v = crudo.vehiculos.find(x => x.matricula === c.matricula);
    let causas;
    if (!v) causas = desg.escalar(new Map(), c.km);
    else {
      const [a, b] = ventanas.get(c.dia);
      const tz = desg.trozos({ odometro: crudo.odometro.filter(s => s.unit === v.unit), rutas: crudo.rutas.filter(s => s.unit === v.unit) }, a, b);
      const delCoche = tramos.filter(t => t.vehiculo === v.uuid);
      const suyas = new Set(delCoche.map(t => t.cuenta).filter(cu => personaDe(cu, c.dia) === persona));
      const fichajes = crudo.fichajes.filter(f => (v.unit && f.unit === v.unit) || f.matricula === c.matricula);
      causas = desg.escalar(desg.clasificar(tz, { tramos: delCoche, fichajes, persona, suyas, nombreDe: nombreDe(c.dia), ahora }), c.km);
    }
    causas.forEach(x => { if (x.fichajeId) usados.add(x.fichajeId); });
    if (!dias.has(c.dia)) dias.set(c.dia, { dia: c.dia, km: 0, coches: [] });
    const d = dias.get(c.dia);
    d.km = r1(d.km + c.km);
    d.coches.push({ matricula: c.matricula, km: c.km, causas: causas.map(x => ({ ...x, etiqueta: etiquetas[x.causa] })) });
  }

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
  semana, historia, recalcular, calcularDia, pendientes, desglose, DESDE,
  // Para las pruebas:
  _filasDelDia: filasDelDia, _lunesDe: lunesDe, _ultimaCerrada: ultimaCerrada,
  _conReporte: fn => { _reporte = fn; },
};
