// ============================================================
// SINCRONIZACIÓN CON MAPON — enlaces y odómetros
// ============================================================
// Una sola llamada a `unit/list.json` trae la foto de toda la flota: matrícula,
// odómetro en metros, estado y última señal. De ahí salen dos cosas:
//
//   · El ENLACE coche ↔ unidad de Mapon, que hay que hacer una vez y luego
//     mantener cuando entra o sale un coche.
//   · El ODÓMETRO, que se refresca a diario.
//
// Es la misma petición que el sistema ya hacía para otras cosas, así que no
// añade carga a la API.

const mapon = require('./mapon');
const veh = require('./repo/vehiculos');

/** Enlaza los coches que aún no lo estén. Con `soloVer` no escribe nada. */
async function enlazar({ soloVer = false } = {}) {
  const unidades = await mapon.unidades();
  if (!unidades.size) throw new Error('Mapon no devolvió ninguna unidad');
  const r = await veh.enlazarMapon(unidades, { soloVer });
  const n = typeof r.nuevos === 'number' ? r.nuevos : r.nuevos.length;
  console.log(`🛰️  [MAPON] Enlaces: ${n} ${soloVer ? 'por crear' : 'creados'} · ` +
    `${r.sinCoche.length} unidad(es) sin coche nuestro · ${r.sinUnidad.length} coche(s) sin unidad`);
  return { ...r, unidades: unidades.size };
}

/** Vuelca los odómetros. Es lo que corre cada día. */
async function odometros() {
  const unidades = await mapon.unidades();
  if (!unidades.size) throw new Error('Mapon no devolvió ninguna unidad');
  const r = await veh.sincronizarOdometros(unidades);
  console.log(`🛰️  [MAPON] Odómetros: ${r.actualizados} al día · ${r.sinEnlace} sin coche enlazado`);
  return { ...r, unidades: unidades.size };
}

/** Enlaza lo que falte y refresca odómetros. Es lo que llama el cron. */
async function diaria() {
  const e = await enlazar();          // por si entró un coche nuevo
  const o = await odometros();
  return { enlaces: e, odometros: o };
}

module.exports = { enlazar, odometros, diaria };
