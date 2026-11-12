// ============================================================
// INVENTARIO DEL TALLER — servicio (db/241)
// ============================================================
// La puerta del inventario: los recambios del almacén (Hergar) y sus
// movimientos. Mirarlo es '/inventario'; sumar, restar, ajustar y anular,
// '/inventario/mover' (o el rol que lo puede todo). Las reglas —el stock no
// baja de cero, una salida va a un coche y crea su mantenimiento— viven en el
// repositorio, dentro de una transacción, que es donde se pueden cumplir.

const repo = require('./inventario.repo');
const taller = require('./taller.repo');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];
const LLAVE_MOVER = '/inventario/mover';

/** ¿Puede mover el inventario? Ante cualquier fallo, no. */
async function puedeMover({ rol, usuarioId } = {}) {
  if (ADMIN_TOTAL.includes(rol)) return true;
  if (!usuarioId) return false;
  try {
    return (await require('../../services/permisos').clavesDe(usuarioId)).has(LLAVE_MOVER);
  } catch (_) { return false; }
}

/** Las categorías de un artículo: las de las piezas, sin mano de obra ni notas. */
const CATEGORIAS = taller.CATEGORIAS.filter(c => repo.CATEGORIAS.includes(c.codigo));

module.exports = {
  CATEGORIAS, TIPOS_MOV: repo.TIPOS_MOV,
  puedeMover,
  lista: () => repo.lista(),
  ficha: id => repo.ficha(id),
  coches: () => repo.coches(),
  crearArticulo: (datos, quien) => repo.crearArticulo(datos, quien),
  editarArticulo: (id, datos) => repo.editarArticulo(id, datos),
  mover: (datos, quien) => repo.mover(datos, quien),
  anular: (id, motivo, quien) => repo.anular(id, motivo, quien),
};
