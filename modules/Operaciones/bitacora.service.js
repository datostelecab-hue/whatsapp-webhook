// ============================================================
// BITÁCORA · SERVICIO — el calendario de quién trabajó cada día
// ============================================================
// La plantilla entera contra el año entero: qué hizo cada persona cada día,
// cuántas horas, si libró y si hay una J puesta. Nació de una hoja de Excel y
// hoy sale de PostgreSQL.
//
// ── LAS CUATRO COSAS QUE HAY QUE SABER ──────────────────────────────────────
//
// 1. LAS DOS PANTALLAS LEEN EL MISMO `/api/datos`. La del día a día y la
//    general son dos formas de mirar la MISMA rejilla, ya resuelta para toda la
//    plantilla y todos los días. Dos consultas distintas del mismo dato
//    acabarían pintando distinto, y el día que no cuadraran nadie sabría cuál
//    creer.
//
// 2. SE CACHEA TRES MINUTOS, Y SE INVALIDA AL ESCRIBIR. La rejilla se rehace en
//    cada carga y es cara; refrescar la pantalla no puede repetirla entera. Pero
//    al poner una J o una libranza la caché se tira, para que el cambio salga YA
//    y no dentro de tres minutos — que es cuando quien lo hizo ya se ha ido.
//
// 3. LO PASADO ESTÁ SELLADO. `bitacora_horas` guarda el histórico ya calculado,
//    y por eso un mes cerrado sigue diciendo lo mismo mañana. Resellar es la
//    salida para cuando cambia algo que afecta al pasado A PROPÓSITO —se enlaza
//    una cuenta de BOLT que faltaba, se corrige un id mal puesto—, y por eso es
//    del desarrollador: reescribe histórico.
//
// 4. JUSTIFICAR AQUÍ ES CON HORAS EXACTAS, no con las 8 fijas. Va por
//    `conductor_id`, que es lo que trae la vista: el nombre no identifica.

const repo = require('./bitacora.repo');
const justificantes = require('../../services/repo/justificantes');
const llamadas = require('../../services/repo/llamadas');

// Tres minutos: lo bastante para que un refresco no repita la consulta, y lo
// bastante poco para que nadie esté mirando una foto de ayer.
const TTL = 3 * 60 * 1000;

let cache = null, ts = 0;
let cacheVac = null, tsVac = 0;

/** Que la próxima carga muestre lo que se acaba de escribir. Ver la nota 2. */
const olvidar = () => { cache = null; };

/** LA REJILLA. Ver la nota 1: la misma para las dos pantallas. */
async function datos() {
  if (!cache || Date.now() - ts > TTL) { cache = await repo.leerBitacora(); ts = Date.now(); }
  return cache;
}

/** Las vacaciones de la plantilla vigente (disfrutadas + programadas) por meses. */
async function vacaciones() {
  if (!cacheVac || Date.now() - tsVac > TTL) { cacheVac = await repo.leerVacaciones(); tsVac = Date.now(); }
  return cacheVac;
}

/**
 * LAS LLAMADAS DE UN DÍA, con lo que contestó de cada alerta. Va aparte del
 * payload gordo —que se cachea entero para toda la plantilla y 365 días—:
 * esto solo se pide cuando alguien abre UN día de UNA persona.
 */
function llamadasDelDia(conductorId, dia) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) throw new Error('Falta el día');
  return llamadas.delDia(cid, String(dia));
}

/** Justificar un día con HORAS EXACTAS. Escribe el justificante y la 'J'. */
async function justificar({ conductorId, dia, horas, observacion }, usuarioId) {
  const r = await justificantes.guardarPorId({
    conductorId, diaIso: dia,
    horas: (horas == null || horas === '') ? '' : Number(horas),
    observacion, usuarioId,
  });
  olvidar();
  console.log(`📝 [Bitácora] Justificante PG ${dia} · conductor ${r.conductorId}` +
    `${horas ? ` (${horas} h)` : ''}`);
  return r;
}

/** Quitar la J de un día. El registro queda ANULADO, no borrado. */
async function anularJustificante({ conductorId, dia }) {
  const r = await justificantes.anularPorId({ conductorId, diaIso: dia });
  olvidar();
  console.log(`🗑️ [Bitácora] Justificante anulado · conductor ${conductorId} · ${dia}`);
  return r;
}

/**
 * Poner o QUITAR una libranza desde el panel del día. Vive en `bitacora_dia`;
 * el planificador NO se toca — el cuadrante dice lo que estaba planificado, y
 * esto lo que de verdad pasó.
 *
 * Quitar quita las DOS capas: la libranza que puso una persona y la que sale
 * del planificador. Quien pulsa «Quitar la libranza» dice que ese día no
 * libraba; no «quita la de arriba y enséñame la de debajo». Sin horas, el día
 * pasa a «Ausencia», que es lo que es un día de trabajo en que no se salió.
 *
 * La del planificador solo se quita de días que ya han llegado: una libranza
 * futura mal puesta se arregla en el cuadrante, que es de donde sale.
 */
