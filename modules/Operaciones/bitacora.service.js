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
 * Marcar (o quitar) una LIBRANZA manual desde el panel del día: "ese día le
 * tocaba librar". Vive en `bitacora_dia`; el planificador NO se toca — el
 * cuadrante dice lo que estaba planificado, y esto lo que de verdad pasó.
 */
async function libranza({ conductorId, dia, quitar }) {
  if (quitar) await repo.quitarLibranza(conductorId, dia);
  else await repo.marcarLibranza(conductorId, dia);
  olvidar();
  console.log(`📓 [Bitácora] Libranza manual ${quitar ? 'quitada' : 'puesta'} · conductor ${conductorId} · ${dia}`);
  return {};
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

module.exports = {
  datos, vacaciones, llamadasDelDia,
  justificar, anularJustificante, libranza, resellar,
  // El cron nocturno sella lo de ayer por su cuenta: entra por aquí, no por el
  // repositorio, que es lo que deja cambiar esto por dentro.
  sellarHoras: (desde, hasta) => repo.sellarHoras(desde, hasta),
};
