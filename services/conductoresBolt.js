// ============================================================
// CONDUCTORES_BOLT — padrón de creación de conductores (Node)
// ============================================================
// Base de datos propia de "cuándo apareció por primera vez cada conductor en
// Bolt". La API de Bolt NO devuelve la fecha de creación del conductor, así que
// la fabricamos nosotros: cada media hora leemos todos los drivers de las flotas
// y, la primera vez que vemos un driver_uuid, le sellamos created_at = ahora.
// A partir de ahí ese created_at es INMUTABLE. Con eso no dependemos de que Bolt
// nos avise por correo de una alta: en cuanto el conductor aparece, lo sabemos
// (señal del puente Selección → RRHH).
//
// Porta el Apps Script del usuario, optimizado:
//   · Una sola ventana ancha por flota (3 años) en vez de 3 consultas
//     (activos + mes actual + mes anterior).
//   · No se borra ni recrea la hoja: se lee, se fusiona (conservando created_at)
//     y se reescribe en un solo golpe. Nunca hay una ventana en la que la hoja
//     quede vacía → el created_at no se puede perder.
//   · Si la API devuelve 0 drivers (fallo/caída), NO se escribe nada: se deja el
//     padrón intacto. Perder este fichero resetearía todos los created_at.
//   · Fechas como texto 'dd/mm/aaaa HH:mm:ss' escritas en RAW: sobreviven al ida
//     y vuelta sin que Google las reinterprete ni se desplacen.
// (El bug "coordenadas fuera de las dimensiones" del .gs desaparece solo: la API
//  de Sheets expande la hoja sola al escribir.)

const { CONFIG_BOLT, fetchRangoCompleto } = require('./bolt');
const { readSheet, writeSheetRaw, ensureSheet } = require('./sheets');

const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA = 'CONDUCTORES_BOLT';
const TZ = 'Europe/Madrid';

// getDrivers filtra por fecha de ALTA del conductor, así que pedimos una ventana
// ancha para traerlos a todos de una sola vez.
const VENTANA_DIAS = 3 * 365;

const CABECERA = [
  'driver_uuid', 'partner_uuid', 'nombre', 'email', 'phone', 'state', 'flota',
  'created_at', 'updated_at', 'veces_visto', 'nuevo'
];

function ahoraMadrid() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

/**
 * Trae los drivers actuales de todas las flotas con sus campos completos.
 * Devuelve Map(driver_uuid -> registro). Si un conductor está en varias flotas,
 * nos quedamos con el registro "más vivo" (state active) para no marcar de baja
 * a quien sigue trabajando en otra flota.
 */
async function traerDriversBolt() {
  const finTs = Math.floor(Date.now() / 1000);
  const iniTs = finTs - VENTANA_DIAS * 86400;
  const porUuid = new Map();

  for (const f of CONFIG_BOLT.flotas) {
    const drivers = await fetchRangoCompleto(
      '/fleetIntegration/v1/getDrivers', { company_id: f.id },
      'drivers', iniTs, finTs, 1000, 'padron-' + f.id
    );
    drivers.forEach(d => {
      const uuid = d.driver_uuid ? String(d.driver_uuid) : null;
      if (!uuid) return;
      const rec = {
        driver_uuid: uuid,
        partner_uuid: d.partner_uuid ? String(d.partner_uuid) : '',
        nombre: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
        email: (d.email || '').toString().trim(),
        phone: (d.phone || '').toString().trim(),
        state: (d.state || '').toString().trim(),
        flota: f.nombre || String(f.id)
      };
      const prev = porUuid.get(uuid);
      if (!prev) porUuid.set(uuid, rec);
      else if (prev.state !== 'active' && rec.state === 'active') porUuid.set(uuid, rec);
    });
  }
  return porUuid;
}

/**
 * Lee el padrón actual. Devuelve { db: Map(uuid -> registro), filas: nº de filas
 * físicas leídas } — el conteo sirve para sobrescribir filas basura al reescribir.
 */
