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
    tramos.push({ estado: ord[i].estado, desde, hasta, minutos: Math.round((hasta - desde) / 60) });
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

module.exports = {
  tramosDeLogs, catalogoEstados, asientosDeDia, guardarAsientos,
  MAX_TRAMO_MIN, AUX_MIN,
};
