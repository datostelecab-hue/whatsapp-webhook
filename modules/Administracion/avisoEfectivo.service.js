// ============================================================
// AVISO · EFECTIVO ACTIVO Y NUNCA UNA ENTREGA (27/10/2026)
// ============================================================
// Camilo: «necesito un PopUp como el de los cumpleaños pero solo para Víctor y
// Dahian, en el cual salgan las personas con efectivo activo, desestima a los
// que ya entregaron efectivo así sea una vez en recaudación».
//
// Una tarjeta abajo a la derecha, como las de los cumpleaños
// (public/assets/js/avisoEfectivo.js), con quien tiene el efectivo activado en
// BOLT y no ha pasado NUNCA por la ventanilla (recaudacion.repo
// .conEfectivoSinEntregar). Los que siguen en plantilla, para llamarles; los
// que ya no, para quitarles el efectivo en BOLT: es un grifo abierto.
//
// SOLO PARA QUIEN TENGA LA LLAVE '/avisos/efectivo' en su matriz: Víctor
// (usuario 3) y Daiane Alves (usuario 9), db/220. Es `manual` (grupo Caja):
// no la reparte ningún rol, y ni el superadmin ni el desarrollador la ven por
// su rol. Para que la vea otra persona, se le da en Usuarios y permisos.

const permisos = require('../../services/permisos');
const repo = require('./recaudacion.repo');

const LLAVE = '/avisos/efectivo';

/** ¿Tiene la llave? Ante cualquier fallo, no: el aviso no es imprescindible. */
async function tieneLlave(usuarioId) {
  const id = Number(usuarioId);
  if (!Number.isInteger(id) || id <= 0) return false;
  try { return (await permisos.clavesDe(id)).has(LLAVE); }
  catch (e) { console.error('❌ [Aviso efectivo] no se pudo mirar la llave:', e.message); return false; }
}

/**
 * Lo que pinta la tarjeta, o `{ ver: false }` para quien no tiene la llave.
 * Lo que debe cada uno sale del MISMO cuadro que la pantalla de Recaudación:
 * así el aviso y la pantalla dicen la misma cifra.
 */
async function paraLaTarjeta(usuarioId, { rolTotal = false } = {}) {
  if (!await tieneLlave(usuarioId)) return { ver: false };
  const [gente, cuadro, claves] = await Promise.all([
    repo.conEfectivoSinEntregar(), repo.cuadro(), permisos.clavesDe(Number(usuarioId)),
  ]);
  const debe = new Map(cuadro.filas.filter(f => !f.sinFicha).map(f => [f.conductorId, f.aRecaudar]));
  const lista = gente
    .map(g => ({ ...g, debe: Math.max(0, +(debe.get(g.id) || 0).toFixed(2)) }))
    // Los que siguen aquí primero (son a quien se llama); dentro, quien más debe.
    .sort((a, b) => (b.enPlantilla - a.enPlantilla) || (b.debe - a.debe) || a.nombre.localeCompare(b.nombre));
  return {
    ver: true,
    gente: lista,
    // El botón «Abrir Recaudación» solo a quien puede entrar en ella.
    puedeRecaudacion: rolTotal || claves.has('/recaudacion'),
  };
}

module.exports = { LLAVE, tieneLlave, paraLaTarjeta };
