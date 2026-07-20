const { CONFIG_BOLT, fetchAllPaginated, fetchRangoCompleto, sleep } = require('./bolt');
const { readSheet, writeSheet, clearSheet, ensureSheet } = require('./sheets');
const { SPREADSHEET_ID, normalizarNombre, leerTurnos, leerPostMortem, buscarEnDiccionario } = require('./turnos');

const HOJA_MES_ACTUAL = 'TODAS_LAS_FLOTAS';

const MAPEO_ESTADOS_BOLT = {
  'active': 'activo',
  'suspended': 'inactivo',
  'deactivated': 'despedido'
};
const STATE_VIAJE = ['has_order', 'waiting_orders'];
const META_SEGUNDOS = CONFIG_BOLT.metaDiariaHoras * 3600;

// Al fusionar flotas nos quedamos con el estado más "vivo" del conductor.
const PRIORIDAD_ESTADO = { despedido: 0, inactivo: 1, activo: 2 };

/**
 * Mínimo y máximo de un array recorriéndolo, no con Math.min(...array): un mes
 * real trae más de 130.000 logs y el spread los pasa como argumentos de la
 * llamada, lo que desborda la pila ("Maximum call stack size exceeded").
 */
function minMax(valores) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < valores.length; i++) {
    const v = valores[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

// ============================================================
// PROCESAR Y UNIFICAR
// ============================================================
async function procesarYUnificar(mes, ano, opciones = {}) {
  const hojaDestino = opciones.hojaDestino || HOJA_MES_ACTUAL;
  const pausaMs = opciones.pausaMs;
  const incluirTodos = opciones.incluirTodos === true;
  // El dinero (propinas, peajes, neto) solo se saca en el histórico.
  const incluirDinero = opciones.modoHistorico === true;

  const turnosDB = await leerTurnos();
  const postMortem = await leerPostMortem();

  const todosConductores = {};

  // El mes en curso sigue usando exactamente la lógica de siempre; solo el
  // histórico estrena el camino de "logs primero, nombres después".
  const calcular = opciones.modoHistorico
    ? calcularHorasFlotaHistorico
    : calcularHorasFlota;

  for (const flota of CONFIG_BOLT.flotas) {
    const datos = await calcular(flota.id, mes, ano, turnosDB, postMortem, { pausaMs });

    Object.entries(datos.horas).forEach(([nombre, diasObj]) => {
      const info = datos.infoConductores[nombre] || {};

      if (!todosConductores[nombre]) {
        todosConductores[nombre] = {
          turno: info.turno || '?',
          estado: info.estado || 'activo',
          horasNocturnas: 0
        };
        for (let d = 1; d <= datos.diasDelMes; d++) {
          todosConductores[nombre][d] = 0;
        }
      } else {
        // El conductor aparece en más de una flota. La 63530 está cerrada, así
        // que sus conductores figuran como dados de baja en Bolt: si nos
        // quedáramos con el primer estado que llega, marcaríamos como
        // despedido a quien sigue trabajando en la 143626. Nos quedamos con el
        // estado más activo de todas las flotas.
        const acumulado = todosConductores[nombre];
        if (PRIORIDAD_ESTADO[info.estado] > PRIORIDAD_ESTADO[acumulado.estado]) {
          acumulado.estado = info.estado;
        }
        if (acumulado.turno === '?' && info.turno && info.turno !== '?') {
          acumulado.turno = info.turno;
        }
      }

      Object.entries(diasObj).forEach(([dia, segundos]) => {
        const diaNum = parseInt(dia);
        if (todosConductores[nombre][diaNum] !== undefined) {
          todosConductores[nombre][diaNum] += segundos;
        }
      });
    });

    if (datos.horasNocturnas) {
      Object.entries(datos.horasNocturnas).forEach(([nombre, segundos]) => {
        if (todosConductores[nombre]) {
          todosConductores[nombre].horasNocturnas += segundos;
        }
      });
    }

    // Propinas, peajes y neto: se suman entre flotas igual que las horas.
    // Un conductor puede facturar sin tener state logs, así que si no existe
    // la fila todavía se crea aquí.
    if (datos.dinero) {
      Object.entries(datos.dinero).forEach(([nombre, d]) => {
        if (!todosConductores[nombre]) {
          todosConductores[nombre] = {
            turno: datos.infoConductores[nombre]?.turno || '?',
            estado: datos.infoConductores[nombre]?.estado || 'activo',
            horasNocturnas: 0
          };
          for (let dia = 1; dia <= datos.diasDelMes; dia++) {
            todosConductores[nombre][dia] = 0;
          }
        }
        const acc = todosConductores[nombre];
        acc.propinas = (acc.propinas || 0) + d.propinas;
        acc.peajes = (acc.peajes || 0) + d.peajes;
        acc.neto = (acc.neto || 0) + d.neto;
        acc.viajes = (acc.viajes || 0) + d.viajes;
      });
    }
  }

  await escribirHojaUnificada(todosConductores, mes, ano, hojaDestino, { incluirTodos, incluirDinero });
  console.log(`✅ Mes ${mes}/${ano} procesado → hoja "${hojaDestino}"`);
  return {
    status: 'ok',
    mes,
    ano,
    hoja: hojaDestino,
    conductores: Object.keys(todosConductores).length
  };
}

// ============================================================
// CALCULAR HORAS FLOTA — MODO HISTÓRICO
// ============================================================
// Camino aparte del mes en curso, que funciona bien y no se toca.
//
// Aquí el orden se invierte: primero se traen TODOS los state logs del mes y
// se agrupan por driver_uuid, y solo después se les pone nombre. El motivo es
// que getDrivers filtra por fecha de ALTA del conductor, no por actividad
// ("find drivers which created time is after this timestamp"), así que pedirlo
// con el rango del mes solo devuelve a quienes se dieron de alta ese mes. Al
// usar esa lista para decidir qué logs valían, se descartaban meses enteros.
//
// Ningún log se tira: si no se logra averiguar el nombre, el conductor sale
// identificado por su uuid antes que perder sus horas.

// Los nombres no cambian entre meses, así que se piden una vez por flota y se
// reutilizan durante toda la pasada del histórico.
const cacheDrivers = new Map();
const TTL_CACHE_DRIVERS_MS = 6 * 60 * 60 * 1000;

function limpiarCacheDrivers() {
  cacheDrivers.clear();
}

/**
 * Diccionario uuid → { nombre, estado } lo más completo posible. Se pide con
 * la ventana más ancha que admite la API (16 meses) en vez de con el mes
 * concreto, para que entren también los conductores dados de alta hace tiempo.
 */
function getPadron(companyId) {
  const enCache = cacheDrivers.get(companyId);
  if (enCache && Date.now() - enCache.ts < TTL_CACHE_DRIVERS_MS) return enCache.mapa;
  const mapa = {};
  cacheDrivers.set(companyId, { ts: Date.now(), mapa });
  return mapa;
}

/** Vuelca una tanda de getDrivers en el padrón acumulado. */
function volcarDrivers(mapa, drivers) {
  let nuevos = 0;
  drivers.forEach(d => {
    if (!d.driver_uuid || mapa[d.driver_uuid]) return;
    const nombre = ((d.first_name || '') + ' ' + (d.last_name || '')).trim();
    if (!nombre) return;
    mapa[d.driver_uuid] = {
      nombre,
      estado: MAPEO_ESTADOS_BOLT[d.state || 'active'] || 'activo'
    };
    nuevos++;
  });
  return nuevos;
}

/**
 * Construye el diccionario uuid → { nombre, estado } para los conductores que
 * han tenido actividad este mes. Como getDrivers filtra por fecha de ALTA, un
 * solo rango nunca los cubre a todos, así que se combinan tres fuentes y se
 * acumulan entre meses:
 *   1. el rango del propio mes            → los dados de alta ese mes
 *   2. (acumulado de los meses ya procesados en esta misma pasada)
 *   3. getFleetOrders del mes             → driver_name viene en cada pedido,
 *                                            que es lo que rescata a los veteranos
 */
async function resolverNombres(companyId, mes, ano, uuidsNecesarios, etiqueta, pausaMs, ordenes) {
  const mapa = getPadron(companyId);
  const faltan = () => [...uuidsNecesarios].filter(u => !mapa[u]);

  const diasDelMes = new Date(ano, mes, 0).getDate();
  const startTs = Math.floor(new Date(ano, mes - 1, 1, 0, 0, 0).getTime() / 1000);
  const endTs = Math.floor(new Date(ano, mes - 1, diasDelMes, 23, 59, 59).getTime() / 1000);

  // 1. Altas del propio mes. No se pide una ventana ancha de varios meses:
  //    getDrivers aplica el mismo límite de rango que el resto de endpoints y
  //    responde 498806 INVALID_DATE_RANGE. El padrón se acumula mes a mes.
  if (faltan().length > 0) {
    const delMes = await fetchRangoCompleto(
      '/fleetIntegration/v1/getDrivers',
      { company_id: companyId }, 'drivers', startTs, endTs, 1000, etiqueta
    );
    console.log(`👥 [${etiqueta}] Padrón (altas del mes): +${volcarDrivers(mapa, delMes)} ` +
                `(acumulado: ${Object.keys(mapa).length})`);
    if (pausaMs) await sleep(pausaMs);
  }

  // 3. Los pedidos del mes traen driver_uuid y driver_name juntos
  let rescatados = 0;
  ordenes.forEach(o => {
    if (!o.driver_uuid || mapa[o.driver_uuid]) return;
    const nombre = (o.driver_name || '').trim();
    if (!nombre) return;
    mapa[o.driver_uuid] = { nombre, estado: 'activo' };
    rescatados++;
  });
  if (rescatados > 0 || faltan().length > 0) {
    console.log(`🔎 [${etiqueta}] Rescatados por pedidos: +${rescatados} ` +
                `(quedan ${faltan().length} sin nombre)`);
  }

  return mapa;
}

/**
 * Agrega propinas, peajes y facturación neta por conductor a partir de los
 * pedidos del mes. Los tres campos vienen dentro de `order_price` de cada
 * pedido, junto al driver_uuid, así que se agrupa por uuid igual que las horas.
 */
function agregarDineroPorUuid(ordenes) {
  const porUuid = {};

  ordenes.forEach(o => {
    const uuid = o.driver_uuid;
    if (!uuid) return;

    if (!porUuid[uuid]) {
      porUuid[uuid] = { propinas: 0, peajes: 0, neto: 0, viajes: 0 };
    }

    const p = o.order_price || {};
    porUuid[uuid].propinas += p.tip || 0;
    porUuid[uuid].peajes += p.toll_fee || 0;
    porUuid[uuid].neto += p.net_earnings || 0;
    if (o.order_status === 'finished') porUuid[uuid].viajes++;
  });

  return porUuid;
}

async function calcularHorasFlotaHistorico(companyId, mes, ano, turnosDB, postMortem, opciones = {}) {
  const pausaMs = opciones.pausaMs;
  const diasDelMes = new Date(ano, mes, 0).getDate();
  const startTs = Math.floor(new Date(ano, mes - 1, 1, 0, 0, 0).getTime() / 1000);
  const endTs = Math.floor(new Date(ano, mes - 1, diasDelMes, 23, 59, 59).getTime() / 1000);

  const tag = `${companyId} ${String(mes).padStart(2, '0')}/${ano}`;
  const fmt = ts => new Date(ts * 1000).toLocaleString('es-ES');
  console.log(`🔍 [${tag}] HISTÓRICO — rango: ${fmt(startTs)} → ${fmt(endTs)}`);

  const vacio = { horas: {}, horasNocturnas: {}, diasDelMes, diaLimite: diasDelMes, infoConductores: {} };

  try {
    // ---- 1. TODOS los state logs del mes ----
    const stateLogs = await fetchRangoCompleto(
      '/fleetIntegration/v1/getFleetStateLogs',
      { company_id: companyId }, 'state_logs', startTs, endTs, 1000, tag
    );

    const diagLogs = fetchAllPaginated.ultimoDiagnostico;
    console.log(`📄 [${tag}] ${stateLogs.length} logs de ${diagLogs.totalRows ?? '?'} ` +
                `(${diagLogs.paginas} pág., code=${diagLogs.codigoCuerpo}, corte: ${diagLogs.motivo})`);

    if (stateLogs.length === 0) {
      console.error(`❌ [${tag}] Sin logs: code=${diagLogs.codigoCuerpo} ` +
                    `message="${diagLogs.mensajeCuerpo}"`);
      return vacio;
    }

    const rango = minMax(stateLogs.map(l => l.created));
    console.log(`📅 [${tag}] Cobertura real: ${fmt(rango.min)} → ${fmt(rango.max)}`);

    // ---- 2. Agrupar por driver_uuid ----
    const logsByDriver = {};
    stateLogs.forEach(log => {
      const duuid = log.driver_uuid || 'sin-uuid';
      if (!logsByDriver[duuid]) logsByDriver[duuid] = [];
      logsByDriver[duuid].push(log);
    });
    console.log(`🚗 [${tag}] ${Object.keys(logsByDriver).length} conductores con actividad`);

    if (pausaMs) await sleep(pausaMs);

    // ---- 3. Pedidos del mes: dinero por conductor + nombres de rescate ----
    const ordenes = await fetchRangoCompleto(
      '/fleetIntegration/v1/getFleetOrders',
      { company_ids: [companyId], company_id: companyId, time_range_filter_type: 'created' },
      'orders', startTs, endTs, 1000, tag
    );

    const diagOrd = fetchAllPaginated.ultimoDiagnostico;
    console.log(`💶 [${tag}] ${ordenes.length} pedidos de ${diagOrd.totalRows ?? '?'} ` +
                `(${diagOrd.paginas} pág., code=${diagOrd.codigoCuerpo})`);

    const dineroPorUuid = agregarDineroPorUuid(ordenes);

    if (pausaMs) await sleep(pausaMs);

    // ---- 4. Ponerles nombre ----
    const padron = await resolverNombres(
      companyId, mes, ano, new Set(Object.keys(logsByDriver)), tag, pausaMs, ordenes
    );

    const dictPostMortem = {};
    postMortem.forEach(({ nombre, turno }) => {
      dictPostMortem[nombre.toLowerCase()] = { turno, estado: 'despedido' };
    });

    const horasPorConductor = {};
    const horasNocturnasPorConductor = {};
    const infoConductores = {};
    const dineroPorConductor = {};
    let sinNombre = 0;

    // El dinero se agrupa por uuid; aquí se pasa a nombre para poder cruzarlo
    // con las horas y con la otra flota.
    const nombreDeUuid = (uuid) =>
      padron[uuid] ? padron[uuid].nombre : `⚠️ UUID ${uuid.slice(0, 8)}`;

    Object.entries(dineroPorUuid).forEach(([uuid, d]) => {
      const nombre = nombreDeUuid(uuid);
      if (!dineroPorConductor[nombre]) {
        dineroPorConductor[nombre] = { propinas: 0, peajes: 0, neto: 0, viajes: 0 };
      }
      dineroPorConductor[nombre].propinas += d.propinas;
      dineroPorConductor[nombre].peajes += d.peajes;
      dineroPorConductor[nombre].neto += d.neto;
      dineroPorConductor[nombre].viajes += d.viajes;
    });

    Object.entries(logsByDriver).forEach(([duuid, logs]) => {
      const delPadron = padron[duuid];

      // Sin nombre no se descarta: se identifica por uuid para no perder horas.
      let nombreReal = delPadron ? delPadron.nombre : `⚠️ UUID ${duuid.slice(0, 8)}`;
      let estado = delPadron ? delPadron.estado : 'activo';
      if (!delPadron) sinNombre++;

      const infoTurno = buscarEnDiccionario(nombreReal, turnosDB);
      let turno = infoTurno ? infoTurno.turno : '?';

      const pm = buscarEnDiccionario(nombreReal, dictPostMortem);
      if (pm) {
        estado = 'despedido';
        if (turno === '?') turno = pm.turno;
      }

      infoConductores[nombreReal] = { turno, estado };

      if (!horasPorConductor[nombreReal]) {
        horasPorConductor[nombreReal] = {};
        for (let d = 1; d <= diasDelMes; d++) horasPorConductor[nombreReal][d] = 0;
        horasNocturnasPorConductor[nombreReal] = 0;
      }

      logs.sort((a, b) => a.created - b.created);

      for (let i = 0; i < logs.length; i++) {
        if (!STATE_VIAJE.includes(logs[i].state)) continue;
        const siguiente = logs[i + 1];
        if (!siguiente) continue;

        const inicio = logs[i].created;
        const fin = siguiente.created;
        if (fin - inicio <= 0) continue;

        if (turno === 'noche') {
          distribuirHorasTurnoNoche(horasPorConductor[nombreReal], inicio, fin);
        } else {
          distribuirHorasTurnoDia(horasPorConductor[nombreReal], inicio, fin);
        }

        horasNocturnasPorConductor[nombreReal] += calcularSegundosNocturnosEnIntervalo(inicio, fin);
      }
    });

    if (sinNombre > 0) {
      console.log(`⚠️  [${tag}] ${sinNombre} conductores sin nombre en el padrón: ` +
                  `salen identificados por uuid, con sus horas intactas`);
    }

    // ---- 4. Resumen de cobertura ----
    const diasConHoras = [];
    for (let d = 1; d <= diasDelMes; d++) {
      const total = Object.values(horasPorConductor).reduce((s, dias) => s + (dias[d] || 0), 0);
      if (total > 0) diasConHoras.push(d);
    }

    if (diasConHoras.length === 0) {
      console.error(`❌ [${tag}] RESULTADO: 0 horas en todo el mes`);
    } else {
      console.log(`📊 [${tag}] RESULTADO: días ${diasConHoras[0]}–` +
                  `${diasConHoras[diasConHoras.length - 1]} ` +
                  `(${diasConHoras.length}/${diasDelMes} con horas)`);
      if (diasConHoras[0] > 1) {
        console.error(`❌ [${tag}] Los días 1–${diasConHoras[0] - 1} salen a cero`);
      }
    }

    const totalNeto = Object.values(dineroPorConductor).reduce((s, d) => s + d.neto, 0);
    console.log(`💶 [${tag}] Facturación neta del mes: ${totalNeto.toFixed(2)} €`);

    return {
      horas: horasPorConductor,
      horasNocturnas: horasNocturnasPorConductor,
      dinero: dineroPorConductor,
      diasDelMes,
      diaLimite: diasDelMes,
      infoConductores
    };

  } catch (error) {
    console.error(`❌ [${tag}] EXCEPCIÓN: ${error.message}`);
    console.error(error.stack);
    return vacio;
  }
}

// ============================================================
// CALCULAR HORAS FLOTA
// ============================================================
async function calcularHorasFlota(companyId, mes, ano, turnosDB, postMortem, opciones = {}) {
  const pausaMs = opciones.pausaMs;
  const ahora = new Date();
  const diasDelMes = new Date(ano, mes, 0).getDate();
  const diaLimite = (mes === ahora.getMonth() + 1 && ano === ahora.getFullYear())
    ? ahora.getDate() : diasDelMes;

  const startTs = Math.floor(new Date(ano, mes - 1, 1, 0, 0, 0).getTime() / 1000);
  let endTs = Math.floor(new Date(ano, mes - 1, diasDelMes, 23, 59, 59).getTime() / 1000);

  if (mes === ahora.getMonth() + 1 && ano === ahora.getFullYear()) {
    endTs = Math.floor(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59).getTime() / 1000);
  }

  // Etiqueta para poder seguir en los logs qué flota y qué mes falla.
  const tag = `${companyId} ${String(mes).padStart(2, '0')}/${ano}`;
  const fmt = ts => new Date(ts * 1000).toLocaleString('es-ES');
  console.log(`🔍 [${tag}] Rango pedido: ${fmt(startTs)} → ${fmt(endTs)}`);

  try {
    // Una única consulta por mes, igual que en el mes en curso. Trocear el
    // rango en bloques hacía que se perdieran los datos de todos los días
    // menos los del último bloque.
    const drivers = await fetchAllPaginated('/fleetIntegration/v1/getDrivers', {
      company_id: companyId, start_ts: startTs, end_ts: endTs
    }, 'drivers', 1000, tag);

    const diagDrivers = fetchAllPaginated.ultimoDiagnostico;
    console.log(`👥 [${tag}] getDrivers: ${drivers.length} conductores ` +
                `(${diagDrivers.paginas} pág., corte: ${diagDrivers.motivo})`);
    if (drivers.length === 0) {
      console.error(`❌ [${tag}] getDrivers NO devolvió conductores: ` +
                    `todas las horas de este mes se perderán`);
    }

    if (pausaMs) await sleep(pausaMs);

    const driverInfo = {};

    drivers.forEach(d => {
      if (!d.driver_uuid) return;
      const nombreReal = (d.first_name + ' ' + d.last_name).trim();
      const estadoBolt = d.state || 'active';
      const infoTurno = buscarEnDiccionario(nombreReal, turnosDB);

      driverInfo[d.driver_uuid] = {
        nombre: nombreReal,
        estado: MAPEO_ESTADOS_BOLT[estadoBolt] || 'activo',
        turno: infoTurno ? infoTurno.turno : '?'
      };
    });

    const dictPostMortem = {};
    postMortem.forEach(({ nombre, turno }) => {
      dictPostMortem[nombre.toLowerCase()] = { turno, estado: 'despedido' };
    });

    Object.entries(driverInfo).forEach(([uuid, info]) => {
      const pmInfo = buscarEnDiccionario(info.nombre, dictPostMortem);
      if (pmInfo) {
        info.estado = 'despedido';
        if (info.turno === '?') info.turno = pmInfo.turno;
      }
    });

    postMortem.forEach(({ nombre, turno }) => {
      const existeEnAPI = Object.values(driverInfo).some(d =>
        d.nombre.toLowerCase() === nombre.toLowerCase()
      );
      if (!existeEnAPI) {
        const uuidFicticio = 'pm_' + nombre.toLowerCase().replace(/[^a-z0-9]/g, '_');
        driverInfo[uuidFicticio] = {
          nombre: nombre,
          estado: 'despedido',
          turno: turno || '?'
        };
      }
    });

    const stateLogs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs', {
      company_id: companyId, start_ts: startTs, end_ts: endTs
    }, 'state_logs', 1000, tag);

    const diagLogs = fetchAllPaginated.ultimoDiagnostico;
    console.log(`📄 [${tag}] getFleetStateLogs: ${stateLogs.length} logs ` +
                `(${diagLogs.paginas} pág., corte: ${diagLogs.motivo})`);

    // Cobertura real: si la API devuelve del más nuevo al más viejo y se corta
    // la paginación, aquí se ve porque el primer log recibido no es del día 1.
    if (stateLogs.length > 0) {
      const { min: minTs, max: maxTs } = minMax(stateLogs.map(l => l.created));
      console.log(`📅 [${tag}] Logs recibidos: ${fmt(minTs)} → ${fmt(maxTs)}`);

      const diaPrimero = new Date(minTs * 1000).getDate();
      const faltanDiasIniciales = minTs > startTs + 86400;
      if (faltanDiasIniciales) {
        console.error(`❌ [${tag}] FALTAN LOS PRIMEROS DÍAS: el log más antiguo es ` +
                      `del día ${diaPrimero}, pero el mes empieza el 1. ` +
                      `Probable corte de paginación (motivo: ${diagLogs.motivo})`);
      }
    } else {
      console.error(`❌ [${tag}] getFleetStateLogs NO devolvió ningún log`);
    }

    const logsByDriver = {};
    stateLogs.forEach(log => {
      const duuid = log.driver_uuid || 'unknown';
      if (!logsByDriver[duuid]) logsByDriver[duuid] = [];
      logsByDriver[duuid].push(log);
    });

    const horasPorConductor = {};
    const horasNocturnasPorConductor = {};
    const infoConductores = {};

    let logsDescartados = 0;
    const uuidsDesconocidos = new Set();

    Object.entries(logsByDriver).forEach(([duuid, logs]) => {
      let info = driverInfo[duuid];

      if (!info) {
        // El conductor tiene actividad pero no vino en getDrivers, que filtra
        // por fecha de alta y no por actividad. Antes se descartaban todos sus
        // logs y desaparecía de la hoja; ahora sale identificado por su uuid
        // con las horas intactas, que es preferible a perderlas.
        logsDescartados += logs.length;
        uuidsDesconocidos.add(duuid);
        info = {
          nombre: `⚠️ UUID ${duuid.slice(0, 8)}`,
          estado: 'activo',
          turno: '?'
        };
      }

      const nombreReal = info.nombre;
      const turno = info.turno;
      const estado = info.estado;

      infoConductores[nombreReal] = { turno, estado };

      if (!horasPorConductor[nombreReal]) {
        horasPorConductor[nombreReal] = {};
        for (let d = 1; d <= diasDelMes; d++) {
          horasPorConductor[nombreReal][d] = 0;
        }
      }

      if (!horasNocturnasPorConductor[nombreReal]) {
        horasNocturnasPorConductor[nombreReal] = 0;
      }

      logs.sort((a, b) => a.created - b.created);

      for (let i = 0; i < logs.length; i++) {
        const logActual = logs[i];
        if (!STATE_VIAJE.includes(logActual.state)) continue;

        let siguienteLog = logs[i + 1];
        if (!siguienteLog) continue;

        const inicioIntervalo = logActual.created;
        const finIntervalo = siguienteLog.created;
        const duracion = finIntervalo - inicioIntervalo;
        if (duracion <= 0) continue;

        if (turno === 'noche') {
          distribuirHorasTurnoNoche(horasPorConductor[nombreReal], inicioIntervalo, finIntervalo);
        } else {
          distribuirHorasTurnoDia(horasPorConductor[nombreReal], inicioIntervalo, finIntervalo);
        }

        // Las nocturnas se calculan siempre para todo el mundo. Quién las ve
        // reflejadas se decide al escribir la hoja, con el estado ya fusionado
        // entre flotas: el histórico las muestra a todos y el mes en curso
        // deja a los despedidos en "N/A".
        const segNocturnos = calcularSegundosNocturnosEnIntervalo(inicioIntervalo, finIntervalo);
        horasNocturnasPorConductor[nombreReal] += segNocturnos;
      }
    });

    if (logsDescartados > 0) {
      console.log(
        `⚠️  [${tag}] ${logsDescartados} logs de ${uuidsDesconocidos.size} conductores ` +
        `que no vinieron en getDrivers: salen identificados por uuid, con sus horas contadas`
      );
    }

    // Resumen de cobertura: qué días acabaron con horas y cuáles a cero.
    const diasConHoras = [];
    for (let d = 1; d <= diasDelMes; d++) {
      const total = Object.values(horasPorConductor)
        .reduce((sum, dias) => sum + (dias[d] || 0), 0);
      if (total > 0) diasConHoras.push(d);
    }

    if (diasConHoras.length === 0) {
      console.error(`❌ [${tag}] RESULTADO: 0 horas en TODO el mes`);
    } else {
      const aCero = diasDelMes - diasConHoras.length;
      console.log(
        `📊 [${tag}] RESULTADO: días con horas ${diasConHoras[0]}–` +
        `${diasConHoras[diasConHoras.length - 1]} ` +
        `(${diasConHoras.length}/${diasDelMes}, ${aCero} a cero)`
      );
      if (diasConHoras[0] > 1) {
        console.error(`❌ [${tag}] Los días 1–${diasConHoras[0] - 1} salen a cero`);
      }
    }

    Object.entries(driverInfo).forEach(([duuid, info]) => {
      if (!horasPorConductor[info.nombre]) {
        infoConductores[info.nombre] = { turno: info.turno, estado: info.estado };
        horasPorConductor[info.nombre] = {};
        for (let d = 1; d <= diasDelMes; d++) {
          horasPorConductor[info.nombre][d] = 0;
        }
        horasNocturnasPorConductor[info.nombre] = 0;
      }
    });

    return {
      horas: horasPorConductor,
      horasNocturnas: horasNocturnasPorConductor,
      diasDelMes,
      diaLimite,
      infoConductores
    };

  } catch (error) {
    console.error(`❌ [${tag}] EXCEPCIÓN: ${error.message}`);
    console.error(error.stack);
    return { horas: {}, horasNocturnas: {}, diasDelMes, diaLimite, infoConductores: {} };
  }
}

