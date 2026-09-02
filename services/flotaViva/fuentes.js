// ============================================================
// FLOTA VIVA — de dónde salen los datos
// ============================================================
// Dos fuentes y cada una contesta a una cosa distinta:
//
//   · BOLT dice QUIÉN y en qué está: qué conductor lleva el coche y si está en
//     viaje, esperando pedido, en descanso o desconectado.
//   · Mapon dice DÓNDE y CUÁNTO: si el coche se mueve y qué marca el odómetro.
//
// Ninguna de las dos sirve sola. BOLT no sabe que un coche "en descanso" lleva
// cuarenta kilómetros hechos; Mapon no sabe quién lo conduce.
//
// De BOLT se reusa `services/bolt.js` —el token y la paginación ya están
// resueltos ahí—. A Mapon se le llama directamente: lo único que hace falta es
// el odómetro, y el cliente compartido no lo expone en esta rama. Es una
// duplicación pequeña y consciente, y desaparece cuando las ramas se junten.

const { fetchAllPaginated, CONFIG_BOLT } = require('../bolt');

const MAPON_API = 'https://mapon.com/api/v1';
const MAPON_KEY = process.env.MAPON_API_KEY || '';
const MAPON_TIMEOUT = Number(process.env.MAPON_TIMEOUT_MS) || 20000;

