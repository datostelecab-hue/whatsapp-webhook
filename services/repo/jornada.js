// ============================================================
// JORNADA — de los logs de BOLT a asientos de trabajo efectivo
// ============================================================
// La capa de normalizacion del Hito 2. Coge lo que dice BOLT de un conductor en
// un dia -su hilo de cambios de estado- y lo convierte en asientos del ledger,
// cada uno etiquetado con su supuesto del art. 18.6.
//
// LA REGLA NO ESTA AQUI: esta en la base (cat_estado_te). Este codigo solo
// reproduce los tramos y aplica lo que diga la tabla. Cambiar como cuenta la
// espera es un UPDATE alli, no tocar esto.
//
// Dos partes, y la primera es PURA -sin base, testeable a mano-:
//   1. tramosDeLogs: los cambios de estado en tramos con inicio y fin reales.
//   2. asientosDeDia: cada tramo a un asiento, segun la tabla, y el aux diario.

const db = require('../db');

// Tope de un tramo, igual que en el sistema de horas: si BOLT deja de reportar
// sin pasar por 'inactive', ese hueco no es tiempo trabajado. Configurable.
const MAX_TRAMO_MIN = Number(process.env.JORNADA_MAX_TRAMO_MIN) || 720;   // 12 h
// Los 20 min de tareas auxiliares del art. 18.6.c, si hubo actividad ese dia.
const AUX_MIN = 20;

/**
 * Los cambios de estado de un dia en TRAMOS con inicio y fin.
 *
 * Cada log dice "a esta hora pase a este estado". El tramo de un estado va desde
 * su log hasta el siguiente, con la hora REAL del apunte, no la de cuando lo
 * miramos. Un estado que dura mas que el tope se recorta: BOLT cerro la sesion
 * por su cuenta y ese hueco no es trabajo.
 *
 * @param logs [{ t, estado }]  t = epoch en segundos, ordenados o no.
 * @param finDia epoch s del corte del dia, para cerrar el ultimo tramo.
 */
function tramosDeLogs(logs, finDia) {
  const ord = [...(logs || [])].filter(l => l && l.estado && l.t != null)
    .sort((a, b) => a.t - b.t);
  const tramos = [];
  for (let i = 0; i < ord.length; i++) {
    const desde = ord[i].t;
    const siguiente = i + 1 < ord.length ? ord[i + 1].t : finDia;
    let hasta = siguiente;
    // Recorte por el tope: un tramo no puede durar mas que MAX_TRAMO_MIN.
    if (hasta - desde > MAX_TRAMO_MIN * 60) hasta = desde + MAX_TRAMO_MIN * 60;
    if (hasta <= desde) continue;                 // tramo de cero, se descarta
    // `veh` viaja con el tramo: la derivacion lo necesita para preguntar por la
    // zona de ese coche (el area de TE_A1).
    tramos.push({ estado: ord[i].estado, desde, hasta, veh: ord[i].veh,
      minutos: Math.round((hasta - desde) / 60) });
  }
  return tramos;
}

/** La tabla de traduccion estado->supuesto, cacheada por vuelta. */
async function catalogoEstados() {
  const r = await db.consulta('SELECT * FROM cat_estado_te');
  const m = new Map();
  for (const x of r.rows) m.set(x.estado_bolt, x);
  return m;
}

/**
 * Los asientos de trabajo de un dia, a partir de sus tramos.
 *
 * Cada tramo se traduce con la tabla. has_order genera un asiento EFFECTIVE_WORK
 * TE_A3. La espera TAMBIEN genera asiento siempre -para que las horas totales
 * sean has_order + waiting-, pero con supuesto TE_A1 si esta en area o TE_NO si
 * no: TE_NO suma en las totales y no en las estrictas. Y si hubo actividad, se
 * anaden los 20 min auxiliares.
 *
 * `areaConfirmada(tramo)` decide si un tramo condicionado esta dentro del area.
 * Por defecto NULL = no se sabe = no cuenta. Cuando se cruce la zona de Mapon,
 * se pasa una funcion que lo resuelva.
 *
 * Devuelve objetos listos para insertar, NO escribe: quien llama decide cuando.
 */
function asientosDeDia({ tramos, catalogo, conductorId, dia, areaConfirmada = null }) {
  const asientos = [];
  let huboActividad = false;

  for (const tr of tramos) {
    const regla = catalogo.get(tr.estado);
    if (!regla || !regla.cuenta) continue;        // descanso, desconexion: nada
    huboActividad = true;

    let supuesto = regla.supuesto_te;
    if (regla.condicionado) {
      // La espera SIEMPRE genera asiento -para que sume en las horas totales-,
      // pero el supuesto cambia: TE_A1 si esta dentro del area (cuenta tambien
      // en las estrictas), TE_NO si no (solo en las totales). La diferencia
      // entre las dos medidas es justo este TE_NO.
      const dentro = areaConfirmada ? areaConfirmada(tr) : false;
      supuesto = dentro ? regla.supuesto_te : regla.supuesto_sin;
    }

    asientos.push({
      conductorId, dia,
      tipo: regla.tipo, supuestoTe: supuesto, minutos: tr.minutos,
      origen: 'bolt',
      refExterna: `bolt:${conductorId}:${tr.desde}`,   // idempotencia por tramo
    });
  }

  // Tareas auxiliares: 20 min automaticos si hubo algo de actividad ese dia
  // (art. 18.6.c). Un solo asiento diario, no por tramo.
  if (huboActividad) {
    asientos.push({
      conductorId, dia,
      tipo: 'AUX_TASKS', supuestoTe: 'TE_C', minutos: AUX_MIN,
      origen: 'sistema',
      refExterna: `aux:${conductorId}:${dia}`,
    });
  }

  return asientos;
}