async function libranza({ conductorId, dia, quitar }, usuarioId) {
  if (!quitar) {
    await repo.marcarLibranza(conductorId, dia, usuarioId);
    olvidar();
    console.log(`📓 [Bitácora] Libranza puesta a mano · conductor ${conductorId} · ${dia}`);
    return { msg: 'Marcado como libranza.' };
  }
  // Primero se mira todo y después se escribe: que el error del día futuro no
  // llegue con la libranza puesta a mano ya borrada.
  const delPlan = await repo.libraPorPlan(conductorId, dia);
  if (delPlan && String(dia) > repo.hoyMadridIso()) {
    throw new Error('Ese día todavía no ha llegado: la libranza del planificador se cambia en el planificador.');
  }
  const aMano = await repo.quitarLibranza(conductorId, dia);
  if (delPlan) await repo.quitarLibranzaDelPlan(conductorId, dia, usuarioId);
  if (!aMano && !delPlan) throw new Error('Ese día no tiene ninguna libranza que quitar.');
  olvidar();
  console.log(`📓 [Bitácora] Libranza quitada (${[aMano && 'a mano', delPlan && 'del planificador'].filter(Boolean).join(' y ')})` +
    ` · conductor ${conductorId} · ${dia}`);
  return { msg: delPlan
    ? 'Libranza quitada. Sin horas, ese día cuenta como «Ausencia». El planificador no se ha tocado.'
    : 'Libranza quitada.' };
}

/** REHACER el histórico sellado de un rango. Ver la nota 3. */
async function resellar({ desde, hasta }, quien) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO.test(desde || '') || !ISO.test(hasta || '')) {
    throw new Error('Hacen falta desde y hasta en formato AAAA-MM-DD');
  }
  const r = await repo.sellarHoras(desde, hasta);
  olvidar();
  console.log(`📒 [Bitácora] Resellado a mano ${r.desde} → ${r.hasta}: ${r.filas} fila(s) · ${quien || ''}`);
  return r;
}

/**
 * LA MEDIA POR DÍA DEL MES CORRIDO, LAS DOS QUE ENSEÑA LA BITÁCORA (14/10/2026).
 *
 * Son las dos cifras de «Media por día» de la ficha de una persona, pero para
 * toda la plantilla y en el servidor: las pide el Excel de Plantilla. Las mismas
 * reglas que `resumen()` y `mediaKpi()` de vistas/bitacora.ejs, y si una cambia,
 * la otra también:
 *
 *   · Un día con horas de BOLT (más de 0) es un día trabajado, con esas horas.
 *   · Un día con J es un día trabajado, con sus horas justificadas APROBADAS más
 *     lo que hizo en BOLT ese día. Una J pendiente cuenta el día, pero no sus
 *     horas: todavía no las ha aprobado nadie.
 *   · Un día sin nada de eso ni de lo de abajo es una «Ausencia» (no salió).
 *   · Libranzas, vacaciones, bajas y permisos no entran en ninguna.
 *   · Antes de su alta, tras su baja o entre dos contratos, solo si trabajó.
 *     Quien no tiene NINGÚN contrato (una ficha que no llegó a entrar), igual.
 *
 * Tampoco son una ausencia los días de una situación sin marca —suspensión de
 * empleo y sueldo, retirada del permiso, pendiente de asignar— (14/10/2026:
 * cuatro suspendidos salían con 0 h y 13 ausencias de 13 días), ni los días sin
 * ninguna plaza (15/10/2026). Desde el 15/10 la rejilla trae los dos
 * (`situaciones`, `sinPlaza`) y la pantalla los pinta igual que los cuenta esto.
 *
 *   media     = horas ÷ días trabajados            (la grande de la ficha)
 *   conAus    = horas ÷ (trabajados + ausencias)   (la de «contando la ausencia»:
 *               cada día que no salió cuenta como un día de 0 h)
 *
 * El periodo va del día 1 a AYER: la jornada de hoy va a medias. El día 1 aún
 * no hay ninguna cerrada del mes y sale el mes anterior entero. Con `hasta`
 * (una fecha pasada), el mes corrido de esa fecha.
 *
 * Devuelve { desde, hasta, porId: Map(conductor_id → { media, conAus, horas,
 * dias, ausencias }) }, las medias a un decimal.
 */
async function mediaDelMes({ hasta } = {}) {
  return promedioHoras({ hasta });
}

