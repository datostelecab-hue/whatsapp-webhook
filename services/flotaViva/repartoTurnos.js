// ============================================================
// EL REPARTO DE LAS HORAS POR TURNO — de quién es cada hora
// ============================================================
// Camilo, 06/10/2026: «hay gente de día que empieza desde antes de las 5am y no
// cuentan algunas horas». Las horas de un turno ya no son las que caen en un
// reloj fijo (día 05→17, noche 17→05), sino LAS DE LA GENTE DE ESE TURNO:
//
//   · El turno de DÍA cuenta de 00:00 a 24:00. Quien es de día y entra a las
//     04:00 ya está trabajando su turno.
//   · El turno de NOCHE cuenta de 12:00 a 12:00 del día siguiente. Quien es de
//     noche y entra a las 15:00 ya suma a la noche, y su madrugada también.
//   · Siempre según el CONDUCTOR Y SU TURNO del cuadrante (`f_cobertura`), no
//     según la hora: a las 15:00 rueda gente de día y gente de noche a la vez.
//   · Los NN (sin plan) van por la HORA DE INICIO: quien empieza antes de las
//     12:00 es de día (8:00→15:00, día) y quien empieza a partir de las 12:00 es
//     de noche (12:30→20:00, noche).
//
// LAS DOS VENTANAS SE SOLAPAN (de 12:00 a 24:00 caben las dos), así que no basta
// con mirar en qué ventana cae cada minuto: hay que decidir de QUIÉN es.
//
//   · Lo que cae dentro de la ventana de un turno que esa persona TIENE
//     PLANIFICADO es de ese turno. Si caben dos suyos (quien dobla día y noche,
//     o dos noches seguidas), es del que más recientemente ha empezado a su hora
//     estándar: quien dobla pasa de día a noche a las 17:00.
//   · Lo demás (los NN, y lo que alguien hace fuera de sus ventanas) va por
//     SESIONES: un rato de trabajo seguido (viaje o espera) que se corta cuando
//     pasa `HUECO_SESION` sin trabajar. La sesión es del turno de la hora a la
//     que EMPEZÓ, y si se sale de su ventana lo que sobra se reparte desde el
//     borde, como si empezara ahí.
//
// Así cada segundo es de un solo turno y la suma de los dos turnos es todo lo
// trabajado: nada se cuenta dos veces.
//
// Lo de «No terminará la jornada» y «En riesgo» NO cambia: se sigue midiendo
// contra las 17:00 y las 05:00, que es el estándar (Camilo, el mismo día). Lo
// que se amplía es qué horas cuentan, no cuándo acaba el turno.
//
// Lo usan Control (los NN) y Visibilidad (las tarjetas de turno), para que las
// dos pantallas cuenten con la misma regla.

const { HORA_DIA, HORA_NOCHE } = require('../nucleo');

const ZONA = 'Europe/Madrid';
// Dónde empieza a contar cada turno: el día a las 00:00, la noche a las 12:00.
// Las dos ventanas duran 24 h.
const INICIO = { dia: 0, noche: 12 };
// La hora estándar de entrar (05:00 y 17:00). Decide el empate cuando la misma
// persona tiene dos turnos planificados que podrían ser suyos a esa hora.
const ENTRA = { dia: HORA_DIA, noche: HORA_NOCHE };
// Un NN que empieza antes de esta hora es de día; desde ella, de noche.
const CORTE_NN = 12;
// Sin trabajar este rato, lo siguiente es otra sesión. Una comida o una espera
// larga no parten el turno; ir a casa y volver por la tarde, sí.
const HUECO_SESION_MS = Number(process.env.TURNO_HUECO_SESION_MIN || 120) * 60000;

