// ============================================================
// EL INFORME DE JORNADA PARA EL SMAC — la cuenta (módulo 5, 25/11/2026) — puro
// ============================================================
// Módulo 5 del plan de RR. HH. y nóminas: «En las reclamaciones ante el SMAC
// casi siempre se piden las horas de los conductores. Por conductor y rango de
// fechas, con un clic desde su ficha, el ERP genera en PDF y Excel un
// consolidado para legal y los abogados». Lo decidido en el chat (25/11/2026):
//
//   · ESTRICTO DEL CONVENIO (art. 18.6 y 18.7), como el motor de /convenio:
//       - viaje (has_order) ............ trabajo efectivo (TE_A3)
//       - espera dentro del área ....... trabajo efectivo (TE_A1)
//       - espera fuera del área ........ NO es trabajo efectivo (TE_NO): es la
//                                        «espera no efectiva» del encargo
//       - tareas auxiliares ............ 20 min el día que hubo actividad (TE_C)
//       - descanso (busy) .............. no es trabajo; aparte
//     PRESENCIA = efectivo + espera no efectiva: el tiempo conectado y
//     disponible para la plataforma (= el «tiempo de conexión» del informe de
//     BOLT). El descanso no es presencia. El área son las zonas de Mapon.
//   · DÍA NATURAL 00→24 de Madrid: lo que cruza la medianoche se parte.
//   · Desde el 01/07/2026: lo que el ERP guarda tramo a tramo (Flota viva).
//
// Si dos tramos de la misma persona se pisan (dos cuentas a la vez), cada
// segundo cuenta una vez, con el estado que más trabaja (viaje > espera >
// descanso).
'use strict';

const calendario = require('../../services/calendario');

const AUX_MIN = 20;              // art. 18.6.c
const HUECO_SESION_S = 60;       // dos tramos separados por menos de esto son la misma conexión
const CATEGORIAS = ['viaje', 'esperaArea', 'esperaFuera', 'descanso'];

/** El instante (ms) de las 00:00 de Madrid de un día 'aaaa-mm-dd'. */
function medianoche(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  for (const horas of [1, 2, 0]) {
    const t = Date.UTC(y, m - 1, d) - horas * 3600000;
    const p = calendario.partesMadrid(new Date(t));
    if (p.fecha === iso && p.min === 0) return t;
  }
  throw new Error(`No sé cuándo empieza el ${iso} en Madrid`);
}

/** Resta a [a, b) lo ya cubierto (intervalos ordenados y sin solape). → trozos libres */
function libres(a, b, cubiertos) {
  const out = [];
  let x = a;
  for (const [c0, c1] of cubiertos) {
    if (c1 <= x) continue;
    if (c0 >= b) break;
    if (c0 > x) out.push([x, Math.min(c0, b)]);
    x = Math.max(x, c1);
    if (x >= b) break;
  }
  if (x < b) out.push([x, b]);
  return out;
}