// ============================================================
// CÁLCULOS DE HORAS
// ============================================================
function calcularSegundosNocturnosEnIntervalo(inicio, fin) {
  let totalNocturno = 0;
  let cts = inicio;

  while (cts < fin) {
    const fecha = new Date(cts * 1000);
    const hora = fecha.getHours();
    const dia = fecha.getDate();
    const mes = fecha.getMonth();
    const ano = fecha.getFullYear();

    let finBloque;
    if (hora >= 22) {
      finBloque = new Date(ano, mes, dia + 1, 6, 0, 0).getTime() / 1000;
    } else if (hora < 6) {
      finBloque = new Date(ano, mes, dia, 6, 0, 0).getTime() / 1000;
    } else {
      finBloque = new Date(ano, mes, dia, 22, 0, 0).getTime() / 1000;
    }

    const endSegment = Math.min(finBloque, fin);
    if (hora >= 22 || hora < 6) {
      const seg = endSegment - cts;
      if (seg > 0) totalNocturno += seg;
    }
    cts = endSegment;
  }

  return totalNocturno;
}

function distribuirHorasTurnoDia(horasConductor, inicio, fin) {
  let cts = inicio;
  while (cts < fin) {
    const fecha = new Date(cts * 1000);
    const dia = fecha.getDate();
    const midnight = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 1).getTime() / 1000;
    const endSegment = Math.min(midnight, fin);
    const seg = endSegment - cts;
    if (horasConductor[dia] !== undefined && seg > 0) {
      horasConductor[dia] += seg;
    }
    cts = endSegment;
  }
}