// ── Fechas en hora de Madrid ────────────────────────────────────────────────
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function partes(ms) {
  const p = fmt.formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
/** La fecha de Madrid ('YYYY-MM-DD') y la hora decimal de un instante. */
function enMadrid(ms) {
  const p = partes(ms);
  return {
    fecha: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`,
    hora: p.h + p.mi / 60 + p.s / 3600,
  };
}
/** El desfase de Madrid con UTC en un instante, en ms (con su horario de verano). */
function desfase(ms) {
  const p = partes(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
/** El instante (ms) de una hora de reloj de Madrid (puede llevar decimales) en una fecha. */
function instante(fechaISO, hora = 0) {
  const [y, m, d] = String(fechaISO).slice(0, 10).split('-').map(Number);
  const comoUTC = Date.UTC(y, m - 1, d) + Math.round(hora * 3600000);
  // Dos pasadas: la segunda corrige si la primera cayó al otro lado del cambio
  // de hora. Los bordes que se usan (00, 05, 12, 17) nunca caen en la hora que
  // se repite o se salta, que es entre las 02:00 y las 03:00.
  let t = comoUTC - desfase(comoUTC);
  t = comoUTC - desfase(t);
  return t;
}
/** Una fecha 'YYYY-MM-DD' más n días, recorriendo el calendario. */
function sumarDias(fechaISO, n) {
  const [y, m, d] = String(fechaISO).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** La ventana [ini, fin) en ms de un turno de una fecha. */
function ventanaDe(fecha, turno) {
  return [instante(fecha, INICIO[turno]), instante(sumarDias(fecha, 1), INICIO[turno])];
}
const clave = (fecha, turno) => fecha + '|' + turno;

/**
 * DE QUÉ TURNO PLANIFICADO ES EL INSTANTE `t`, o null si no cae en ninguno.
 *
 * Entre los turnos que esa persona tiene planificados y cuya ventana contiene
 * `t`, el que más recientemente ha empezado (a su hora estándar); si ninguno ha
 * empezado aún, el que antes empieza.
 *
 * `planDe(fecha)` devuelve los turnos ('dia', 'noche') que tiene esa fecha.
 */
function etiquetaPlan(t, planDe) {
  const { fecha, hora } = enMadrid(t);
  const ayer = sumarDias(fecha, -1);
  const hoyP = planDe(fecha), ayerP = planDe(ayer);
  const cands = [];
  if (hoyP.has('dia')) cands.push({ fecha, turno: 'dia' });
  if (hoyP.has('noche') && hora >= INICIO.noche) cands.push({ fecha, turno: 'noche' });
  if (ayerP.has('noche') && hora < INICIO.noche) cands.push({ fecha: ayer, turno: 'noche' });
  if (!cands.length) return null;
  cands.forEach(c => { c.entra = instante(c.fecha, ENTRA[c.turno]); });
  const empezados = cands.filter(c => c.entra <= t).sort((a, b) => b.entra - a.entra);
  const porEmpezar = cands.filter(c => c.entra > t).sort((a, b) => a.entra - b.entra);
  const c = empezados[0] || porEmpezar[0];
  return { fecha: c.fecha, turno: c.turno, nn: false };
}

/** El turno de una sesión SIN PLAN que empieza en `t`: antes de las 12:00, día. */
function etiquetaNN(t) {
  const { fecha, hora } = enMadrid(t);
  return { fecha, turno: hora < CORTE_NN ? 'dia' : 'noche', nn: true };
}

/**
 * Los instantes en que la etiqueta planificada puede cambiar entre `ini` y
 * `fin`: los bordes de las ventanas (00:00 y 12:00) y las horas de entrar
 * (05:00 y 17:00).
 */
function cortes(ini, fin) {
  const out = [];
  let f = sumarDias(enMadrid(ini).fecha, -1);
  const ultima = enMadrid(fin).fecha;
  while (f <= ultima) {
    [INICIO.dia, ENTRA.dia, INICIO.noche, ENTRA.noche].forEach(h => {
      const x = instante(f, h);
      if (x > ini && x < fin) out.push(x);
    });
    f = sumarDias(f, 1);
  }
  return out.sort((a, b) => a - b);
}

/**
 * EL REPARTO. Puro: no lee nada, solo cuenta.
 *
 *   intervalos  [{ persona, situacion ('viaje'|'espera'), ini, fin }] en ms.
 *               `persona` es la clave de quien trabajó (su conductor_id, o su
 *               cuenta si no tiene ficha): las sesiones se arman por persona,
 *               juntando todas sus cuentas de BOLT.
 *   planDe      (persona, fecha) → Set de turnos planificados ese día. Para un
 *               NN, un Set vacío.
 *
 * Devuelve:
 *   porClave    Map('fecha|turno' → { viajeSeg, esperaSeg, personas: Set,
 *               nnSeg, nnPersonas: Set })
 *   porPersona  Map(persona → Map('fecha|turno' → { seg, nn }))
 */
function repartir(intervalos, planDe) {
  const porPersona = new Map();
  intervalos.forEach(iv => {
    if (!(iv.fin > iv.ini)) return;
    if (!porPersona.has(iv.persona)) porPersona.set(iv.persona, []);
    porPersona.get(iv.persona).push(iv);
  });

  const porClave = new Map();
  const resultado = new Map();
  const suma = (persona, et, situacion, seg) => {
    if (seg <= 0) return;
    const k = clave(et.fecha, et.turno);
    if (!porClave.has(k)) porClave.set(k, { viajeSeg: 0, esperaSeg: 0, personas: new Set(), nnSeg: 0, nnPersonas: new Set() });
    const c = porClave.get(k);
    if (situacion === 'viaje') c.viajeSeg += seg; else c.esperaSeg += seg;
    c.personas.add(persona);
    if (et.nn) { c.nnSeg += seg; c.nnPersonas.add(persona); }
    if (!resultado.has(persona)) resultado.set(persona, new Map());
    const r = resultado.get(persona);
    if (!r.has(k)) r.set(k, { seg: 0, nn: et.nn });
    r.get(k).seg += seg;
  };

  porPersona.forEach((todos, persona) => {
    const plan = f => planDe(persona, f);
    todos.sort((a, b) => a.ini - b.ini);
    // CADA SEGUNDO DE UNA PERSONA, UNA VEZ. Dos cuentas suyas que se pisan, o
    // dos tramos del mismo rato, no hacen el doble de horas: el primero se queda
    // el rato y del siguiente cuenta solo lo que sobra. Es lo que hacían ya la
    // Bitácora y el Reporte de horas («los solapes se funden»).
    const ivs = [];
    let hastaYa = -Infinity;
    todos.forEach(iv => {
      const ini = Math.max(iv.ini, hastaYa);
      if (iv.fin > ini) ivs.push({ ...iv, ini });
      if (iv.fin > hastaYa) hastaYa = iv.fin;
    });

    // 1. LO PLANIFICADO. Cada tramo se parte por los cortes del reloj y cada
    //    trozo va al turno planificado que le toca; lo que no cae en ninguno se
    //    guarda para el paso 2.
    const sueltos = [];
    ivs.forEach(iv => {
      const bordes = [iv.ini, ...cortes(iv.ini, iv.fin), iv.fin];
      for (let i = 0; i + 1 < bordes.length; i++) {
        const a = bordes[i], b = bordes[i + 1];
        const et = etiquetaPlan((a + b) / 2, plan);
        if (et) suma(persona, et, iv.situacion, (b - a) / 1000);
        else sueltos.push({ ini: a, fin: b, situacion: iv.situacion });
      }
    });

    // 2. LO QUE NO TIENE TURNO PLANIFICADO, POR SESIONES. Se corta cuando pasa
    //    el hueco sin trabajar, y cada sesión es del turno de su hora de inicio.
    const sesiones = [];
    let cur = null;
    sueltos.sort((a, b) => a.ini - b.ini).forEach(iv => {
      if (!cur || iv.ini - cur.fin >= HUECO_SESION_MS) { cur = { ini: iv.ini, fin: iv.fin, piezas: [] }; sesiones.push(cur); }
      cur.piezas.push(iv);
      if (iv.fin > cur.fin) cur.fin = iv.fin;
    });
    sesiones.forEach(s => {
      // Si la sesión se sale de la ventana de su turno, lo que sobra se vuelve
      // a repartir desde el borde, como si empezara ahí.
      const tramos = [];
      let desde = s.ini;
      while (desde < s.fin) {
        const et = etiquetaNN(desde);
        const fin = ventanaDe(et.fecha, et.turno)[1];
        tramos.push({ desde, hasta: Math.min(fin, s.fin), et });
        desde = fin;
      }
      s.piezas.forEach(iv => tramos.forEach(tr => {
        const a = Math.max(iv.ini, tr.desde), b = Math.min(iv.fin, tr.hasta);
        if (b > a) suma(persona, tr.et, iv.situacion, (b - a) / 1000);
      }));
    });
  });
  return { porClave, porPersona: resultado };
}

// ── Lo que se lee de la base ────────────────────────────────────────────────

/**
 * Los tramos de trabajo (viaje y espera) que tocan [ini, fin), recortados a
 * ella y a ahora. De Flota Viva.
 */
async function intervalosEfectivos(iniMs, finMs) {
  const fv = require('./db');
  if (!fv.HAY_BD) return [];
  await fv.preparar();
  const r = await fv.consulta(
    `SELECT t.conductor_uuid AS uuid, t.situacion,
            GREATEST(t.desde, $1::timestamptz)                   AS ini,
            LEAST(COALESCE(t.hasta, now()), $2::timestamptz)      AS fin
       FROM fv_tramo t
       JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.efectivo
      -- Sin COALESCE sobre la columna, para que el índice sirva (ver rutas.js).
      WHERE t.desde < $2::timestamptz
        AND (t.hasta > $1::timestamptz OR (t.hasta IS NULL AND now() > $1::timestamptz))
        AND t.desde >= $1::timestamptz - interval '14 days'`,
    [new Date(iniMs).toISOString(), new Date(finMs).toISOString()]);
  return r.rows.map(x => ({
    uuid: x.uuid || null, situacion: x.situacion,
    ini: new Date(x.ini).getTime(), fin: new Date(x.fin).getTime(),
  }));
}

/**
 * EL REPARTO DE UNAS FECHAS, LEÍDO DE LA BASE: los tramos de trabajo, de quién
 * es cada cuenta ese día (con las prestadas) y el plan de `f_cobertura`.
 *
 * Las personas son 'c<conductor_id>' o, sin ficha, 'u<uuid de BOLT>'.
 *
 * Devuelve { porClave, porPersona } como `repartir`, con las claves de las
 * fechas pedidas (y alguna vecina, que se ignora).
 */
async function cargar(fechas) {
  const lista = [...new Set(fechas.map(f => String(f).slice(0, 10)))].sort();
  if (!lista.length) return { porClave: new Map(), porPersona: new Map() };
  const db = require('../db');
  const desdeF = sumarDias(lista[0], -1), hastaF = sumarDias(lista[lista.length - 1], 1);
  // Desde el mediodía de la víspera: una sesión que empezó la tarde anterior y
  // sigue de madrugada tiene que saberse que empezó allí.
  const iniMs = instante(desdeF, INICIO.noche);
  const finMs = Math.min(Date.now(), instante(hastaF, INICIO.noche));

  const [ivs, cuentas, prestadas, plan] = await Promise.all([
    intervalosEfectivos(iniMs, finMs),
    db.HAY_BD ? db.consulta(
      `SELECT externo_id, conductor_id FROM conductor_externo
        WHERE sistema = 'bolt' AND conductor_id IS NOT NULL AND externo_id IS NOT NULL`) : { rows: [] },
    // Las cuentas PRESTADAS: mientras dura el préstamo, lo que hace esa cuenta
    // es de quien la lleva, igual que en Control.
    db.HAY_BD ? db.consulta(
      `SELECT ce.externo_id, f.conductor_id, to_char(f.desde, 'YYYY-MM-DD') AS desde,
              to_char(f.hasta, 'YYYY-MM-DD') AS hasta
         FROM cuenta_fantasma f
         JOIN conductor_externo ce ON ce.id = f.cuenta_id
        WHERE f.anulado_at IS NULL AND ce.externo_id IS NOT NULL
          AND f.desde <= $2::date AND (f.hasta IS NULL OR f.hasta >= $1::date)`, [desdeF, hastaF])
      .catch(() => ({ rows: [] })) : { rows: [] },
    // EL PLAN: la misma regla que pinta el planificador y que lee Control.
    db.HAY_BD ? db.consulta(
      `SELECT DISTINCT to_char(c.dia, 'YYYY-MM-DD') AS dia, c.conductor_id, t.codigo AS turno
         FROM f_cobertura($1::date, $2::date, TRUE) c
         JOIN turno t ON t.id = c.turno_id
        WHERE t.codigo IN ('dia', 'noche')`, [desdeF, hastaF]) : { rows: [] },
  ]);

  const deCuenta = new Map(cuentas.rows.map(x => [String(x.externo_id), 'c' + x.conductor_id]));
  const prestamos = new Map();
  prestadas.rows.forEach(x => {
    const k = String(x.externo_id);
    if (!prestamos.has(k)) prestamos.set(k, []);
    prestamos.get(k).push(x);
  });
  const personaDe = (uuid, ms) => {
    if (!uuid) return 'sin-conductor';
    const fecha = enMadrid(ms).fecha;
    const p = (prestamos.get(uuid) || []).find(x => x.desde <= fecha && (!x.hasta || x.hasta >= fecha));
    if (p) return 'c' + p.conductor_id;
    return deCuenta.get(uuid) || 'u' + uuid;
  };
  const planes = new Map();
  plan.rows.forEach(x => {
    const k = 'c' + x.conductor_id;
    if (!planes.has(k)) planes.set(k, new Map());
    const m = planes.get(k);
    if (!m.has(x.dia)) m.set(x.dia, new Set());
    m.get(x.dia).add(x.turno);
  });
  const VACIO = new Set();
  const planDe = (persona, fecha) => ((planes.get(persona) || new Map()).get(fecha)) || VACIO;

  return repartir(ivs.map(iv => ({ ...iv, persona: personaDe(iv.uuid, iv.ini) })), planDe);
}

/**
 * Las HORAS DE CADA TURNO de unas fechas, con la gente de cada turno. Es lo que
 * pintan las tarjetas «Turno día» y «Turno noche» de Visibilidad.
 *
 * Devuelve Map('fecha|turno' → { viajeSeg, esperaSeg, personas: Set, nnSeg,
 * nnPersonas: Set }) para las fechas pedidas.
 */
async function porTurno(fechas) {
  const { porClave } = await cargar(fechas);
  const out = new Map();
  [...new Set(fechas.map(f => String(f).slice(0, 10)))].forEach(f => ['dia', 'noche'].forEach(t => {
    const k = clave(f, t);
    out.set(k, porClave.get(k) || { viajeSeg: 0, esperaSeg: 0, personas: new Set(), nnSeg: 0, nnPersonas: new Set() });
  }));
  return out;
}

/**
 * Las horas de CADA PERSONA en el día y en la noche de unas fechas. Es lo que
 * usan los reportes y la Bitácora: la «jornada» de una persona el día D es su
 * turno de día de D más su turno de noche de D.
 *
 * Devuelve Map(persona → Map(fecha → { dia, noche, nnDia, nnNoche })), con los
 * segundos de cada turno y si fueron sin plan (NN).
 */
async function porPersonaYDia(fechas) {
  const lista = [...new Set(fechas.map(f => String(f).slice(0, 10)))];
  const quiero = new Set(lista);
  const { porPersona } = await cargar(lista);
  const out = new Map();
  porPersona.forEach((claves, persona) => claves.forEach((v, k) => {
    const [fecha, turno] = k.split('|');
    if (!quiero.has(fecha) || !(v.seg > 0)) return;
    if (!out.has(persona)) out.set(persona, new Map());
    const m = out.get(persona);
    if (!m.has(fecha)) m.set(fecha, { dia: 0, noche: 0, nnDia: false, nnNoche: false });
    const x = m.get(fecha);
    x[turno] += v.seg;
    if (v.nn) x[turno === 'dia' ? 'nnDia' : 'nnNoche'] = true;
  }));
  return out;
}

/**
 * CUÁNDO SE CIERRA DEL TODO UN DÍA: cuando acaba la ventana de su noche, a las
 * 12:00 del día siguiente. Antes de eso sus horas aún pueden crecer.
 */
const cierreDe = fecha => instante(sumarDias(fecha, 1), INICIO.noche);

// DESDE CUÁNDO MANDA ESTA REGLA EN LO QUE SE GUARDA (Camilo, 06/10/2026: «a
// partir de ahora»). Lo sellado antes con la jornada de 05:00 a 05:00 no se
// reescribe: la Bitácora no vuelve a sellar días anteriores a esta fecha.
const DESDE = '2026-10-06';

module.exports = {
  repartir, etiquetaNN, porTurno, porPersonaYDia, intervalosEfectivos,
  instante, sumarDias, clave, cierreDe, INICIO, ENTRA, DESDE,
};
