// ============================================================
// CONDUCTORES: módulo de control (en construcción)
// ============================================================
// Maestro = AGENDA_V2 (planificador). De aquí salen los conductores, su turno,
// su libranza y su matrícula. Las HORAS salen de la API de Bolt y se unen por
// ID_BOLT (no por nombre), para no repetir el desajuste de nombres.
//
// Este primer paso solo COMPRUEBA que ese join por ID es viable.

const { leerTablero } = require('./planificadorV2');
const { CONFIG_BOLT, fetchRangoCompleto } = require('./bolt');

/**
 * Cruza los ID_BOLT de AGENDA_V2 contra los conductores reales de la API de
 * Bolt. Dice cuántos casan por driver_uuid, por partner_uuid o por ninguno, y
 * muestra ejemplos con el nombre de cada lado (para ver que es la misma persona).
 * No escribe nada.
 */
async function verificarIdBolt() {
  // 1. Agenda
  const tablero = await leerTablero();
  const agenda = (tablero && tablero.conductores) || [];
  const conId = agenda.filter(c => (c.idBolt || '').toString().trim());

  // 2. Conductores de Bolt (ventana ancha: getDrivers filtra por fecha de alta)
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

  // 3. Cruce
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

module.exports = { verificarIdBolt };
