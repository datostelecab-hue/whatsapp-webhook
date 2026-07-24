// ============================================================
// CONDUCTORES: módulo de control (en construcción)
// ============================================================
// Maestro = AGENDA_V2 (planificador). De aquí salen los conductores, su turno,
// su libranza y su matrícula. Las HORAS salen de la API de Bolt y se unen por
// ID_BOLT (no por nombre), para no repetir el desajuste de nombres.

const { leerTablero } = require('./planificadorV2');
const { CONFIG_BOLT, fetchRangoCompleto } = require('./bolt');

/**
 * Cruza los ID_BOLT de AGENDA_V2 contra los conductores reales de la API de
 * Bolt. Dice cuántos casan por driver_uuid, por partner_uuid o por ninguno, y
 * muestra ejemplos con el nombre de cada lado. No escribe nada.
 */
async function verificarIdBolt() {
  const tablero = await leerTablero();
  const agenda = (tablero && tablero.conductores) || [];
  const conId = agenda.filter(c => (c.idBolt || '').toString().trim());

  // getDrivers filtra por fecha de alta: ventana ancha para traerlos a todos.
  const finTs = Math.floor(Date.now() / 1000);
  const iniTs = finTs - 3 * 365 * 86400;
  const porUuid = new Map();
  const porPartner = new Map();

  for (const f of CONFIG_BOLT.flotas) {
    const drivers = await fetchRangoCompleto(
      '/fleetIntegration/v1/getDrivers', { company_id: f.id },
      'drivers', iniTs, finTs, 1000, 'idcheck-' + f.id
    );
    drivers.forEach(d => {
      const nombre = `${d.first_name || ''} ${d.last_name || ''}`.trim();
      if (d.driver_uuid) porUuid.set(String(d.driver_uuid), nombre);
      if (d.partner_uuid) porPartner.set(String(d.partner_uuid), nombre);
    });
  }

  let mUuid = 0, mPartner = 0, mNone = 0;
  const muestra = [];
  const sinMatch = [];
  conId.forEach(c => {
    const id = c.idBolt.toString().trim();
    if (porUuid.has(id)) {
      mUuid++;
      if (muestra.length < 10) muestra.push({ agenda: c.nombre, bolt: porUuid.get(id), via: 'driver_uuid' });
    } else if (porPartner.has(id)) {
      mPartner++;
      if (muestra.length < 10) muestra.push({ agenda: c.nombre, bolt: porPartner.get(id), via: 'partner_uuid' });
    } else {
      mNone++;
      if (sinMatch.length < 15) sinMatch.push({ nombre: c.nombre, idBolt: id });
    }
  });

  const resultado = {
    agendaTotal: agenda.length,
    conIdBolt: conId.length,
    sinIdBolt: agenda.length - conId.length,
    driversEnBolt: porUuid.size,
    casanPorDriverUuid: mUuid,
    casanPorPartnerUuid: mPartner,
    sinCasar: mNone,
    muestraCasan: muestra,
    muestraSinCasar: sinMatch
  };

  console.log(`🔗 [Conductores] ID_BOLT: ${mUuid} por driver_uuid, ${mPartner} por partner_uuid, ` +
    `${mNone} sin casar (de ${conId.length} con ID, ${agenda.length - conId.length} sin ID)`);
  return resultado;
}

// Normaliza para detectar duplicados: sin tildes, sin comas/paréntesis,
// espacios colapsados, minúsculas.
function normNombre(n) {
  return (n || '').toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

/**
 * Audita AGENDA_V2: duplicados por ID_BOLT, duplicados por nombre y quién no
 * tiene ID_BOLT. Cada entrada trae la fila real de la hoja. No escribe nada.
 */
async function auditarAgenda() {
  const tablero = await leerTablero();
  const agenda = (tablero && tablero.conductores) || [];

  const porId = new Map();
  const porNombre = new Map();
  const sinId = [];

  agenda.forEach(c => {
    const id = (c.idBolt || '').toString().trim();
    const nom = normNombre(c.nombre);

    if (id) {
      if (!porId.has(id)) porId.set(id, []);
      porId.get(id).push({ fila: c.fila, nombre: c.nombre });
    } else {
      sinId.push({ fila: c.fila, nombre: c.nombre || '(sin nombre)' });
    }

    if (nom) {
      if (!porNombre.has(nom)) porNombre.set(nom, []);
      porNombre.get(nom).push({ fila: c.fila, nombre: c.nombre, idBolt: id || '' });
    }
  });

  const duplicadosPorIdBolt = [...porId.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([id, v]) => ({ idBolt: id, filas: v.map(x => x.fila), nombres: v.map(x => x.nombre) }));

  const duplicadosPorNombre = [...porNombre.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([, v]) => ({
      nombre: v[0].nombre,
      filas: v.map(x => x.fila),
      idsBolt: v.map(x => x.idBolt || '(vacío)')
    }));

  const resultado = {
    total: agenda.length,
    conIdBolt: agenda.length - sinId.length,
    sinIdBolt: sinId.length,
    duplicadosPorIdBolt,
    duplicadosPorNombre,
    listaSinIdBolt: sinId.sort((a, b) => a.fila - b.fila)
  };

  console.log(`🧹 [Conductores] AGENDA_V2: ${agenda.length} filas · ${sinId.length} sin ID · ` +
    `${duplicadosPorIdBolt.length} IDs repetidos · ${duplicadosPorNombre.length} nombres repetidos`);
  return resultado;
}

module.exports = { verificarIdBolt, auditarAgenda };