/** Junta intervalos ordenables en una lista ordenada y sin solape. */
function fundir(lista, hueco = 0) {
  const ord = [...lista].sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of ord) {
    const u = out[out.length - 1];
    if (u && a <= u[1] + hueco) u[1] = Math.max(u[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** La categoría de un tramo. `otro` (sin clasificar en BOLT) va con el descanso: no cuenta como trabajo. */
function categoria(t) {
  if (t.situacion === 'viaje') return 'viaje';
  if (t.situacion === 'espera') return t.enArea ? 'esperaArea' : 'esperaFuera';
  if (t.situacion === 'descanso' || t.situacion === 'otro') return 'descanso';
  return null;   // desconectado: fuera
}

const vacio = () => ({ viaje: 0, esperaArea: 0, esperaFuera: 0, descanso: 0 });

/** Los totales de un grupo de segundos: efectivo, auxiliares y presencia (todo en segundos). */
function cerrar(s, aux) {
  const efectivo = s.viaje + s.esperaArea;
  return { ...s, efectivo, aux, efectivoConAux: efectivo + aux, presencia: efectivo + s.esperaFuera };
}

/**
 * LA CUENTA. `tramos`: [{ situacion, desdeMs, hastaMs, enArea }] de la persona
 * (todas sus cuentas de BOLT). `desde` y `hasta`: días 'aaaa-mm-dd', ambos
 * incluidos. Devuelve { dias, semanas, meses, sesiones, totales } en segundos.
 */
function calcular({ tramos, desde, hasta }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < desde) throw new Error('El rango de fechas no es válido');
  const ini = medianoche(desde), fin = medianoche(calendario.sumarDias(hasta, 1));

  // 1. Cada segundo una vez, con el estado que más trabaja.
  const trozos = [];
  let cubiertos = [];
  for (const cat of CATEGORIAS) {
    const nuevos = [];
    for (const t of tramos || []) {
      if (categoria(t) !== cat) continue;
      const a = Math.max(ini, Number(t.desdeMs)), b = Math.min(fin, Number(t.hastaMs));
      if (!(b > a)) continue;
      for (const [x, y] of libres(a, b, cubiertos)) nuevos.push([x, y]);
    }
    const fusion = fundir(nuevos);
    fusion.forEach(([x, y]) => trozos.push({ cat, a: x, b: y }));
    cubiertos = fundir([...cubiertos, ...fusion]);
  }

  // 2. Por día natural de Madrid (lo que cruza la medianoche se parte).
  const dias = [];
  for (let d = desde; d <= hasta; d = calendario.sumarDias(d, 1)) {
    const d0 = medianoche(d), d1 = medianoche(calendario.sumarDias(d, 1));
    const s = vacio();
    for (const t of trozos) {
      const a = Math.max(d0, t.a), b = Math.min(d1, t.b);
      if (b > a) s[t.cat] += (b - a) / 1000;
    }
    const actividad = s.viaje + s.esperaArea + s.esperaFuera > 0;
    const fila = cerrar(s, actividad ? AUX_MIN * 60 : 0);
    // Primera conexión y última desconexión del día (lo que cae en el día).
    const enDia = trozos.filter(t => t.b > d0 && t.a < d1);
    fila.primera = enDia.length ? Math.max(d0, Math.min(...enDia.map(t => t.a))) : null;
    fila.ultima = enDia.length ? Math.min(d1, Math.max(...enDia.map(t => t.b))) : null;
    dias.push({ dia: d, ...fila });
  }

  // 3. Semanas (de lunes a domingo) y meses, sumando los días.
  const sumar = (grupo, clave) => {
    const m = new Map();
    for (const f of dias) {
      const k = clave(f.dia);
      if (!m.has(k)) m.set(k, { clave: k, desde: f.dia, hasta: f.dia, ...vacio(), aux: 0, dias: 0 });
      const g = m.get(k);
      CATEGORIAS.forEach(c => { g[c] += f[c]; });
      g.aux += f.aux; g.hasta = f.dia;
      if (f.presencia + f.descanso > 0) g.dias++;
    }
    return [...m.values()].map(g => ({ ...g, ...cerrar(Object.fromEntries(CATEGORIAS.map(c => [c, g[c]])), g.aux) }));
  };
  const lunes = iso => calendario.sumarDias(iso, 1 - calendario.diaSemana(iso));
  const semanas = sumar('semana', lunes);
  const meses = sumar('mes', iso => iso.slice(0, 7));

  // 4. Las conexiones: cada rato conectado seguido (con o sin descanso dentro).
  const sesiones = fundir(trozos.map(t => [t.a, t.b]), HUECO_SESION_S * 1000).map(([a, b]) => {
    const s = vacio();
    trozos.forEach(t => { const x = Math.max(a, t.a), y = Math.min(b, t.b); if (y > x) s[t.cat] += (y - x) / 1000; });
    return { conexion: a, desconexion: b, duracion: (b - a) / 1000, ...s };
  });

  const tot = vacio();
  dias.forEach(f => CATEGORIAS.forEach(c => { tot[c] += f[c]; }));
  const totales = { ...cerrar(tot, dias.reduce((x, f) => x + f.aux, 0)), diasConActividad: dias.filter(f => f.presencia > 0).length };
  return { desde, hasta, dias, semanas, meses, sesiones, totales };
}

/** Segundos → «7 h 05 min». */
function hm(seg) {
  const m = Math.round((Number(seg) || 0) / 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Segundos → horas en decimal, con dos decimales (para el Excel). */
const horas = seg => Math.round(((Number(seg) || 0) / 3600) * 100) / 100;

module.exports = { calcular, medianoche, hm, horas, AUX_MIN, CATEGORIAS, _libres: libres, _fundir: fundir };
