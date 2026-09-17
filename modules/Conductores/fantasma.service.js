// ============================================================
// CUENTAS FANTASMA — la puerta
// ============================================================
// Desde fuera del módulo se entra por aquí, nunca por `fantasma.repo`.
//
// Lo que decide este servicio y no el repositorio: QUÉ PASA DESPUÉS de tocar un
// enlace. Guardar la fila no mueve ni una hora — mientras no se vuelvan a sellar
// esos días, la bitácora, la asistencia, el promedio y la nómina siguen contando
// lo de antes. Ese re-sellado es la mitad del trabajo, y va aquí.

const repo = require('./fantasma.repo');
const bitacora = require('../Operaciones/bitacora.service');
const rendimiento = require('../../services/repo/rendimiento');

const HOY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const esISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Antes de esto no hay rejilla que tocar (la bitácora arranca el 1 de junio de
// 2026), así que un enlace anterior no movería nada y lo más probable es que sea
// una fecha mal tecleada.
const MINIMO = '2026-06-01';

/**
 * Los días que hay que volver a calcular por culpa de un cambio.
 *
 * Se cogen los del enlace NUEVO y los del VIEJO: si a un enlace del 1 al 10 se
 * le recorta el `hasta` al día 4, los días 5 a 10 también cambian de dueño y hay
 * que rehacerlos, aunque ya no pertenezcan al enlace.
 *
 * Un `hasta` en blanco significa "sigue usándola", así que se cierra en HOY: los
 * días que aún no han pasado no hay nada que sellar en ellos.
 */
function rangoAfectado(...enlaces) {
  const hoy = HOY();
  let desde = null, hasta = null;
  enlaces.filter(Boolean).forEach(e => {
    const d = e.desde, h = e.hasta || hoy;
    if (!desde || d < desde) desde = d;
    if (!hasta || h > hasta) hasta = h;
  });
  if (!desde) return null;
  if (hasta > hoy) hasta = hoy;          // el futuro no se sella
  return hasta < desde ? null : { desde, hasta };
}

/**
 * Vuelve a sellar los días tocados y rehace el promedio del mes.
 *
 * Si esto falla, el enlace ya está guardado y las horas se quedarían a medio
 * camino: se avisa en la respuesta en vez de tragárselo, porque «lo guardé pero
 * no se ven las horas» es justo el fallo que nadie sabría diagnosticar.
 */
async function rehacer(rango) {
  if (!rango) return { resellado: null };
  try {
    const r = await bitacora.sellarHoras(rango.desde, rango.hasta);
    // El promedio del mes se calcula sobre las horas selladas: si no se rehace,
    // la media sigue siendo la de antes hasta que pase el cron de la noche.
    await rendimiento.recalcular({}).catch(() => null);
    return { resellado: { ...rango, filas: r.filas } };
  } catch (e) {
    return { resellado: null, avisoSellado: `El enlace quedó guardado, pero no se pudieron recalcular ` +
      `los días ${rango.desde} → ${rango.hasta}: ${e.message}. Las horas no se moverán hasta que ` +
      `se vuelva a sellar ese rango.` };
  }
}

function comprobarFechas(desde, hasta) {
  if (!esISO(desde)) throw new Error('Falta la fecha de inicio (desde)');
  if (hasta && !esISO(hasta)) throw new Error('La fecha de fin no es una fecha válida');
  if (hasta && hasta < desde) throw new Error('El periodo termina antes de empezar');
  if (desde < MINIMO) throw new Error(`La bitácora empieza el ${MINIMO}: un enlace anterior no movería ninguna hora`);
  // El futuro sí se admite en el `desde` (dejar preparado un préstamo), pero no
  // una fecha absurda que delate un error de tecleo.
  const tope = String(Number(HOY().slice(0, 4)) + 1) + HOY().slice(4);
  if (desde > tope || (hasta && hasta > tope)) throw new Error('Esa fecha está a más de un año vista: revísala');
}

const listar = conductorId => repo.deConductor(conductorId);
/** El libro de auditoría de esa persona: cada acción, con quién y desde dónde. */
const libro = conductorId => repo.libroDeConductor(conductorId);
const prestables = q => repo.prestables(q);
const vivos = () => repo.vivos();
const enRango = (desde, hasta) => repo.enRango(desde, hasta);
const vigentesHoy = () => repo.vigentesHoy();

/**
 * Enlaza una cuenta prestada a una persona por un periodo.
 *
 * El no-solape lo rechaza la base; aquí solo se traduce ese rechazo a un
 * mensaje que diga CON QUIÉN choca y en qué fechas, que es lo que hace falta
 * para arreglarlo sin tener que ir a mirar la tabla.
 */
async function enlazar({ conductorId, cuentaId, desde, hasta, motivo }, quien = {}) {
  comprobarFechas(desde, hasta);
  const cu = await repo.cuenta(cuentaId);
  if (!cu) throw new Error('Esa cuenta de BOLT no existe');
  // Una cuenta con dueño no se presta: sus horas ya son de alguien y prestarla
  // sería quitárselas sin que esa persona se entere.
  if (cu.conductorId) {
    throw new Error(`La cuenta «${cu.nombre}» ya tiene dueño. Una cuenta fantasma es una cuenta SIN dueño; ` +
      'si de verdad es de esta persona, enlázala como cuenta propia.');
  }
  if (String(cu.conductorId) === String(conductorId)) throw new Error('Esa cuenta ya es suya');

  let fila;
  try {
    fila = await repo.crear({ conductorId, cuentaId, desde, hasta, motivo, usuarioId: quien.usuarioId });
  } catch (e) {
    if (!repo.esSolape(e)) throw e;
    const ch = await repo.choquesDe({ cuentaId, desde, hasta });
    const quienes = ch.map(c => `${c.conductor} (${c.desde}${c.hasta ? ' → ' + c.hasta : ' → sigue usándola'})`).join(', ');
    throw new Error(`La cuenta «${cu.nombre}» ya está prestada en esas fechas a ${quienes || 'otra persona'}. ` +
      'Las horas de un día son de una sola persona: cierra el otro periodo antes.');
  }
  await repo.apuntar({ fantasmaId: fila.id, accion: 'enlazar', quien,
    detalle: { cuenta: fila.cuenta, desde: fila.desde, hasta: fila.hasta, motivo: fila.motivo || null } });
  return { ...fila, ...(await rehacer(rangoAfectado(fila))) };
}

/** Cambia las fechas de un enlace. Rehace los días viejos Y los nuevos. */
async function cambiarFechas({ id, desde, hasta }, quien = {}) {
  comprobarFechas(desde, hasta);
  const actual = await repo.uno(id);
  if (!actual) throw new Error('Ese enlace no existe');
  let r;
  try {
    r = await repo.cambiarFechas({ id, desde, hasta });
  } catch (e) {
    if (!repo.esSolape(e)) throw e;
    const ch = await repo.choquesDe({ cuentaId: actual.cuentaId, desde, hasta, excluirId: id });
    const quienes = ch.map(c => `${c.conductor} (${c.desde}${c.hasta ? ' → ' + c.hasta : ' → sigue usándola'})`).join(', ');
    throw new Error(`Con esas fechas pisaría a ${quienes || 'otro periodo'} en la misma cuenta.`);
  }
  // Cambiar las fechas es la acción con la que se estiran unas horas sin que se
  // note: va al libro con el ANTES y el DESPUÉS, no solo con lo que queda.
  await repo.apuntar({ fantasmaId: r.despues.id, accion: 'fechas', quien,
    detalle: { cuenta: r.despues.cuenta,
      antes: { desde: r.antes.desde, hasta: r.antes.hasta },
      despues: { desde: r.despues.desde, hasta: r.despues.hasta } } });
  return { ...r.despues, ...(await rehacer(rangoAfectado(r.antes, r.despues))) };
}

/**
 * Anula un enlace. Las horas vuelven a quien las tuviera antes —la cuenta, si no
 * es de nadie— y por eso hay que rehacer su rango entero.
 */
async function anular({ id, motivo }, quien = {}) {
  const fila = await repo.anular({ id, motivo, usuarioId: quien.usuarioId });
  await repo.apuntar({ fantasmaId: fila.id, accion: 'anular', quien,
    detalle: { cuenta: fila.cuenta, desde: fila.desde, hasta: fila.hasta, motivo: motivo || null } });
  return { ...fila, ...(await rehacer(rangoAfectado(fila))) };
}

/**
 * Cierra HOY un enlace abierto: es el caso de «ya le han devuelto su cuenta».
 * Se separa de cambiarFechas porque es un botón de uno solo clic y el error de
 * teclear la fecha a mano no compensa.
 */
async function cerrarHoy(id, quien = {}) {
  const a = await repo.uno(id);
  if (!a) throw new Error('Ese enlace no existe');
  if (!a.abierto) throw new Error('Ese enlace ya está cerrado');
  return cambiarFechas({ id, desde: a.desde, hasta: HOY() }, quien);
}

module.exports = {
  listar, libro, prestables, vivos, enRango, vigentesHoy,
  enlazar, cambiarFechas, anular, cerrarHoy,
  rangoAfectado, rehacer, MINIMO,
};
