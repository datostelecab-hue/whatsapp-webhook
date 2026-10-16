// ============================================================
// LAS VACACIONES APROBADAS SOLO SE CAMBIAN A FUTURO
// ============================================================
// Camilo, 16/10/2026: «que se puedan editar las vacaciones aprobadas pero solo
// a futuro, las que pasaron no» — primero desde Vacaciones y, el mismo día,
// «Sí, bloquéalo también en Plantilla». Las dos puertas pasan por aquí, para que
// no digan cosas distintas de las mismas vacaciones.
//
//   · Las que ya pasaron enteras (terminaron antes de hoy) no se tocan.
//   · Las empezadas (desde hoy o antes): el primer día se queda, porque ya
//     pasó; la vuelta se puede adelantar —como pronto, que terminen hoy— o
//     retrasar.
//   · Las que aún no han empezado: las dos fechas, a partir de mañana.
//   · Borrar, solo las que aún no han empezado: borrar unas empezadas es
//     borrar días que ya pasaron. Si vuelve antes, se adelanta la vuelta.
//
// Hoy cuenta como pasado: es un día que ya se está viviendo. Solo vale para las
// VACACIONES: una baja médica se corrige cuando llega el parte, que suele ser
// después.
//
// Fechas en 'AAAA-MM-DD', sin husos: todo es día natural de Madrid.

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const mas = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const ddmmaaaa = d => String(d || '').split('-').reverse().join('/');
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Las fechas nuevas de unas vacaciones `t` ({ desde, hasta }), o lanza con el
 * porqué. Lo que no llega se queda como estaba.
 */
function validarCambio(t, { desde, hasta } = {}, hoy = hoyMadrid()) {
  if (!t.hasta) throw new Error('Estas vacaciones no tienen fecha de vuelta: hay que ponérsela.');
  if (t.hasta < hoy) {
    throw new Error(`Estas vacaciones ya pasaron (del ${ddmmaaaa(t.desde)} al ${ddmmaaaa(t.hasta)}): no se pueden cambiar.`);
  }
  const manana = mas(hoy, 1);
  const nd = desde || t.desde, nh = hasta || t.hasta;
  if (!ISO.test(nd) || !ISO.test(nh)) throw new Error('Faltan las fechas');
  if (t.desde <= hoy) {
    if (nd !== t.desde) {
      throw new Error(`Ya empezaron el ${ddmmaaaa(t.desde)}: el primer día no se puede mover. Sí se puede cambiar la vuelta.`);
    }
    if (nh < hoy) throw new Error('Como pronto pueden terminar hoy: lo de antes ya pasó y no se cambia.');
  } else if (nd < manana) {
    throw new Error(`Solo se pueden mover a días que aún no han llegado: como pronto, desde mañana (${ddmmaaaa(manana)}).`);
  }
  if (nh < nd) throw new Error('La vuelta no puede ser antes que el primer día');
  return { desde: nd, hasta: nh };
}

/** Lanza si unas vacaciones `t` no se pueden borrar: solo las que aún no han empezado. */
function validarBorrado(t, hoy = hoyMadrid()) {
  if (t.desde <= hoy) {
    throw new Error(t.hasta && t.hasta < hoy
      ? `Estas vacaciones ya pasaron (del ${ddmmaaaa(t.desde)} al ${ddmmaaaa(t.hasta)}): no se borran.`
      : `Estas vacaciones ya empezaron el ${ddmmaaaa(t.desde)}: no se borran, porque esos días ya pasaron. Si vuelve antes, adelanta la vuelta.`);
  }
}

module.exports = { validarCambio, validarBorrado, hoyMadrid };