function distribuirHorasTurnoNoche(horasConductor, inicio, fin) {
  let cts = inicio;
  while (cts < fin) {
    const fecha = new Date(cts * 1000);
    const dia = fecha.getDate();
    const mes = fecha.getMonth();
    const ano = fecha.getFullYear();
    const mediodiaHoy = new Date(ano, mes, dia, 12, 0, 0).getTime() / 1000;
    const mediodiaManana = new Date(ano, mes, dia + 1, 12, 0, 0).getTime() / 1000;

    let diaAsignar, endSegment;
    if (cts >= mediodiaHoy && cts < mediodiaManana) {
      diaAsignar = dia;
      endSegment = Math.min(mediodiaManana, fin);
    } else if (cts < mediodiaHoy) {
      diaAsignar = dia - 1;
      endSegment = Math.min(mediodiaHoy, fin);
    } else {
      diaAsignar = dia + 1;
      const mediodiaPasado = new Date(ano, mes, dia + 2, 12, 0, 0).getTime() / 1000;
      endSegment = Math.min(mediodiaPasado, fin);
    }

    const seg = endSegment - cts;
    if (horasConductor[diaAsignar] !== undefined && seg > 0) {
      horasConductor[diaAsignar] += seg;
    }
    cts = endSegment;
  }
}