async function leerPadron() {
  // Lectura FORMATEADA a propósito: si migras tu DB_CONDUCTORES del .gs (donde
  // created_at es una celda de FECHA con formato dd/mm/aaaa HH:mm:ss), aquí llega
  // como ese mismo texto y se conserva tal cual. Para las celdas que escribe este
  // módulo (ya texto) también sale idéntico. Así el created_at nunca se altera.
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:K`);
  const db = new Map();
  const num = v => parseInt(String(v == null ? '' : v).replace(/[^\d]/g, '')) || 0;
  for (let i = 1; i < filas.length; i++) {            // fila 0 = cabecera
    const uuid = (filas[i][0] || '').toString().trim();
    if (!uuid) continue;
    db.set(uuid, {
      driver_uuid: uuid,
      partner_uuid: (filas[i][1] || '').toString(),
      nombre: (filas[i][2] || '').toString(),
      email: (filas[i][3] || '').toString(),
      phone: (filas[i][4] || '').toString(),
      state: (filas[i][5] || '').toString(),
      flota: (filas[i][6] || '').toString(),
      created_at: (filas[i][7] || '').toString(),
      updated_at: (filas[i][8] || '').toString(),
      veces_visto: num(filas[i][9])
    });
  }
  return { db, filas: filas.length };
}

/**
 * Actualiza el padrón: sella created_at a los nuevos, refresca a los ya vistos y
 * conserva intactos a los que hoy no aparecieron. Devuelve un resumen.
 */
async function actualizarConductoresBolt() {
  await ensureSheet(ID_PLANIFICADOR, HOJA);

  const actuales = await traerDriversBolt();
  // Salvavidas: si la API no devolvió a nadie, NO tocamos el padrón.
  if (actuales.size === 0) {
    console.warn('⚠️ [CONDUCTORES_BOLT] getDrivers devolvió 0 conductores: no se escribe nada.');
    return { ok: false, motivo: 'sin_drivers', total: 0, nuevos: 0, actualizados: 0 };
  }

  const { db, filas: filasViejas } = await leerPadron();
  const ahora = ahoraMadrid();
  let nuevos = 0, actualizados = 0;
  const nuevosUuids = new Set();

  actuales.forEach((rec, uuid) => {
    const prev = db.get(uuid);
    if (prev) {
      const cambio = prev.state !== rec.state || prev.nombre !== rec.nombre
        || prev.phone !== rec.phone || prev.email !== rec.email;
      db.set(uuid, {
        ...prev,
        partner_uuid: rec.partner_uuid || prev.partner_uuid,
        nombre: rec.nombre || prev.nombre,
        email: rec.email || prev.email,
        phone: rec.phone || prev.phone,
        state: rec.state,
        flota: rec.flota || prev.flota,
        updated_at: ahora,
        veces_visto: prev.veces_visto + 1
      });
      if (cambio) actualizados++;
    } else {
      db.set(uuid, { ...rec, created_at: ahora, updated_at: ahora, veces_visto: 1 });
      nuevos++;
      nuevosUuids.add(uuid);
    }
  });

  // Ordenar por nombre. La columna 'nuevo' marca solo a los sellados esta corrida.
  const ordenados = [...db.values()].sort((a, b) =>
    (a.nombre || '').toLowerCase().localeCompare((b.nombre || '').toLowerCase()));

  const grid = [CABECERA, ...ordenados.map(c => [
    c.driver_uuid, c.partner_uuid, c.nombre, c.email, c.phone, c.state, c.flota,
    c.created_at, c.updated_at, c.veces_visto, nuevosUuids.has(c.driver_uuid) ? 'SÍ' : ''
  ])];

  // Rellenar con filas en blanco hasta cubrir las filas físicas que había, para
  // sobrescribir cualquier sobrante (uuid en blanco, duplicados) sin borrar la
  // hoja ni arriesgar el created_at.
  while (grid.length < filasViejas) grid.push(new Array(CABECERA.length).fill(''));

  // RAW: números como números, fechas 'dd/mm/aaaa HH:mm:ss' como texto estable.
  await writeSheetRaw(ID_PLANIFICADOR, `${HOJA}!A1`, grid);

  const resumen = { ok: true, total: db.size, nuevos, actualizados, hoja: HOJA };
  console.log(`✅ [CONDUCTORES_BOLT] ${JSON.stringify(resumen)}`);
  return resumen;
}

module.exports = { actualizarConductoresBolt, leerPadron };
