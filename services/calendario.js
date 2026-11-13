// ============================================================
// CALENDARIO LABORAL — días y horas hábiles, una sola cuenta para todo el ERP
// ============================================================
// Hoja de ruta de Ignacio, convención 3: «Días y horas hábiles los calcula el
// sistema. Calendario laboral de Madrid y de Barcelona, con festivos
// configurables. Hora hábil = dentro del horario de oficina configurado. Ningún
// plazo se calcula a mano». Pieza A2 de docs/Hoja de ruta.md (13/11/2026).
//
// Uso:
//   const calendario = require('../../services/calendario');
//   const cal = await calendario.de('madrid');
//   cal.sumarDiasHabiles('2026-12-03', 5)        // '2026-12-14' (salta el puente)
//   cal.sumarHorasHabiles(new Date(), 5)        // el instante en que vencen 5 h hábiles
//   cal.semaforo(plazo, calendario.hoy())       // 'verde' | 'amarillo' | 'rojo'
//
// DE DÓNDE SALE:
//   · los festivos: los nacionales de `festivo` (db/197) para todas las sedes,
//     los de la Comunidad de Madrid para Madrid, y los de la oficina de cada sede
//     (`festivo_oficina`, db/244: San Isidro y la Almudena);
//   · el horario: el parámetro `oficina.<sede>.horario` (db/243), de lunes a
//     viernes de 09:00 a 18:00 en Madrid (Camilo, 13/11/2026).
// Barcelona llegará cuando un ítem lo pida: la tabla ya lleva la sede.
//
// LAS CUENTAS:
//   · Un plazo de N días hábiles DESDE un día cuenta a partir del siguiente (el
//     día de partida no cuenta) y vence al acabar el N-ésimo hábil.
//   · Las horas hábiles corren solo dentro del horario de un día hábil. Lo que
//     empieza fuera (un sábado, a las 20:00) empieza a contar al abrir.
//   · Todo en hora de Madrid, con su cambio de hora. Las fechas van como texto
//     'aaaa-mm-dd' y NUNCA pasan por toISOString con una fecha local (ver
//     Trampas conocidas, «Fechas sin toISOString»).
//
// El núcleo son funciones PURAS sobre un calendario (`crear`): se prueban sin
// base. `de(sede)` lo monta con lo de la base, con caché de diez minutos.
'use strict';

const db = require('./db');
const parametros = require('./parametros');

const ZONA = 'Europe/Madrid';
const TOPE_DIAS = 3700;   // diez años: ninguna cuenta legítima llega; un bucle roto sí