// ============================================================
// ESCRIBIR HOJA UNIFICADA
// ============================================================
async function escribirHojaUnificada(todosConductores, mes, ano, nombreHoja = HOJA_MES_ACTUAL, opciones = {}) {
  // En el histórico queremos el dato de todo el mundo, incluidos los
  // despedidos: sus horas nocturnas se muestran y suman igual que las del
  // resto. El filtro por estado solo aplica al seguimiento del mes en curso.
  const incluirTodos = opciones.incluirTodos === true;
  const incluirDinero = opciones.incluirDinero === true;
  const ahora = new Date();
  const diasDelMes = new Date(ano, mes, 0).getDate();
  const diaLimite = (mes === ahora.getMonth() + 1 && ano === ahora.getFullYear())
    ? ahora.getDate() : diasDelMes;

  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const nombreMes = mesesNombres[mes - 1];

  const values = [];
  values.push([`🚗 BOLT FLEET - ${nombreMes} ${ano} | Meta: ${CONFIG_BOLT.metaDiariaHoras}h/día | Procesado desde Render`]);

  const headers = ['Estado', 'Conductor', 'Turno'];
  for (let d = 1; d <= diasDelMes; d++) headers.push(d.toString());
  headers.push('TOTAL', '🌙 Noc', 'Días', 'Meta', 'Debe');
  // Las columnas de dinero van AL FINAL a propósito: cualquier fórmula que
  // apunte por posición a las anteriores (los VLOOKUP de la nómina) sigue
  // funcionando igual.
  if (incluirDinero) headers.push('Propinas €', 'Peajes €', 'Neto €', 'Viajes');
  values.push(headers);

  const activos = [], inactivos = [], despedidos = [];
  Object.entries(todosConductores).forEach(([nombre, data]) => {
    if (data.estado === 'despedido') despedidos.push([nombre, data]);
    else if (data.estado === 'inactivo') inactivos.push([nombre, data]);
    else activos.push([nombre, data]);
  });
  activos.sort((a, b) => a[0].localeCompare(b[0]));
  inactivos.sort((a, b) => a[0].localeCompare(b[0]));
  despedidos.sort((a, b) => a[0].localeCompare(b[0]));
  const todosOrdenados = [...activos, ...inactivos, ...despedidos];

  let granTotalSeg = 0, granTotalNocturno = 0, granDiasTrab = 0;
  let granPropinas = 0, granPeajes = 0, granNeto = 0, granViajes = 0;
  const totalesPorDia = new Array(diasDelMes + 1).fill(0);

  todosOrdenados.forEach(([nombre, data]) => {
    const turno = data.turno || '?';
    const estado = data.estado || 'activo';

    let estadoEmoji, estadoTexto;
    switch (estado) {
      case 'activo': estadoEmoji = '✅'; estadoTexto = 'Activo'; break;
      case 'inactivo': estadoEmoji = '💤'; estadoTexto = 'Suspendido'; break;
      case 'despedido': estadoEmoji = '⚰️'; estadoTexto = 'Despedido'; break;
      default: estadoEmoji = '❓'; estadoTexto = estado;
    }

    const emojiTurno = turno === 'noche' ? '🌙' : turno === 'dia' ? '☀️' : '❓';
    const textoTurno = turno === 'noche' ? 'Noche' : turno === 'dia' ? 'Día' : '?';

    const row = [estadoEmoji + ' ' + estadoTexto, nombre, emojiTurno + ' ' + textoTurno];
    let totalSeg = 0, diasTrabajados = 0;

    for (let d = 1; d <= diasDelMes; d++) {
      const segundosDia = data[d] || 0;
      if (d <= diaLimite) {
        totalSeg += segundosDia;
        totalesPorDia[d] += segundosDia;
        if (segundosDia > 3600) diasTrabajados++;
        row.push((segundosDia / 3600).toFixed(1));
      } else {
        row.push('');
      }
    }

    const horasNocturnas = data.horasNocturnas || 0;
    const metaMesSeg = diasTrabajados * META_SEGUNDOS;
    const diferenciaSeg = totalSeg - metaMesSeg;

    row.push((totalSeg / 3600).toFixed(1));
    row.push(!incluirTodos && estado === 'despedido' ? 'N/A' : (horasNocturnas / 3600).toFixed(1));
    row.push(diasTrabajados.toString());
    row.push((metaMesSeg / 3600).toFixed(1));
    row.push(diferenciaSeg === 0 ? '✓' : (diferenciaSeg / 3600).toFixed(1));

    if (incluirDinero) {
      row.push(
        (data.propinas || 0).toFixed(2),
        (data.peajes || 0).toFixed(2),
        (data.neto || 0).toFixed(2),
        (data.viajes || 0).toString()
      );
      granPropinas += data.propinas || 0;
      granPeajes += data.peajes || 0;
      granNeto += data.neto || 0;
      granViajes += data.viajes || 0;
    }

    values.push(row);

    granTotalSeg += totalSeg;
    if (incluirTodos || estado !== 'despedido') granTotalNocturno += horasNocturnas;
    granDiasTrab += diasTrabajados;
  });

  const metaTotal = granDiasTrab * META_SEGUNDOS;
  const debeTotal = Math.max(0, metaTotal - granTotalSeg);

  const totalRow = ['📊 TOTAL', '', ''];
  for (let d = 1; d <= diasDelMes; d++) {
    totalRow.push(d <= diaLimite ? (totalesPorDia[d] / 3600).toFixed(1) : '');
  }
  totalRow.push((granTotalSeg / 3600).toFixed(1));
  totalRow.push((granTotalNocturno / 3600).toFixed(1));
  totalRow.push(granDiasTrab.toString());
  totalRow.push((metaTotal / 3600).toFixed(1));
  totalRow.push(debeTotal > 0 ? '-' + (debeTotal / 3600).toFixed(1) : '✓');
  if (incluirDinero) {
    totalRow.push(
      granPropinas.toFixed(2),
      granPeajes.toFixed(2),
      granNeto.toFixed(2),
      granViajes.toString()
    );
  }

  values.push(totalRow);

  // El nombre va entrecomillado: en notación A1, "abril-2025!A1" sin comillas
  // se interpreta mal por el guion.
  const hojaRef = `'${nombreHoja.replace(/'/g, "''")}'`;

  await ensureSheet(SPREADSHEET_ID, nombreHoja);
  await clearSheet(SPREADSHEET_ID, `${hojaRef}!A:Z`);
  await writeSheet(SPREADSHEET_ID, `${hojaRef}!A1`, values);

  console.log(`✅ Hoja ${nombreHoja} actualizada: ${values.length} filas`);
}