const txt = v => String(v == null ? '' : v).trim();
const normMat = s => txt(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Una marca de tiempo de Mapon a Date, o null si no viene o no se entiende. */
function fecha(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  // Puede venir en segundos epoch o como 'AAAA-MM-DD HH:MM:SS' en UTC.
  const t = Number.isFinite(n) && n > 1e9
    ? n * 1000
    : Date.parse(String(v).includes('T') ? String(v) : String(v).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? new Date(t) : null;
}

// ── BOLT ────────────────────────────────────────────────────────────────────

/** Los coches de todas las flotas: uuid → matrícula. */
async function vehiculos(desdeTs, hastaTs) {
  const out = [];
  for (const f of CONFIG_BOLT.flotas) {
    const v = await fetchAllPaginated('/fleetIntegration/v1/getVehicles',
      { company_id: f.id, start_ts: desdeTs, end_ts: hastaTs }, 'vehicles', 100, `FV veh ${f.id}`);
    v.forEach(x => {
      const uuid = txt(x.uuid || x.vehicle_uuid);
      const mat = normMat(x.reg_number || x.registration_number || x.license_plate);
      if (uuid) out.push({ uuid, matricula: mat, flotaId: f.id });
    });
  }
  return out;
}

/** Los conductores con su teléfono: uuid → { nombre, telefono }. */
async function conductores(desdeTs, hastaTs) {
  const out = [];
  for (const f of CONFIG_BOLT.flotas) {
    const d = await fetchAllPaginated('/fleetIntegration/v1/getDrivers',
      { company_id: f.id, start_ts: desdeTs, end_ts: hastaTs }, 'drivers', 100, `FV drv ${f.id}`);
    d.forEach(x => {
      const uuid = txt(x.driver_uuid || x.uuid);
      if (!uuid) return;
      out.push({
        uuid,
        nombre: txt(x.first_name || x.name) + (x.last_name ? ' ' + txt(x.last_name) : ''),
        telefono: txt(x.phone || x.phone_number),
        flotaId: f.id,
      });
    });
  }
  return out;
}

/**
 * El estado ACTUAL de cada coche, sacado del log de cambios.
 *
 * BOLT no tiene un "dime cómo está todo ahora": tiene un registro de cambios de
 * estado. Así que se pide una ventana y se coge, por coche, el último apunte.
 *
 * La ventana tiene que ser generosa. Un conductor que lleva tres horas
 * desconectado no genera un solo log en esas tres horas, y con una ventana corta
 * ese coche desaparece del mapa en vez de salir como desconectado — que es justo
 * lo que hay que ver.
 */
async function estados(desdeTs, hastaTs) {
  const logs = [];
  for (const f of CONFIG_BOLT.flotas) {
    const l = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs',
      { company_id: f.id, start_ts: desdeTs, end_ts: hastaTs }, 'state_logs', 1000, `FV log ${f.id}`);
    logs.push(...l);
  }

  // TODOS los apuntes de cada coche, en orden, no solo el último.
  //
  // Quedarse con el último parecía suficiente —es el estado de ahora— y no lo
  // era, por dos razones:
  //
  //   · Un estado que empieza Y acaba entre dos vueltas nuestras desaparecía. Un
  //     viaje de cuatro minutos no dejaba rastro: veíamos "espera" antes y
  //     "espera" después, y el tramo decía que llevaba dos horas esperando.
  //   · La hora del cambio la teníamos delante y la tirábamos. El tramo empezaba
  //     cuando MIRÁBAMOS nosotros, no cuando pasó, así que cada uno arrastraba
  //     hasta cinco minutos de error.
  //
  // Los apuntes traen la hora exacta. Con ellos se reconstruyen los tramos de
  // verdad en vez de aproximarlos cada cinco minutos.
  const porVehiculo = new Map();
  logs.forEach(l => {
    const uuid = txt(l.vehicle_uuid);
    const t = Number(l.created);
    if (!uuid || !t) return;
    if (!porVehiculo.has(uuid)) porVehiculo.set(uuid, []);
    porVehiculo.get(uuid).push({ t, estado: txt(l.state), conductor: txt(l.driver_uuid) });
  });
  porVehiculo.forEach(arr => arr.sort((a, b) => a.t - b.t));
  return porVehiculo;
}

// ── Mapon ───────────────────────────────────────────────────────────────────

async function pedirMapon(ruta, qs) {
  if (!MAPON_KEY) throw new Error('MAPON_API_KEY no está definida');
  const ac = new AbortController();
  const reloj = setTimeout(() => ac.abort(), MAPON_TIMEOUT);
  try {
    const r = await fetch(`${MAPON_API}/${ruta}?key=${MAPON_KEY}${qs ? '&' + qs : ''}`, { signal: ac.signal });
    const j = await r.json();
    if (j && j.error) throw new Error(`Mapon ${j.error.code}: ${j.error.msg}`);
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Mapon no respondió en ${MAPON_TIMEOUT / 1000}s`);
    throw e;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Toda la flota de Mapon de una vez: matrícula, si se mueve y el odómetro.
 *
 * UNA llamada para los ochenta coches, no ochenta. El odómetro viene en metros
 * en esa misma respuesta y es lo que permite saber cuántos km lleva un coche en
 * descanso sin pedir sus trayectos uno a uno.
 */
async function flotaMapon() {
  const j = await pedirMapon('unit/list.json');
  const unidades = (j.data && j.data.units) || [];
  const porMatricula = new Map();
  unidades.forEach(u => {
    const mat = normMat(u.number || u.label);
    if (!mat) return;
    porMatricula.set(mat, {
      unitId: Number(u.unit_id),
      matricula: mat,
      estado: txt(u.state && u.state.name ? u.state.name : u.state),
      enMarcha: txt(u.state && u.state.name ? u.state.name : u.state) === 'driving',
      velocidad: Number(u.speed) || 0,
      // En METROS. Puede no venir en algún equipo: entonces ese coche se queda
      // sin km y se dice, en vez de inventarse un cero que parecería "no se ha
      // movido".
      odometroM: Number.isFinite(Number(u.mileage)) ? Math.round(Number(u.mileage)) : null,
      // CUÁNDO habló el equipo por última vez, en su propio reloj.
      //
      // Es imprescindible para los km. El odómetro de un equipo que estuvo sin
      // cobertura se pone al día de golpe, y ese salto son kilómetros de ANTES:
      // sin saber a qué periodo corresponden, se le atribuyen al tramo que esté
      // abierto y aparecen 19 km en un coche que lleva tres minutos parado.
      senalAt: fecha(u.last_update),
    });
  });
  return porMatricula;
}

/**
 * El objeto de Mapon de UNA unidad, sin interpretar nada.
 *
 * Existe porque los km salieron mal y no había forma de saber si el fallo estaba
 * en nuestra cuenta o en lo que llega. `mileage` y `last_update` —sus nombres y
 * sobre todo sus UNIDADES— son suposiciones nuestras hasta que se miran.
 */
async function crudoDeUnidad(matricula) {
  const mat = normMat(matricula);
  const j = await pedirMapon('unit/list.json');
  const u = ((j.data && j.data.units) || []).find(x => normMat(x.number || x.label) === mat);
  if (!u) return null;
  return {
    campos: Object.keys(u),
    unit_id: u.unit_id, number: u.number, state: u.state, speed: u.speed,
    mileage: u.mileage, last_update: u.last_update,
    // Por si el odómetro viniera con otro nombre en algún equipo.
    otrosPosibles: Object.fromEntries(Object.entries(u)
      .filter(([k]) => /mile|odo|dist|update|time/i.test(k))),
  };
}

/**
 * Los trayectos que Mapon calcula para UNA unidad en un rango, tal cual.
 *
 * Es lo que da la distancia DE VERDAD —la de "Informes/Rutas"—, a diferencia del
 * `mileage` de unit/list, que llega estancado (marca un odómetro de hace horas y
 * no se mueve entre vueltas, así que la resta da cero). Se pide crudo para ver el
 * formato exacto —el nombre del campo de distancia y sus unidades— antes de
 * construir los km buenos encima.
 */
async function rutasDeUnidad(unitId, from, till) {
  return pedirMapon('route/list.json',
    `unit_id=${encodeURIComponent(unitId)}` +
    `&from=${encodeURIComponent(from)}&till=${encodeURIComponent(till)}`);
}

module.exports = { vehiculos, conductores, estados, flotaMapon, crudoDeUnidad, rutasDeUnidad, normMat };
