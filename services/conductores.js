// ============================================================
// CONDUCTORES: módulo de control (en construcción)
// ============================================================
// Maestro = AGENDA_V2 (planificador). De aquí salen los conductores, su turno,
// su libranza y su matrícula.
//
// Identidad: la columna ID_BOLT NO es un UUID, es el NOMBRE tal como lo muestra
// Bolt (lo que Bolt devuelve al dar de alta). Las horas de Bolt también vienen
// con ese nombre, así que el cruce se hace por ID_BOLT normalizado, y de paso se
// resuelve el driver_uuid real de cada uno.

const { leerTablero } = require('./planificadorV2');
const { CONFIG_BOLT, fetchRangoCompleto } = require('./bolt');

// Clave de comparación de nombres: sin tildes, en minúsculas, sin signos y con
// los tokens ordenados (así "Juan Ruiz Cano" == "Cano Juan Ruiz"). Los nombres
// de Bolt y los de ID_BOLT están en el mismo orden, pero ordenar da margen ante
// pequeñas reordenaciones.
function normClave(n) {
  return (n || '').toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
}

// Igual pero sin ordenar tokens: sirve para detectar duplicados evidentes.
function normNombre(n) {
  return (n || '').toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[,()]/g, ' ').replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

// Trae todos los conductores de Bolt (getDrivers filtra por fecha de alta, así
// que se pide una ventana ancha). Devuelve un mapa normClave(nombre) -> [uuids].
async function cargarDriversBolt() {
  const finTs = Math.floor(Date.now() / 1000);
  const iniTs = finTs - 3 * 365 * 86400;
  const porNombre = new Map();
  const nombrePorUuid = new Map();

  for (const f of CONFIG_BOLT.flotas) {
    const drivers = await fetchRangoCompleto(
      '/fleetIntegration/v1/getDrivers', { company_id: f.id },
      'drivers', iniTs, finTs, 1000, 'drivers-' + f.id
    );
    drivers.forEach(d => {
      const nombre = `${d.first_name || ''} ${d.last_name || ''}`.trim();
      const uuid = d.driver_uuid ? String(d.driver_uuid) : null;
      if (!uuid) return;
      nombrePorUuid.set(uuid, nombre);
      const clave = normClave(nombre);
      if (!clave) return;
      if (!porNombre.has(clave)) porNombre.set(clave, []);
      if (!porNombre.get(clave).includes(uuid)) porNombre.get(clave).push(uuid);
    });
  }
  return { porNombre, nombrePorUuid, total: nombrePorUuid.size };
}

/**
 * Cruza el ID_BOLT (nombre de Bolt) de AGENDA_V2 contra los conductores reales
 * de la API de Bolt, por nombre normalizado. Reporta cuántos resuelven a un
 * único conductor de Bolt (y su uuid), cuántos son ambiguos y cuántos no casan.
 * No escribe nada.
 */
async function verificarIdBolt() {
  const tablero = await leerTablero();
  const agenda = (tablero && tablero.conductores) || [];
  const conId = agenda.filter(c => (c.idBolt || '').toString().trim());

  const bolt = await cargarDriversBolt();

  let unico = 0, ambiguo = 0, cero = 0;
  const muestraResueltos = [];
  const muestraAmbiguos = [];
  const muestraSinCasar = [];

  conId.forEach(c => {
    const clave = normClave(c.idBolt);
    const uuids = bolt.porNombre.get(clave) || [];
    if (uuids.length === 1) {
      unico++;
      if (muestraResueltos.length < 8) {
        muestraResueltos.push({ idBolt: c.idBolt, uuid: uuids[0], bolt: bolt.nombrePorUuid.get(uuids[0]) });
      }
    } else if (uuids.length > 1) {
      ambiguo++;
      if (muestraAmbiguos.length < 8) muestraAmbiguos.push({ idBolt: c.idBolt, uuids });
    } else {
      cero++;
      if (muestraSinCasar.length < 20) muestraSinCasar.push({ nombre: c.nombre, idBolt: c.idBolt });
    }
  });

  const resultado = {
    agendaTotal: agenda.length,
    conIdBolt: conId.length,
    sinIdBolt: agenda.length - conId.length,
    driversEnBolt: bolt.total,
    casanUnico: unico,
    ambiguos: ambiguo,
    sinCasar: cero,
    muestraResueltos,
    muestraAmbiguos,
    muestraSinCasar
  };

  console.log(`🔗 [Conductores] Por nombre (ID_BOLT): ${unico} únicos, ${ambiguo} ambiguos, ` +
    `${cero} sin casar (de ${conId.length} con ID_BOLT)`);
  return resultado;
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