/**
 * Escribe los asientos de un dia en el ledger, sin duplicar.
 *
 * Idempotente por (origen, ref_externa): reprocesar el mismo dia no crea nada
 * nuevo. El efecto lo pone el disparador del ledger desde el tipo.
 */
async function guardarAsientos(asientos) {
  let nuevos = 0;
  for (const a of asientos) {
    const r = await db.consulta(
      `INSERT INTO asiento_jornada
         (conductor_id, dia_operativo, tipo, minutos, supuesto_te, origen, ref_externa)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7)
       ON CONFLICT (origen, ref_externa) WHERE anulado_at IS NULL AND ref_externa IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [a.conductorId, a.dia, a.tipo, a.minutos, a.supuestoTe, a.origen, a.refExterna]);
    if (r.rowCount) nuevos++;
  }
  return nuevos;
}

/**
 * Deriva la jornada de un conductor en un dia, LEYENDO DE POSTGRES.
 *
 * Este es el eslabon que cumple la arquitectura: no llama a BOLT. Lee los
 * eventos ya aterrizados en bolt_state_log (via staging), los convierte en
 * asientos y los guarda. Se puede correr las veces que haga falta -es
 * idempotente- y se puede rederivar el pasado sin volver a tocar la API, que
 * era todo el objetivo.
 *
 * `areaConfirmada` es el gancho para la zona de Mapon: cuando se cruce, decide
 * si un tramo de espera estaba dentro del area (TE_A1) o no (TE_NO).
 */
async function derivarDia(conductorId, dia, { areaConfirmada = null } = {}) {
  const staging = require('./staging');
  const [logs, catalogo] = await Promise.all([
    staging.logsDeConductorDia(conductorId, dia),
    catalogoEstados(),
  ]);
  if (!logs.length) return { conductorId, dia, tramos: 0, asientos: 0, nuevos: 0 };

  // El corte del dia en epoch, para cerrar el ultimo tramo.
  const finDia = Math.floor(new Date(dia + 'T00:00:00Z').getTime() / 1000) + 86400;
  const tramos = tramosDeLogs(logs, finDia);

  // EL AREA SE RESUELVE ANTES, no dentro del bucle: preguntar a la base por cada
  // tramo condicionado (la espera) y guardar la respuesta. asientosDeDia sigue
  // siendo puro y sincrono. Si el que llama pasa su propia areaConfirmada
  // -en una prueba, por ejemplo-, esa manda.
  let gate = areaConfirmada;
  if (!gate) {
    const dentro = new Map();
    for (const tr of tramos) {
      const regla = catalogo.get(tr.estado);
      if (regla && regla.condicionado && tr.veh) {
        dentro.set(tr.desde, await staging.enArea(tr.veh, tr.desde));
      }
    }
    gate = tr => dentro.get(tr.desde) === true;
  }

  const asientos = asientosDeDia({ tramos, catalogo, conductorId, dia, areaConfirmada: gate });
  const nuevos = await guardarAsientos(asientos);

  // El registro del art. 18.9 sale de la misma pasada. Asi el registro y el
  // ledger no se contradicen: son la misma verdad.
  await guardarRegistro(resumenDelDia({ tramos, catalogo, asientos, conductorId, dia, gate }));

  return { conductorId, dia, tramos: tramos.length, asientos: asientos.length, nuevos };
}

/**
 * El resumen diario del registro de jornada (art. 18.9), a partir de los tramos.
 *
 * Inicio, fin, efectivo (estricto y total), descanso y auxiliares. El nocturno
 * lo rellena el Hito 8. Los tramos van tal cual para el desglose del PDF.
 */
function resumenDelDia({ tramos, catalogo, asientos, conductorId, dia, gate }) {
  const inicio = tramos.length ? Math.min(...tramos.map(t => t.desde)) : null;
  const fin = tramos.length ? Math.max(...tramos.map(t => t.hasta)) : null;

  // El efectivo sale de los asientos, que ya aplicaron la regla del area.
  const trabajo = asientos.filter(a => a.tipo === 'EFFECTIVE_WORK');
  const total = trabajo.reduce((s, a) => s + a.minutos, 0);
  const estricto = trabajo.filter(a => a.supuestoTe !== 'TE_NO').reduce((s, a) => s + a.minutos, 0);
  const aux = asientos.filter(a => a.tipo === 'AUX_TASKS').reduce((s, a) => s + a.minutos, 0);

  // El descanso es el tiempo en 'busy'.
  const descanso = tramos
    .filter(t => { const r = catalogo.get(t.estado); return r && !r.cuenta && t.estado === 'busy'; })
    .reduce((s, t) => s + t.minutos, 0);

  // Minutos nocturnos (22:00-06:00, art. 25.g) del tiempo trabajado. El importe
  // es [VL-1], pero los minutos son un hecho y se cuentan aqui.
  const nocturno = tramos
    .filter(t => { const r = catalogo.get(t.estado); return r && r.cuenta; })
    .reduce((s, t) => s + minutosNocturnos(t.desde, t.hasta), 0);

  // Los tramos para el PDF: estado, supuesto (si cuenta) y minutos.
  const detalle = tramos.map(t => {
    const r = catalogo.get(t.estado);
    let sup = null;
    if (r && r.cuenta) sup = (r.condicionado && gate && !gate(t)) ? r.supuesto_sin : r.supuesto_te;
    return { estado: t.estado, supuesto: sup, desde: t.desde, hasta: t.hasta, min: t.minutos };
  });

  return {
    conductorId, dia,
    inicio, fin,
    efectivoEstricto: estricto, efectivoTotal: total,
    descanso, aux, nocturno, tramos: detalle,
  };
}

// ── Minutos en la franja nocturna (22:00-06:00) ─────────────────────────────
// Analitico, sin recorrer minuto a minuto. La franja nocturna vale 480 min por
// dia (120 de 22:00-24:00 + 360 de 00:00-06:00). Se cuenta cuanto de un tramo
// cae ahi, en hora local de Madrid.
const NOCHE_INI = 22 * 60;    // 1320
const NOCHE_FIN = 6 * 60;     // 360

/** El desfase de Madrid (segundos) en un instante, con su horario de verano. */
function offsetMadrid(epochSeg) {
  const ms = epochSeg * 1000;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {});
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((comoUTC - ms) / 1000);
}

/** Minutos nocturnos acumulados en [0, m) de un reloj local en minutos. */
function nocturnoHasta(m) {
  const dias = Math.floor(m / 1440) * 480;
  const resto = ((m % 1440) + 1440) % 1440;
  return dias + Math.min(resto, NOCHE_FIN) + Math.max(0, resto - NOCHE_INI);
}

/** Cuantos minutos de un tramo [desde, hasta] (epoch s) caen en la franja nocturna. */
function minutosNocturnos(desdeSeg, hastaSeg) {
  const off = offsetMadrid(desdeSeg);        // el offset del arranque; constante salvo el dia del cambio de hora
  const a = Math.floor((desdeSeg + off) / 60);
  const b = Math.floor((hastaSeg + off) / 60);
  return Math.max(0, nocturnoHasta(b) - nocturnoHasta(a));
}

/** Escribe (o rehace) el registro de un dia. Idempotente por (conductor, dia). */
async function guardarRegistro(r) {
  await db.consulta(
    `INSERT INTO registro_jornada
       (conductor_id, dia, inicio, fin, efectivo_estricto_min, efectivo_total_min,
        descanso_min, aux_min, nocturno_min, tramos, generado_at)
     VALUES ($1, $2::date,
             CASE WHEN $3 > 0 THEN to_timestamp($3) END,
             CASE WHEN $4 > 0 THEN to_timestamp($4) END,
             $5, $6, $7, $8, $9, $10::jsonb, now())
     ON CONFLICT (conductor_id, dia) DO UPDATE SET
       inicio = EXCLUDED.inicio, fin = EXCLUDED.fin,
       efectivo_estricto_min = EXCLUDED.efectivo_estricto_min,
       efectivo_total_min = EXCLUDED.efectivo_total_min,
       descanso_min = EXCLUDED.descanso_min, aux_min = EXCLUDED.aux_min,
       nocturno_min = EXCLUDED.nocturno_min,
       tramos = EXCLUDED.tramos, generado_at = now()
     -- Un registro congelado NO se rehace: es el del cierre.
     WHERE registro_jornada.congelado_at IS NULL`,
    [r.conductorId, r.dia, r.inicio || 0, r.fin || 0,
     r.efectivoEstricto, r.efectivoTotal, r.descanso, r.aux, r.nocturno || 0,
     JSON.stringify(r.tramos)]);
}

/** Deriva la jornada de TODOS los conductores con eventos ese dia. */
async function derivarTodos(dia, opciones = {}) {
  const staging = require('./staging');
  const ids = await staging.conductoresConLogs(dia);
  let asientos = 0, nuevos = 0;
  for (const id of ids) {
    const r = await derivarDia(id, dia, opciones);
    asientos += r.asientos; nuevos += r.nuevos;
  }
  return { dia, conductores: ids.length, asientos, nuevos };
}

module.exports = {
  tramosDeLogs, catalogoEstados, asientosDeDia, guardarAsientos,
  derivarDia, derivarTodos, resumenDelDia, guardarRegistro, minutosNocturnos,
  MAX_TRAMO_MIN, AUX_MIN,
};
