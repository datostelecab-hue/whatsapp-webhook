// ============================================================
// FACTURAS DE TALLER — la puerta
// ============================================================
// Desde fuera del módulo se entra por aquí, nunca por `facturas.repo`.
//
// Lo que decide este servicio y no el repositorio: QUÉ SEDES ve quien pregunta.
// El repositorio se niega a listar sin que le digan las sedes —a propósito, para
// que un olvido no enseñe Barcelona a quien solo lleva Madrid— y es aquí donde
// se traduce «este usuario» a «estas sedes».

const repo = require('./facturas.repo');

const SEDES = ['madrid', 'barcelona'];
const SEDE_POR_DEFECTO = 'madrid';

/**
 * Las sedes que puede ver quien pregunta.
 *
 * Óscar lleva el taller de Madrid y el jefe quiere verlo todo, así que la
 * diferencia es un permiso, no un rol: quien tenga `/vehiculos/sedes` ve las
 * dos. El resto, Madrid — que es donde se usa el sistema.
 */
const sedesDe = ({ todasLasSedes = false } = {}) => (todasLasSedes ? SEDES : [SEDE_POR_DEFECTO]);

const normSede = s => (SEDES.includes(String(s || '').toLowerCase()) ? String(s).toLowerCase() : SEDE_POR_DEFECTO);

/** La lista de facturas, ya filtrada por lo que esa persona puede ver. */
const listar = (filtros = {}, quien = {}) =>
  repo.lista({ ...filtros, sedes: sedesDe(quien) });

/**
 * Una factura. Se comprueba la sede DESPUÉS de leerla: la alternativa es
 * meter el filtro en el WHERE y devolver «no existe» para algo que sí existe,
 * y entonces nadie entiende por qué no la encuentra.
 */
async function ver(id, quien = {}) {
  const f = await repo.ficha(id);
  if (!f) throw new Error('Esa factura no existe');
  if (!sedesDe(quien).includes(f.sede)) throw new Error('Esa factura es de otra sede');
  return f;
}

/**
 * Alta. Las líneas sin importe ni matrícula se tiran: son filas vacías del
 * formulario, no gasto.
 *
 * NO se exige que las líneas sumen el total. Una factura trae portes, descuentos
 * y redondeos que no son de ningún coche, y obligar a cuadrarlo al céntimo
 * acabaría con alguien inventándose una línea para poder guardar. Se avisa del
 * descuadre y se guarda lo que dice el papel.
 */
async function alta(datos = {}, quien = {}) {
  const lineas = (datos.lineas || []).filter(l =>
    String(l.matricula || '').trim() || String(l.concepto || '').trim() || Number(l.importe));
  const sede = normSede(datos.sede);
  if (!sedesDe(quien).includes(sede)) throw new Error('No puedes dar de alta facturas de esa sede');

  const r = await repo.crear({ ...datos, sede, lineas }, quien);
  const f = await repo.ficha(r.id);
  const suma = f.lineasDetalle.reduce((a, l) => a + l.importe, 0);
  return {
    ...r,
    // Se devuelve para que la pantalla lo diga, no para impedir el alta.
    descuadre: +(f.total - suma).toFixed(2),
    lineas: f.lineasDetalle.length,
    // Dos avisos distintos, porque se arreglan de forma distinta: el NN se le
    // reclama al taller y la matrícula desconocida se comprueba aquí.
    sinCoche: f.lineasDetalle.filter(l => !l.reconocido && !l.matricula).length,
    desconocidas: f.lineasDetalle.filter(l => !l.reconocido && l.matricula).length,
  };
}

const anular = (id, motivo, quien = {}) => repo.anular(id, motivo, quien);
const adjuntar = (id, adjunto) => repo.guardarAdjunto(id, adjunto);

const proveedores = () => repo.proveedores();
const nuevoProveedor = datos => repo.crearProveedor(datos);

/** El cuadro de gasto por coche, que es para lo que existe todo esto. */
const gasto = (filtros = {}, quien = {}) =>
  repo.gastoPorVehiculo({ ...filtros, sedes: sedesDe(quien) });

/** Lo gastado en UN coche, para pintarlo en su ficha. */
const gastoDeCoche = vehiculoId => repo.gastoDe(vehiculoId);

module.exports = {
  listar, ver, alta, anular, adjuntar,
  proveedores, nuevoProveedor,
  gasto, gastoDeCoche,
  sedesDe, SEDES, SEDE_POR_DEFECTO,
  EXIGE_MATRICULA_DESDE: repo.EXIGE_MATRICULA_DESDE,
};
