// ============================================================
// VEHÍCULOS — servicio
// ============================================================
// LA PUERTA DEL MÓDULO. Todo lo que quiera saber de coches —su propio
// controlador, el planificador, la ingesta— entra por aquí. Nadie de fuera
// llama a `vehiculos.repo`: un módulo que deja que le metan la mano dentro deja
// de poder cambiar por dentro, que es justo lo que se gana al agruparlo.
//
// Hoy buena parte de esto es delegar en el repositorio sin añadir nada, y eso
// está bien: la puerta vale por ser la única, no por hacer cosas. Cuando una
// regla salga del repositorio —la de crear las 6 plazas al dar de alta un
// coche, por ejemplo— su sitio ya está aquí y no hay que mover a nadie más.
//
// ── SINCRONIZACIÓN CON MAPON ────────────────────────────────────────────────
// Una sola llamada a `unit/list.json` trae la foto de toda la flota: matrícula,
// odómetro en metros, estado y última señal. De ahí salen dos cosas:
//
//   · El ENLACE coche ↔ unidad de Mapon, que hay que hacer una vez y luego
//     mantener cuando entra o sale un coche.
//   · El ODÓMETRO, que se refresca a diario.
//
// Es la misma petición que el sistema ya hacía para otras cosas, así que no
// añade carga a la API.

const mapon = require('../../services/mapon');
const veh = require('./vehiculos.repo');

/** Enlaza los coches que aún no lo estén. Con `soloVer` no escribe nada. */
async function enlazar({ soloVer = false } = {}) {
  const unidades = await mapon.unidades();
  if (!unidades.size) throw new Error('Mapon no devolvió ninguna unidad');
  const r = await veh.enlazarMapon(unidades, { soloVer });
  const n = typeof r.nuevos === 'number' ? r.nuevos : r.nuevos.length;
  if (r.ambiguas.length) {
    console.warn(`⚠️  [MAPON] ${r.ambiguas.length} matricula(s) con VARIAS unidades: ` +
      r.ambiguas.map(a => `${a.matricula} → ${a.unidades.map(u => u.unitId).join('/')}`).join(', ') +
      '. No se enlazan: hay que dar de baja la unidad vieja en Mapon.');
  }
  if (r.rechazados && r.rechazados.length) {
    console.error('❌ [MAPON] Enlaces rechazados: ' + r.rechazados.join(' | '));
  }
  console.log(`🛰️  [MAPON] Enlaces: ${n} ${soloVer ? 'por crear' : 'creados'} · ` +
    `${r.sinCoche.length} unidad(es) sin coche nuestro · ${r.sinUnidad.length} coche(s) sin unidad`);
  return { ...r, unidades: unidades.size };
}

/** Vuelca los odómetros. Es lo que corre cada día. */
async function odometros() {
  const unidades = await mapon.unidades();
  if (!unidades.size) throw new Error('Mapon no devolvió ninguna unidad');
  const r = await veh.sincronizarOdometros(unidades);
  console.log(`🛰️  [MAPON] Odómetros: ${r.actualizados} al día · ${r.sinEnlace} sin coche enlazado · ` +
    `${r.sinCan} sin lectura del CAN (esos necesitan ancla) · ${r.fotos} fotos del día`);
  return { ...r, unidades: unidades.size };
}

/** Enlaza lo que falte y refresca odómetros. Es lo que llama el cron. */
async function diaria() {
  const e = await enlazar();          // por si entró un coche nuevo
  const o = await odometros();
  return { enlaces: e, odometros: o };
}

// ── LO QUE EL MÓDULO OFRECE ────────────────────────────────────────────────
// Lectura y escritura de la ficha del coche. Se delega tal cual: ver arriba por
// qué la puerta existe igualmente.
const listar = opciones => veh.listar(opciones);
const ficha = id => veh.ficha(id);
const resumen = sedes => veh.resumen(sedes);
const catalogos = () => veh.catalogos();
const crear = (datos, usuarioId) => veh.crear(datos, usuarioId);
const actualizar = (id, campos, usuarioId) => veh.actualizar(id, campos, usuarioId);
const darDeBaja = (id, usuarioId) => veh.darDeBaja(id, usuarioId);

/**
 * Los estados de coche del catálogo.
 *
 * Lo pide el PLANIFICADOR para pintar el cuadrante, y hasta ahora lo sacaba con
 * un SELECT escrito dentro de su controlador. Ahora se lo pide a este módulo,
 * que es quien sabe de coches.
 */
const estadosVehiculo = () => veh.estadosVehiculo();

module.exports = {
  listar, ficha, resumen, catalogos, crear, actualizar, darDeBaja, estadosVehiculo,
  enlazar, odometros, diaria,
};