// ============================================================
// VISOR EN VIVO - MÉTRICAS UNIFICADAS
// ============================================================

async function obtenerMetricasVisor() {
  const ahora = new Date();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const startTs = Math.floor(inicioMes.getTime() / 1000);
  const endTs = Math.floor(ahora.getTime() / 1000);

  const flotas = [63530, 143626];

  // 1. State logs de ambas flotas
  let allStateLogs = [];
  for (const flotaId of flotas) {
    const logs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs', {
      company_id: flotaId, start_ts: startTs, end_ts: endTs
    }, 'state_logs', 1000);
    // concat en vez de push(...logs): un mes real supera los 130.000 registros
    // y pasarlos como argumentos desbordaría la pila.
    allStateLogs = allStateLogs.concat(logs);
  }

  const logsPorDriver = {};
  allStateLogs.forEach(log => {
    const duuid = log.driver_uuid || 'unknown';
    if (!logsPorDriver[duuid]) logsPorDriver[duuid] = [];
    logsPorDriver[duuid].push(log);
  });

  let horasWaiting = 0;
  let horasHasOrder = 0;

  Object.values(logsPorDriver).forEach(logs => {
    logs.sort((a, b) => a.created - b.created);

    for (let i = 0; i < logs.length; i++) {
      const estado = logs[i].state;
      if (estado !== 'waiting_orders' && estado !== 'has_order') continue;

      const inicio = logs[i].created;
      const fin = (i < logs.length - 1) ? logs[i + 1].created : endTs;
      const duracion = fin - inicio;

      if (duracion > 0) {
        if (estado === 'waiting_orders') horasWaiting += duracion;
        else horasHasOrder += duracion;
      }
    }
  });

  // 2. Facturación de ambas flotas
  let facturacion = 0;
  for (const flotaId of flotas) {
    const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders', {
      company_ids: [flotaId], start_ts: startTs, end_ts: endTs,
      time_range_filter_type: 'created'
    }, 'orders', 500);

    ordenes.forEach(order => {
      if (order.order_price && order.order_price.net_earnings) {
        facturacion += order.order_price.net_earnings;
      }
    });
  }

  // 3. Calcular métricas
  const horasEfectivas = (horasWaiting + horasHasOrder) / 3600;
  const utilizacion = horasEfectivas > 0 ? ((horasHasOrder / 3600) / horasEfectivas) * 100 : 0;
  const eurosHora = horasEfectivas > 0 ? facturacion / (horasEfectivas) : 0;

  return {
    horasEfectivas: Math.round(horasEfectivas),
    horasEfectivasStr: Math.round(horasEfectivas) + ' h',
    utilizacion: Math.round(utilizacion),
    utilizacionStr: Math.round(utilizacion) + ' %',
    eurosHora: eurosHora.toFixed(2),
    eurosHoraStr: eurosHora.toFixed(2) + ' €/h',
    neto: facturacion.toFixed(2),
    netoStr: Number(facturacion).toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €',
    fecha: new Date().toLocaleString('es-ES')
  };
}

module.exports = { procesarYUnificar, obtenerMetricasVisor, limpiarCacheDrivers };