/**
 * EL PROMEDIO DE HORAS DE LA CASA (15/10/2026). Camilo: «la letra debe de
 * calcularse igual en todas partes, pon lo del cálculo de las horas como un
 * estándar en todas partes, hasta en los reportes». Es ESTE, y lo demás lo lee
 * de aquí: la calificación —y con ella la letra, el planificador, Control, el
 * reporte de horas y el de asistencia—, la ficha de cada persona y el Excel de
 * Plantilla. La pantalla de la bitácora hace la misma cuenta (`resumen()` y
 * `mediaKpi()` en vistas/bitacora.ejs) sobre la misma rejilla.
 *
 *   · Las horas de un día: las de BOLT de su turno (las de la rejilla, que son
 *     las selladas en bitacora_horas) más las J APROBADAS.
 *   · Cuentan los días que salió (con horas o con J) y las «Ausencias», a 0 h:
 *     días con plaza en los que le tocaba y no salió sin nada que lo explique.
 *   · No cuentan: libranzas, vacaciones, bajas, permisos, situaciones sin marca
 *     (suspensión…), días sin plaza y los de fuera de contrato (salvo que
 *     trabajara).
 *   · Hasta AYER: hoy va a medias y entra mañana.
 *
 *   promedio = horas ÷ (días que salió + ausencias)   ← EL número
 *   media    = horas ÷ días que salió                 (solo de detalle)
 *
 * Por omisión, el mes corrido hasta ayer. Con `hasta`, el mes corrido de esa
 * fecha; con `desde` también, ese tramo. Devuelve { desde, hasta, porId:
 * Map(conductor_id → { promedio, conAus (= promedio), media, horas, dias,
 * ausencias }) }, a un decimal.
 */
async function promedioHoras({ desde, hasta } = {}) {
  const d = await datos();
  const base = Date.UTC(d.inicio.y, d.inicio.m, d.inicio.d);
  const idx = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - base) / 86400000);
  const iso = i => new Date(base + i * 86400000).toISOString().slice(0, 10);
  const esIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10));
  let fin = d.hoyIdx - 1;
  if (esIso(hasta)) fin = Math.min(fin, idx(String(hasta).slice(0, 10)));
  const hastaIso = iso(fin);
  const desdeIso = esIso(desde) ? String(desde).slice(0, 10) : hastaIso.slice(0, 8) + '01';
  const ini = Math.max(0, idx(desdeIso));

  const enTramo = (tramos, i) => (tramos || []).some(([a, b]) => i >= a && i <= b);
  const fuera = (c, i) => c.altaIdx == null || i < c.altaIdx || (c.bajaIdx != null && i > c.bajaIdx)
    || enTramo(c.huecos, i);
  const NO_CUENTA = new Set(['V', 'B', 'P', 'L']);
  const r1 = x => Math.round(x * 10) / 10;
  const porId = new Map();
  d.conductores.forEach(c => {
    let horas = 0, dias = 0, ausencias = 0;
    for (let i = ini; i <= fin; i++) {
      const v = c.dias[i];
      if (typeof v === 'number' && v > 0) { horas += v; dias++; continue; }
      if (fuera(c, i)) continue;
      if (v === 'J') {
        const dia = iso(i), j = c.justif[dia] || {};
        horas += (j.estado === 'aprobada' ? (j.horas || 0) : 0) + ((c.horasBolt || {})[dia] || 0);
        dias++;
      } else if (!NO_CUENTA.has(v) && !enTramo(c.situaciones, i) && !enTramo(c.sinPlaza, i)) ausencias++;
    }
    if (dias || ausencias) {
      const promedio = r1(horas / (dias + ausencias));
      porId.set(String(c.conductorId), {
        promedio, conAus: promedio, media: dias ? r1(horas / dias) : null,
        horas: r1(horas), dias, ausencias,
      });
    }
  });
  return { desde: desdeIso, hasta: hastaIso, porId };
}

/**
 * RECALCULA LO QUE SALE DEL PROMEDIO DE HORAS: el rendimiento del mes
 * (`conductor_rendimiento`) y la CALIFICACIÓN A–D (`conductor_calificacion`),
 * los dos con el promedio de la casa (`promedioHoras`). Es por donde entran los
 * crons de las 05:40 y de las 12:00 y quien rehace horas (cuentas fantasma):
 * así la letra no puede calcular las horas de otra manera que la bitácora.
 *
 * La rejilla se lee de nuevo antes (la caché puede ser de antes del sellado).
 */
async function recalcularPromedios({ hasta } = {}) {
  olvidar();
  const fuente = (desde, h) => promedioHoras({ desde, hasta: h });
  const rendimiento = await require('../../services/repo/rendimiento').recalcular({ hasta, promedioHoras: fuente });
  const calificacion = await require('../../services/repo/calificacion').recalcular({ hasta, promedioHoras: fuente });
  return { rendimiento, calificacion };
}

module.exports = {
  mediaDelMes, promedioHoras, recalcularPromedios,
  datos, vacaciones, llamadasDelDia,
  justificar, anularJustificante, libranza, resellar,
  // El cron nocturno sella lo de ayer por su cuenta: entra por aquí, no por el
  // repositorio, que es lo que deja cambiar esto por dentro.
  // Y la rejilla en caché se tira: lo sellado cambia lo que enseña.
  sellarHoras: async (desde, hasta) => { const r = await repo.sellarHoras(desde, hasta); olvidar(); return r; },
  // Las horas de UNA jornada, por persona. Las pide el reporte de la ETT: si
  // las contara por su cuenta, dos pantallas dirían cosas distintas del mismo
  // día y una de ellas se le manda a un tercero.
  horasDeJornada: diaIso => repo.horasDeJornada(diaIso),
};