// ── Fechas como texto 'aaaa-mm-dd' ─────────────────────────────────────────
const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function comprobarFecha(iso) {
  const m = RE_FECHA.exec(String(iso || ''));
  if (!m) throw new Error(`Fecha no válida: «${iso}» (va como aaaa-mm-dd)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Suma días naturales a una fecha. Cuenta en UTC a propósito: es aritmética de calendario, sin horas. */
function sumarDias(iso, n) {
  const [y, m, d] = comprobarFecha(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 1 = lunes … 7 = domingo. */
function diaSemana(iso) {
  const [y, m, d] = comprobarFecha(iso);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

// ── Instantes en hora de Madrid ────────────────────────────────────────────
const FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Lo que marca un reloj de Madrid en ese instante: { fecha, min } (min = minutos desde las 00:00, con fracción). */
function partesMadrid(instante) {
  const t = instante instanceof Date ? instante : new Date(instante);
  const p = Object.fromEntries(FMT.formatToParts(t).map(x => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    min: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60,
  };
}

/** El día de hoy en Madrid, 'aaaa-mm-dd'. Una sola fuente del «hoy» para el código nuevo. */
function hoy(ahora = new Date()) {
  return partesMadrid(ahora).fecha;
}

/** El instante en que un reloj de Madrid marca `minutos` (desde las 00:00) del día `iso`. */
function instante(iso, minutos) {
  const [y, m, d] = comprobarFecha(iso);
  const h = Math.floor(minutos / 60), mi = minutos - h * 60;
  const comoUtc = Date.UTC(y, m - 1, d, h, 0, 0) + mi * 60000;
  // El desfase de Madrid ese día (+1 o +2): dos vueltas bastan para caer bien
  // también cerca del cambio de hora (que es de madrugada, fuera del horario).
  let t = comoUtc;
  for (let i = 0; i < 2; i++) {
    const p = partesMadrid(new Date(t));
    const [py, pm, pd] = comprobarFecha(p.fecha);
    const reloj = Date.UTC(py, pm - 1, pd) + p.min * 60000;
    t = comoUtc - (reloj - t);
  }
  return new Date(Math.round(t));
}

const aMinutos = hhmm => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

// ── El calendario ──────────────────────────────────────────────────────────
/**
 * Un calendario con sus festivos ('aaaa-mm-dd') y su horario
 * ({ dias: [1..7], desde: 'HH:MM', hasta: 'HH:MM' }). `anos`: los años que
 * tienen sus festivos cargados; fuera de ellos se avisa en el log una vez.
 */
function crear({ festivos = [], horario, anos = null, sede = '' } = {}) {
  if (!horario || !Array.isArray(horario.dias)) throw new Error('El calendario necesita su horario');
  return {
    sede,
    festivos: new Set(festivos),
    horario: { dias: [...horario.dias], desde: horario.desde, hasta: horario.hasta },
    abre: aMinutos(horario.desde),
    cierra: aMinutos(horario.hasta),
    anos: anos ? new Set(anos.map(Number)) : null,
    avisados: new Set(),
  };
}

function avisarSiFalta(cal, iso) {
  if (!cal.anos) return;
  const a = Number(iso.slice(0, 4));
  if (cal.anos.has(a) || cal.avisados.has(a)) return;
  cal.avisados.add(a);
  console.warn(`⚠️  [CALENDARIO] No hay festivos cargados de ${a}${cal.sede ? ' (' + cal.sede + ')' : ''}: ese año solo cuentan los fines de semana. Cárgalos con una migración.`);
}

/** ¿Es un día hábil? Un día de los del horario que no es festivo. */
function esHabil(cal, iso) {
  comprobarFecha(iso);
  avisarSiFalta(cal, iso);
  return cal.horario.dias.includes(diaSemana(iso)) && !cal.festivos.has(iso);
}

/** El día en que vence un plazo de `n` días hábiles contados desde el día siguiente a `iso`. */
function sumarDiasHabiles(cal, iso, n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('Los días hábiles van en un número entero, cero o más');
  let f = iso, k = 0, vueltas = 0;
  while (k < n) {
    f = sumarDias(f, 1);
    if (esHabil(cal, f)) k++;
    if (++vueltas > TOPE_DIAS) throw new Error('El calendario no tiene días hábiles: revisa el horario');
  }
  return f;
}

/** El día hábil que queda `n` días hábiles antes de `iso` («4 días hábiles antes del corte»). */
function restarDiasHabiles(cal, iso, n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('Los días hábiles van en un número entero, cero o más');
  let f = iso, k = 0, vueltas = 0;
  while (k < n) {
    f = sumarDias(f, -1);
    if (esHabil(cal, f)) k++;
    if (++vueltas > TOPE_DIAS) throw new Error('El calendario no tiene días hábiles: revisa el horario');
  }
  return f;
}

/** El mismo día si es hábil; si no, el hábil anterior («si el 20 no es hábil, el hábil anterior»). */
function habilEnOAntes(cal, iso) {
  let f = iso, vueltas = 0;
  while (!esHabil(cal, f)) {
    f = sumarDias(f, -1);
    if (++vueltas > TOPE_DIAS) throw new Error('El calendario no tiene días hábiles: revisa el horario');
  }
  return f;
}

/** El mismo día si es hábil; si no, el hábil siguiente. */
function habilEnODespues(cal, iso) {
  let f = iso, vueltas = 0;
  while (!esHabil(cal, f)) {
    f = sumarDias(f, 1);
    if (++vueltas > TOPE_DIAS) throw new Error('El calendario no tiene días hábiles: revisa el horario');
  }
  return f;
}

/**
 * Cuántos días hábiles hay después de `desde` y hasta `hasta` (incluido).
 * Negativo si `hasta` es anterior: los que ya han pasado.
 */
function diasHabilesEntre(cal, desde, hasta) {
  comprobarFecha(desde); comprobarFecha(hasta);
  if (hasta === desde) return 0;
  const signo = hasta > desde ? 1 : -1;
  const [a, b] = signo > 0 ? [desde, hasta] : [hasta, desde];
  let f = a, n = 0, vueltas = 0;
  while (f < b) {
    f = sumarDias(f, 1);
    if (esHabil(cal, f)) n++;
    if (++vueltas > TOPE_DIAS) throw new Error('Rango de fechas demasiado largo');
  }
  return signo * n;
}

/**
 * El semáforo de un plazo que vence el día `plazo` (convención del ítem 1):
 * verde mientras queda plazo, amarillo el último día, rojo vencido.
 */
function semaforo(cal, plazo, hoyIso) {
  comprobarFecha(plazo); comprobarFecha(hoyIso);
  if (hoyIso > plazo) return 'rojo';
  if (hoyIso === plazo) return 'amarillo';
  return 'verde';
}

/**
 * El instante en que vencen `horas` hábiles contadas desde `inicio`. Corren solo
 * dentro del horario de los días hábiles; lo que empieza fuera, empieza a contar
 * al abrir la oficina. Con 0 horas, el primer momento hábil.
 */
function sumarHorasHabiles(cal, inicio, horas) {
  const n = Number(horas);
  if (!Number.isFinite(n) || n < 0) throw new Error('Las horas hábiles van en un número, cero o más');
  let quedan = Math.round(n * 60);
  let { fecha, min } = partesMadrid(inicio);
  let vueltas = 0;
  for (;;) {
    if (++vueltas > TOPE_DIAS) throw new Error('El calendario no tiene horas hábiles: revisa el horario');
    if (!esHabil(cal, fecha) || min >= cal.cierra) {
      fecha = sumarDias(fecha, 1);
      min = cal.abre;
      continue;
    }
    if (min < cal.abre) min = cal.abre;
    const caben = cal.cierra - min;
    if (quedan <= caben) return instante(fecha, min + quedan);
    quedan -= caben;
    fecha = sumarDias(fecha, 1);
    min = cal.abre;
  }
}

/** Las funciones del núcleo, atadas a un calendario. */
function atar(cal) {
  return {
    sede: cal.sede,
    horario: { ...cal.horario, dias: [...cal.horario.dias] },
    esHabil: iso => esHabil(cal, iso),
    sumarDiasHabiles: (iso, n) => sumarDiasHabiles(cal, iso, n),
    restarDiasHabiles: (iso, n) => restarDiasHabiles(cal, iso, n),
    habilEnOAntes: iso => habilEnOAntes(cal, iso),
    habilEnODespues: iso => habilEnODespues(cal, iso),
    diasHabilesEntre: (a, b) => diasHabilesEntre(cal, a, b),
    semaforo: (plazo, h = hoy()) => semaforo(cal, plazo, h),
    sumarHorasHabiles: (inicio, horas) => sumarHorasHabiles(cal, inicio, horas),
    tieneFestivosDe: ano => !cal.anos || cal.anos.has(Number(ano)),
  };
}

// ── Lo que viene de la base ────────────────────────────────────────────────
const SEDES = ['madrid'];   // Barcelona, cuando un ítem lo pida (Camilo, 13/11/2026)
const DURA_MS = 10 * 60 * 1000;
let cache = null;   // { at, filas: { festivo: [...], oficina: [...] } }

async function festivosDeLaBase() {
  if (cache && Date.now() - cache.at < DURA_MS) return cache.filas;
  const [f, o] = await Promise.all([
    db.consulta(`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, ambito FROM festivo`),
    db.consulta(`SELECT sede, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM festivo_oficina`),
  ]);
  cache = { at: Date.now(), filas: { festivo: f.rows, oficina: o.rows } };
  return cache.filas;
}

/** Tira la caché de festivos (y la de parámetros la lleva su servicio). */
function invalidar() { cache = null; }

/** El calendario de una sede, montado con sus festivos y su horario de hoy. */
async function de(sede = 'madrid') {
  if (!SEDES.includes(sede)) throw new Error(`Aún no hay calendario laboral de «${sede}»: se monta cuando un ítem lo pida`);
  const [filas, horario] = await Promise.all([festivosDeLaBase(), parametros.valor(`oficina.${sede}.horario`)]);
  const festivos = [
    ...filas.festivo.filter(x => x.ambito === 'nacional' || (x.ambito === 'madrid' && sede === 'madrid')).map(x => x.fecha),
    ...filas.oficina.filter(x => x.sede === sede).map(x => x.fecha),
  ];
  // Un año está «cargado» si tiene sus festivos nacionales.
  const anos = [...new Set(filas.festivo.filter(x => x.ambito === 'nacional').map(x => Number(x.fecha.slice(0, 4))))];
  return atar(crear({ festivos, horario, anos, sede }));
}

module.exports = {
  ZONA, SEDES,
  hoy, partesMadrid, instante, sumarDias, diaSemana,
  crear, atar, esHabil, sumarDiasHabiles, restarDiasHabiles, habilEnOAntes, habilEnODespues,
  diasHabilesEntre, semaforo, sumarHorasHabiles,
  de, invalidar,
};
