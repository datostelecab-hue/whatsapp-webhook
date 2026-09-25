// ============================================================
// PIEZAS DEL COCHE — servicio
// ============================================================
// El estado de cada pieza de un coche, para el taller (Camilo, 25/09/2026):
// en la ficha del vehículo se pincha una pieza en el dibujo y se dice cómo está.
//
//   · Buen estado                  lo que está todo al principio
//   · Mal estado · Arreglar        rojo
//   · Mal estado · Cambio          rojo que parpadea
//
// Con una observación en los dos malos. Cada cambio queda (quién y cuándo), y
// el estado de ahora es el último. Una pieza que nunca se tocó está en buen
// estado: no hace falta escribir 55 filas por coche para empezar.
//
// Las reglas son de aquí y no de la pantalla: la pieza y el estado tienen que
// existir en el catálogo, «Buen estado» no lleva observación, y apuntar lo mismo
// que ya hay no ensucia el historial con una fila repetida.

const repo = require('./piezas.repo');

const OBS_MAX = 1000;

// El catálogo casi no cambia: se guarda un minuto para no pedirlo en cada ficha.
let cacheCat = null, tsCat = 0;
async function catalogo() {
  if (!cacheCat || Date.now() - tsCat > 60 * 1000) { cacheCat = await repo.catalogo(); tsCat = Date.now(); }
  return cacheCat;
}

/** Todo lo que el dibujo necesita de un coche: el catálogo, el estado de ahora y el historial. */
async function deVehiculo(vehiculoId) {
  const id = Number(vehiculoId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el vehículo');
  const [cat, datos] = await Promise.all([catalogo(), repo.deVehiculo(id)]);
  return { ...cat, ...datos };
}

/** Cambia el estado de una pieza. */
async function apuntar(vehiculoId, { pieza, estado, observacion } = {}, usuarioId) {
  const id = Number(vehiculoId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el vehículo');
  const cat = await catalogo();
  const p = cat.piezas.find(x => x.codigo === pieza);
  if (!p) throw new Error('Esa pieza no existe');
  const e = cat.estados.find(x => x.codigo === estado);
  if (!e) throw new Error('Ese estado no existe');
  if (!(await repo.existeVehiculo(id))) throw new Error('Ese vehículo no existe');

  let obs = String(observacion == null ? '' : observacion).trim();
  if (!e.es_mal) obs = '';                  // «Buen estado» no lleva observación
  if (obs.length > OBS_MAX) throw new Error(`La observación es demasiado larga (máximo ${OBS_MAX} caracteres)`);

  // Lo mismo que ya hay no es un cambio: no se repite en el historial.
  const ahora = await repo.actualDe(id, p.codigo);
  const estadoAhora = ahora ? ahora.estado : 'bien';
  const obsAhora = ahora ? (ahora.observacion || '') : '';
  if (estadoAhora === e.codigo && obsAhora === obs) return { sinCambios: true };

  const r = await repo.apuntar({ vehiculoId: id, pieza: p.codigo, estado: e.codigo, observacion: obs || null }, usuarioId);
  console.log(`🔧 [PIEZAS] ${p.nombre} del vehículo ${id}: ${estadoAhora} → ${e.codigo}${obs ? ` («${obs.slice(0, 60)}»)` : ''}`);
  return { id: r.id, creado_at: r.creado_at };
}

module.exports = { deVehiculo, apuntar, catalogo };
