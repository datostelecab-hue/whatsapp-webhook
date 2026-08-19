const { CONFIG_BOLT, fetchAllPaginated, fetchRangoCompleto, sleep } = require('./bolt');
const { readSheet, writeSheet, clearSheet, ensureSheet } = require('./sheets');
const { SPREADSHEET_ID, normalizarNombre, leerTurnos, leerPostMortem, buscarEnDiccionario } = require('./turnos');

// Destino del MES EN CURSO. Antes se escribía TODAS_LAS_FLOTAS en el libro de horas
// y un IMPORTRANGE lo copiaba a Datos_API; ese espejo era el cuello de botella de la
// frescura (Google lo refresca cuando quiere, ~30 min) y se ha eliminado: ahora se
// escribe Datos_API directamente. OJO: el HISTÓRICO sigue en el libro de horas
// (hojas 'agosto-2026'…), que es de donde leen las nóminas — eso no se toca.
const HOJA_MES_ACTUAL = 'Datos_API';
const LIBRO_MES_ACTUAL = '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';   // GestionConductores

// Red de seguridad para la transición: con HORAS_HOJA_LEGADO=1 se sigue alimentando
// también la vieja TODAS_LAS_FLOTAS (3 llamadas más, irrelevantes para la cuota).
const HOJA_LEGADO = 'TODAS_LAS_FLOTAS';
const ESCRIBIR_LEGADO = process.env.HORAS_HOJA_LEGADO === '1';

const MAPEO_ESTADOS_BOLT = {
  'active': 'activo',
  'suspended': 'inactivo',
  'deactivated': 'despedido'
};
const STATE_VIAJE = ['has_order', 'waiting_orders'];
const META_SEGUNDOS = CONFIG_BOLT.metaDiariaHoras * 3600;

// Tope de duración de un tramo. La duración de un estado se deduce del hueco
// hasta el siguiente log, pero si la app deja de reportar sin pasar por
// 'inactive' ese hueco no es tiempo trabajado: Bolt cierra la sesión con la
// telemetría del móvil, que nosotros no vemos.
//
// El valor sale de contrastar el 20/07/2026 con el informe de Bolt, coche a
// coche: la espera legítima más larga medida fue de 4,54 h (7759-MCH, que Bolt
// contó casi entera) y el caso patológico más claro, 16,1 h (1096-MJY, al que
// Bolt contó 3,76 h de las 9,74 que medíamos). 6 h separa ambos con margen.
// Es un umbral empírico de UN día: si aparecen turnos legítimos más largos,
// súbelo; ningún valor reproduce a Bolt exactamente.
const MAX_TRAMO_SEG = 6 * 3600;

// Al fusionar flotas nos quedamos con el estado más "vivo" del conductor.
const PRIORIDAD_ESTADO = { despedido: 0, inactivo: 1, activo: 2 };

// Turno de la AGENDA_V2 (planificador) → código interno.
const MAP_TURNO_AGENDA = { 'Día': 'dia', 'Dia': 'dia', 'Noche': 'noche', 'TodoTurno': 'todoturno' };

// Hora (0-23) de corte del día operativo por turno. Día y Noche: el día va de las
// 5:00 a las 5:00, así el turno de noche (17:00→05:00) cae ENTERO en su día y
// cuadra con Bolt. TodoTurno: de 2:00 a 2:00. Desconocido: como día.
// Corte del "día operativo" (hora local a la que empieza el día contable de cada turno):
//   · dia = 0  → día natural, de 00:00 a 00:00 (medianoche a medianoche).
//   · noche = 12 → de mediodía a mediodía, para que la noche ENTERA (p.ej. 22:00→06:00)
//     caiga en un solo día operativo y no se parta a las 5:00.
//   · todoturno = 2 y el defecto (turno desconocido) = 5 se mantienen; revísalos si hace falta.
const CORTE_TURNO = { dia: 0, noche: 12, todoturno: 2 };
const CORTE_DEFECTO = 5;

// Orden de los logs para medir tramos. A IGUAL segundo, los estados que NO cuentan
// (busy, inactive) van DESPUÉS de los que sí (has_order, waiting_orders), para que
// un descanso que arranca en el mismo instante que un waiting_orders "gane" y no se
// lo trague el tramo. Bug real: Oswaldo 5/8 tenía a las 06:59:24 dos logs (busy y
// waiting_orders); al quedar el busy ANTES, el waiting_orders cogía como fin el
// siguiente waiting_orders (09:29:56) y sumaba 2h30m de descanso. Con este desempate
// el waiting_orders del mismo segundo cierra en el busy (0 s) y el descanso no cuenta.
function ordenarLogs(a, b) {
  return (a.created - b.created) ||
    ((STATE_VIAJE.includes(a.state) ? 0 : 1) - (STATE_VIAJE.includes(b.state) ? 0 : 1));
}

/**
 * Turno de cada conductor desde la agenda ACTUAL (AGENDA_V2, vía el planificador),
 * NO desde la vieja TurnosDB. La clave es el nombre de Bolt (ID_BOLT) normalizado,
 * para cruzarlo con los nombres que devuelve la API de Bolt.
 */
async function leerTurnosAgenda() {
  try {
    const { leerTablero } = require('./planificadorV2');
    const tablero = await leerTablero();
    const dict = {};
    ((tablero && tablero.conductores) || []).forEach(c => {
      const nombre = (c.idBolt || c.nombre || '').toString().trim();
      if (!nombre) return;
      dict[normalizarNombre(nombre).toLowerCase()] = {
        turno: MAP_TURNO_AGENDA[(c.turno || '').toString().trim()] || '?'
      };
    });
    console.log(`📋 Turnos desde la agenda (AGENDA_V2): ${Object.keys(dict).length}`);
    return dict;
  } catch (e) {
    console.error('Error leyendo turnos de la agenda:', e.message);
    return {};
  }
}

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

  const turnosDB = await leerTurnosAgenda();   // turnos desde AGENDA_V2 (no TurnosDB / "operaciones 1")
  const postMortem = [];                        // el postmortem se gestiona ahora en VISTA_FINAL

  const todosConductores = {};
  // Desglose por día en paralelo, para poder recalcular un día suelto después.
  const detalle = {};   // nombre -> { dias:{}, noc:{}, has:{}, wait:{} }
  const tocaDetalle = nombre => (detalle[nombre] = detalle[nombre] || { dias: {}, noc: {}, has: {}, wait: {} });

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
          horasNocturnas: 0,
          efectHas: 0, efectWait: 0
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

      // Mismo reparto, pero guardado por día: es lo que se recalcula luego.
      const det = tocaDetalle(nombre);
      det.turno = info.turno || det.turno || '?';
      det.estado = todosConductores[nombre].estado;
      const sumar = (dst, src) => Object.entries(src || {}).forEach(([d, v2]) => { dst[d] = (dst[d] || 0) + v2; });
      sumar(det.dias, diasObj);
      sumar(det.noc, (datos.nocPorDia || {})[nombre]);
      sumar(det.has, ((datos.efecPorDia || {})[nombre] || {}).has);
      sumar(det.wait, ((datos.efecPorDia || {})[nombre] || {}).wait);
    });

    if (datos.horasNocturnas) {
      Object.entries(datos.horasNocturnas).forEach(([nombre, segundos]) => {
        if (todosConductores[nombre]) {
          todosConductores[nombre].horasNocturnas += segundos;
        }
      });
    }

    // Utilización (has_order / waiting_orders): se suma entre flotas igual que las horas,
    // así un conductor que trabajó en las dos da su utilización combinada real del mes.
    if (datos.efectividad) {
      Object.entries(datos.efectividad).forEach(([nombre, e]) => {
        if (todosConductores[nombre]) {
          todosConductores[nombre].efectHas = (todosConductores[nombre].efectHas || 0) + e.has;
          todosConductores[nombre].efectWait = (todosConductores[nombre].efectWait || 0) + e.wait;
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
            horasNocturnas: 0,
            efectHas: 0, efectWait: 0
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

  // El mes en curso va a Datos_API (otro libro); cualquier destino explícito
  // (el histórico) se queda en el libro de horas, que es de donde lee la nómina.
  const libro = hojaDestino === HOJA_MES_ACTUAL ? LIBRO_MES_ACTUAL : undefined;
  const values = await escribirHojaUnificada(todosConductores, mes, ano, hojaDestino, { incluirTodos, incluirDinero, libro });

  // Transición: si se pide, la misma tabla se copia a la hoja vieja.
  if (ESCRIBIR_LEGADO && hojaDestino === HOJA_MES_ACTUAL) {
    try {
      await ensureSheet(SPREADSHEET_ID, HOJA_LEGADO);
      await clearSheet(SPREADSHEET_ID, `${HOJA_LEGADO}!A:BA`);
      await writeSheet(SPREADSHEET_ID, `${HOJA_LEGADO}!A1`, values);
      console.log(`↩️  Copia de cortesía en ${HOJA_LEGADO}`);
    } catch (e) { console.error(`⚠️  No se pudo copiar a ${HOJA_LEGADO}: ${e.message}`); }
  }
  // La pasada completa deja la caché lista para los refrescos incrementales.
  if (hojaDestino === HOJA_MES_ACTUAL && !opciones.modoHistorico) {
    Object.values(detalle).forEach(d => { d.dias = d.dias || {}; });
    _cache = { mes, ano, ts: Date.now(), conductores: detalle };
    console.log(`🗃️  Caché del mes lista: ${Object.keys(detalle).length} conductores`);
  }
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
    const efectividadPorConductor = {};   // nombre -> { has, wait } en segundos (para la utilización)
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
        efectividadPorConductor[nombreReal] = { has: 0, wait: 0 };
      }

      logs.sort(ordenarLogs);

      for (let i = 0; i < logs.length; i++) {
        if (!STATE_VIAJE.includes(logs[i].state)) continue;
        const siguiente = logs[i + 1];
        if (!siguiente) continue;

        const inicio = logs[i].created;
        const fin = siguiente.created;
        if (fin - inicio <= 0) continue;

        // Utilización: has_order vs waiting_orders (los dos únicos STATE_VIAJE).
        if (logs[i].state === 'has_order') efectividadPorConductor[nombreReal].has += (fin - inicio);
        else efectividadPorConductor[nombreReal].wait += (fin - inicio);

        distribuirHoras(horasPorConductor[nombreReal], inicio, fin,
          CORTE_TURNO[turno] !== undefined ? CORTE_TURNO[turno] : CORTE_DEFECTO,
          mes, ano);

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
      efectividad: efectividadPorConductor,
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

  // Ventana: por defecto el mes entero; el refresco incremental pasa una corta.
  // Se pide SIEMPRE algo más de lo que se va a aplicar, porque la duración de un
  // estado se deduce del hueco hasta el log siguiente: sin los logs previos, el
  // turno que arrancó antes de la ventana no existiría y el día saldría corto.
  const ventana = opciones.ventana || null;
  let startTs, endTs;
  if (ventana) {
    startTs = ventana.desdeTs;
    endTs = ventana.hastaTs;
  } else {
    startTs = Math.floor(new Date(ano, mes - 1, 1, 0, 0, 0).getTime() / 1000);
    endTs = Math.floor(new Date(ano, mes - 1, diasDelMes, 23, 59, 59).getTime() / 1000);
    if (mes === ahora.getMonth() + 1 && ano === ahora.getFullYear()) {
      endTs = Math.floor(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59).getTime() / 1000);
    }
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

    // En modo ventana la lectura alimenta una CACHÉ: si viene a medias, el día
    // se congelaría incompleto hasta la siguiente pasada completa. Mejor abortar
    // y dejar el dato anterior, que es viejo pero correcto. La pasada mensual no
    // hace esto a propósito: es la que repara, y escribir algo es mejor que nada.
    if (ventana) comprobarLecturaCompleta(`state logs ${tag}`);

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
    const efectividadPorConductor = {};   // nombre -> { has, wait } en segundos (para la utilización)
    const infoConductores = {};
    // Desglose POR DÍA de nocturnas y utilización. Es lo que permite recalcular
    // solo hoy+ayer sin tener que rehacer los totales del mes.
    const nocPorDia = {};                 // nombre -> { dia: seg }
    const efecPorDia = {};                // nombre -> { has: {dia:seg}, wait: {dia:seg} }

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
      if (!efectividadPorConductor[nombreReal]) {
        efectividadPorConductor[nombreReal] = { has: 0, wait: 0 };
      }
      if (!nocPorDia[nombreReal]) nocPorDia[nombreReal] = {};
      if (!efecPorDia[nombreReal]) efecPorDia[nombreReal] = { has: {}, wait: {} };

      logs.sort(ordenarLogs);

      for (let i = 0; i < logs.length; i++) {
        const logActual = logs[i];
        if (!STATE_VIAJE.includes(logActual.state)) continue;

        let siguienteLog = logs[i + 1];
        if (!siguienteLog) continue;

        const inicioIntervalo = logActual.created;
        const finIntervalo = siguienteLog.created;
        const duracion = finIntervalo - inicioIntervalo;
        if (duracion <= 0) continue;

        // Horas, nocturnas y utilización se reparten de una vez y por el MISMO
        // día operativo. Las nocturnas se calculan para todo el mundo: quién las
        // ve reflejadas se decide al escribir la hoja, con el estado ya fusionado
        // entre flotas (el histórico las muestra a todos y el mes en curso deja a
        // los despedidos en "N/A").
        distribuirHoras(horasPorConductor[nombreReal], inicioIntervalo, finIntervalo,
          CORTE_TURNO[turno] !== undefined ? CORTE_TURNO[turno] : CORTE_DEFECTO,
          mes, ano,
          { noc: nocPorDia[nombreReal], has: efecPorDia[nombreReal].has,
            wait: efecPorDia[nombreReal].wait, esHasOrder: logActual.state === 'has_order' });
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
        efectividadPorConductor[info.nombre] = { has: 0, wait: 0 };
      }
    });

    // Los totales del mes se DERIVAN del desglose diario, no se llevan aparte:
    // así no pueden desincronizarse cuando se recalcula un día suelto.
    const suma = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
    Object.keys(horasPorConductor).forEach(nombre => {
      horasNocturnasPorConductor[nombre] = suma(nocPorDia[nombre]);
      efectividadPorConductor[nombre] = {
        has: suma(efecPorDia[nombre] && efecPorDia[nombre].has),
        wait: suma(efecPorDia[nombre] && efecPorDia[nombre].wait)
      };
    });

    // En modo ventana solo valen los días que se van a aplicar: el resto de la
    // descarga era contexto para no cortar los turnos por el borde.
    if (ventana && ventana.dias) {
      const dentro = d => ventana.dias.includes(Number(d));
      const podar = obj => { Object.keys(obj).forEach(d => { if (!dentro(d)) delete obj[d]; }); };
      Object.keys(horasPorConductor).forEach(nombre => {
        podar(horasPorConductor[nombre]);
        if (nocPorDia[nombre]) podar(nocPorDia[nombre]);
        if (efecPorDia[nombre]) { podar(efecPorDia[nombre].has); podar(efecPorDia[nombre].wait); }
      });
    }

    return {
      horas: horasPorConductor,
      horasNocturnas: horasNocturnasPorConductor,
      efectividad: efectividadPorConductor,
      nocPorDia,
      efecPorDia,
      diasDelMes,
      diaLimite,
      infoConductores
    };

  } catch (error) {
    console.error(`❌ [${tag}] EXCEPCIÓN: ${error.message}`);
    console.error(error.stack);
    // En modo ventana el resultado alimenta la caché y luego se ESCRIBE la hoja.
    // Devolver un mes vacío aquí haría que el incremental pusiera los días a cero
    // y borrase datos buenos: hay que propagar para que la pasada se aborte entera
    // y quede el dato anterior. La pasada completa sigue tragándose el error a
    // propósito: es la que repara, y publicar algo es mejor que no publicar nada.
    if (opciones.ventana) throw error;
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

/**
 * Aborta si la última descarga de Bolt vino a medias. `fetchAllPaginated` devuelve
 * lo que llevara leído cuando algo falla (error HTTP, tope de páginas, timeout) sin
 * avisar al que llama: quien alimenta una caché TIENE que mirarlo, porque un día
 * guardado a medias se queda mal hasta que alguien lo repare a mano.
 * Mismo criterio que `comprobarCompleto` en auditoriaFlota.js.
 */
function comprobarLecturaCompleta(etiqueta) {
  const d = fetchAllPaginated.ultimoDiagnostico || {};
  if (d.motivo === 'error-http' || d.motivo === 'tope-paginas' || d.motivo === 'timeout') {
    throw new Error(`BOLT devolvió datos incompletos en ${etiqueta} (${d.motivo}${d.errorHttp ? ' HTTP ' + d.errorHttp : ''}): no se toca la caché`);
  }
  if (d.totalRows != null && d.registros != null && d.registros < d.totalRows) {
    throw new Error(`BOLT devolvió ${d.registros} de ${d.totalRows} registros en ${etiqueta}: no se toca la caché`);
  }
}

/**
 * Reparte un intervalo [inicio, fin] (epoch en s) entre días operativos según la
 * hora de `corte` del turno. El día operativo empieza a las `corte`:00, así que
 * todo lo trabajado entre las `corte`:00 de un día y las `corte`:00 del siguiente
 * cuenta para el PRIMER día. Un solo mecanismo para día, noche y todoturno.
 */
function distribuirHoras(horasConductor, inicio, fin, corte, mes, ano, extras) {
  let cts = inicio;
  while (cts < fin) {
    const f = new Date(cts * 1000);
    const y = f.getFullYear(), m = f.getMonth(), d = f.getDate();
    const antesDelCorte = f.getHours() < corte;
    const diaAsignar = antesDelCorte ? d - 1 : d;         // aún es el día operativo anterior
    const proximoCorte = new Date(y, m, antesDelCorte ? d : d + 1, corte, 0, 0).getTime() / 1000;
    const endSegment = Math.min(proximoCorte, fin);
    const seg = endSegment - cts;

    if (seg > 0) {
      // FECHA REAL del día operativo, no solo su número. `diaAsignar` puede ser 0
      // (= último día del mes anterior) y new Date lo normaliza solo. Sin esta
      // comprobación, un tramo del 30 de abril acabaría sumado en la columna
      // "día 30" de la hoja de MAYO en cuanto la ventana pedida cruce el mes
      // — que es justo lo que hace el cálculo incremental el día 1.
      const fDia = new Date(y, m, diaAsignar);
      if (fDia.getMonth() + 1 === mes && fDia.getFullYear() === ano) {
        const dia = fDia.getDate();
        horasConductor[dia] = (horasConductor[dia] || 0) + seg;
        if (extras) {
          // Nocturnas y utilización se reparten POR EL MISMO día operativo que las
          // horas: así el mes en curso puede recalcularse día a día sin recomponer
          // el total del mes, y ningún tramo de otro mes se cuela en los totales.
          const noc = calcularSegundosNocturnosEnIntervalo(cts, endSegment);
          if (noc > 0) extras.noc[dia] = (extras.noc[dia] || 0) + noc;
          const dest = extras.esHasOrder ? extras.has : extras.wait;
          dest[dia] = (dest[dia] || 0) + seg;
        }
      }
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
  // Utilización (has_order / horas efectivas) por conductor. Va la última, tras el
  // dinero, para no desplazar ninguna columna anterior. La nómina la lee por nombre.
  headers.push('% Efec');
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
  let granEfectHas = 0, granEfectWait = 0;
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

    const emojiTurno = turno === 'noche' ? '🌙' : turno === 'dia' ? '☀️' : turno === 'todoturno' ? '🔄' : '❓';
    const textoTurno = turno === 'noche' ? 'Noche' : turno === 'dia' ? 'Día' : turno === 'todoturno' ? 'TodoTurno' : '?';

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

    // % Efec del conductor: has_order / (has_order + waiting_orders). Vacío si no tiene
    // horas efectivas (no facturó ni esperó pedidos ese mes).
    const efSeg = (data.efectHas || 0) + (data.efectWait || 0);
    row.push(efSeg > 0 ? ((data.efectHas || 0) / efSeg * 100).toFixed(1) : '');
    granEfectHas += data.efectHas || 0;
    granEfectWait += data.efectWait || 0;

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
  const granEfSeg = granEfectHas + granEfectWait;
  totalRow.push(granEfSeg > 0 ? (granEfectHas / granEfSeg * 100).toFixed(1) : '');

  values.push(totalRow);

  // El nombre va entrecomillado: en notación A1, "abril-2025!A1" sin comillas
  // se interpreta mal por el guion.
  const hojaRef = `'${nombreHoja.replace(/'/g, "''")}'`;

  // El libro depende del destino: el mes en curso vive en GestionConductores
  // (Datos_API) y el histórico en el libro de horas. Por defecto, el de horas.
  const libro = opciones.libro || SPREADSHEET_ID;

  await ensureSheet(libro, nombreHoja);
  // Se limpia hasta BA (no solo A:Z): con 31 días + Debe + dinero + % Efec la fila llega
  // a la columna ~AS, y un A:Z dejaba basura de corridas anteriores en las columnas altas.
  await clearSheet(libro, `${hojaRef}!A:BA`);
  await writeSheet(libro, `${hojaRef}!A1`, values);

  console.log(`✅ Hoja ${nombreHoja} actualizada: ${values.length} filas`);
  return values;
}

// ============================================================
// REFRESCO INCREMENTAL DEL MES EN CURSO
// ============================================================
// Recalcular el mes entero cuesta cientos de peticiones a Bolt: a una por hora
// pasa, pero cada 10 minutos es inviable. La idea: el mes ya calculado hace de
// caché y cada pasada corta rehace SOLO los días que aún pueden moverse.
//
// Reglas que no son negociables (cada una es un fallo real evitado):
//  · Se piden 3 días de logs y se aplican 2. El día extra es contexto: la
//    duración de un estado sale del hueco hasta el log siguiente, así que sin
//    los logs anteriores el turno que arrancó antes de la ventana no existiría.
//  · Se ponen los días a CERO antes de sumar. Si no, dos pasadas seguidas
//    duplicarían las horas — hoy no pasa solo porque se reconstruye todo.
//  · Si Bolt devuelve una lectura a medias, se aborta sin tocar la caché.
//  · Si cambia el mes o el turno de alguien, se hace pasada completa: el turno
//    decide a qué día operativo va cada tramo, así que cambiarlo re-reparte el
//    MES ENTERO de esa persona, no solo desde el día del cambio.

let _cache = null;   // { mes, ano, ts, conductores: { nombre: {turno, estado, dias, noc, has, wait} } }

/** Días que aún pueden cambiar: ayer y hoy (por el corte de la noche, ayer sigue abierto). */
function diasVivos(ahora) {
  const hoy = ahora.getDate();
  const ayer = new Date(ahora.getFullYear(), ahora.getMonth(), hoy - 1);
  // Si ayer cayó en el mes anterior, solo se refresca hoy: los días del mes
  // pasado ya no se tocan (y su hoja es otra).
  return ayer.getMonth() === ahora.getMonth() ? [ayer.getDate(), hoy] : [hoy];
}

/** La caché, en la forma que espera escribirHojaUnificada. */
function tablaDesdeCache(cache) {
  const diasDelMes = new Date(cache.ano, cache.mes, 0).getDate();
  const suma = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const tabla = {};
  Object.entries(cache.conductores).forEach(([nombre, d]) => {
    const fila = {
      turno: d.turno || '?', estado: d.estado || 'activo',
      horasNocturnas: suma(d.noc), efectHas: suma(d.has), efectWait: suma(d.wait)
    };
    for (let x = 1; x <= diasDelMes; x++) fila[x] = d.dias[x] || 0;
    tabla[nombre] = fila;
  });
  return tabla;
}

/**
 * Refresca el mes en curso recalculando solo los días vivos. Si no hay caché
 * utilizable (arranque, cambio de mes, cambio de turno) hace pasada completa,
 * que además deja la caché lista para las siguientes.
 */
async function refrescarHorasIncremental() {
  const ahora = new Date();
  const mes = ahora.getMonth() + 1, ano = ahora.getFullYear();

  if (!_cache || _cache.mes !== mes || _cache.ano !== ano) {
    console.log('🔄 [Horas] Sin caché del mes en curso → pasada completa');
    const r = await procesarYUnificar(mes, ano);
    return { ...r, modo: 'completa', motivo: 'sin-cache' };
  }

  const dias = diasVivos(ahora);
  // Se pide un día más por delante como contexto (ver cabecera del bloque).
  const desdeTs = Math.floor(new Date(ano, mes - 1, dias[0] - 1, 0, 0, 0).getTime() / 1000);
  const hastaTs = Math.floor(ahora.getTime() / 1000);
  const turnosDB = await leerTurnosAgenda();

  const parciales = [];
  for (const flota of CONFIG_BOLT.flotas) {
    parciales.push(await calcularHorasFlota(flota.id, mes, ano, turnosDB, [], {
      ventana: { desdeTs, hastaTs, dias }
    }));
  }

  // ¿Le ha cambiado el turno a alguien? Entonces sus horas del mes ENTERO están
  // repartidas con el corte viejo y hay que rehacerlas.
  const cambiados = [];
  parciales.forEach(p => Object.entries(p.infoConductores || {}).forEach(([nombre, info]) => {
    const enCache = _cache.conductores[nombre];
    if (enCache && info.turno && info.turno !== '?' && enCache.turno !== '?' && enCache.turno !== info.turno) {
      cambiados.push(`${nombre}: ${enCache.turno}→${info.turno}`);
    }
  }));
  if (cambiados.length) {
    console.log(`🔄 [Horas] Cambio de turno (${cambiados.join(', ')}) → pasada completa`);
    const r = await procesarYUnificar(mes, ano);
    return { ...r, modo: 'completa', motivo: 'cambio-turno', cambiados };
  }

  // A cero los días vivos de TODOS los cacheados: quien ayer tenía horas y hoy
  // no aparece en la descarga es que ya no las tiene.
  Object.values(_cache.conductores).forEach(d => {
    dias.forEach(x => { delete d.dias[x]; delete d.noc[x]; delete d.has[x]; delete d.wait[x]; });
  });

  let nuevos = 0;
  parciales.forEach(p => {
    Object.entries(p.horas).forEach(([nombre, diasObj]) => {
      let d = _cache.conductores[nombre];
      if (!d) { d = _cache.conductores[nombre] = { dias: {}, noc: {}, has: {}, wait: {} }; nuevos++; }
      const info = p.infoConductores[nombre] || {};
      if (info.turno && info.turno !== '?') d.turno = info.turno;
      if (info.estado && PRIORIDAD_ESTADO[info.estado] >= PRIORIDAD_ESTADO[d.estado || 'despedido']) d.estado = info.estado;
      const sumar = (dst, src) => Object.entries(src || {}).forEach(([x, v]) => { dst[x] = (dst[x] || 0) + v; });
      sumar(d.dias, diasObj);
      sumar(d.noc, (p.nocPorDia || {})[nombre]);
      sumar(d.has, ((p.efecPorDia || {})[nombre] || {}).has);
      sumar(d.wait, ((p.efecPorDia || {})[nombre] || {}).wait);
    });
  });

  _cache.ts = Date.now();
  await escribirHojaUnificada(tablaDesdeCache(_cache), mes, ano, HOJA_MES_ACTUAL, { libro: LIBRO_MES_ACTUAL });
  console.log(`⚡ [Horas] Incremental: días ${dias.join(', ')} · ${Object.keys(_cache.conductores).length} conductores` +
              (nuevos ? ` (${nuevos} nuevos)` : ''));
  return { status: 'ok', modo: 'incremental', mes, ano, dias, conductores: Object.keys(_cache.conductores).length, nuevos };
}

/** Para pruebas y para forzar una pasada completa desde fuera. */
function olvidarCacheHoras() { _cache = null; }

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
    // fetchRangoCompleto y no fetchAllPaginated: parte el rango si la API da
    // timeout o lo rechaza por largo. Con fetchAllPaginated un mes movido
    // devolvía datos parciales y el visor mostraba menos horas sin avisar.
    const logs = await fetchRangoCompleto(
      '/fleetIntegration/v1/getFleetStateLogs', { company_id: flotaId },
      'state_logs', startTs, endTs, 1000, 'visor-logs-' + flotaId
    );
    // Se marca la flota de origen para poder desglosar el total después: el
    // informe que descarga Bolt es por empresa, y el visor suma las dos.
    logs.forEach(l => { l.__flota = flotaId; });
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
  let segRecortados = 0;      // tiempo descartado por el tope
  let nRecortados = 0;
  let segColas = 0;           // de lo anterior, en tramos sin log de cierre
  const segPorFlota = {};     // desglose para cuadrar con el informe de Bolt

  Object.values(logsPorDriver).forEach(logs => {
    logs.sort(ordenarLogs);

    for (let i = 0; i < logs.length; i++) {
      const estado = logs[i].state;
      if (estado !== 'waiting_orders' && estado !== 'has_order') continue;

      const inicio = logs[i].created;
      const esUltimo = (i === logs.length - 1);
      // El último tramo de cada conductor se cerraba en endTs (= AHORA). Un
      // conductor cuyo último log del mes fuera 'waiting_orders' sumaba desde
      // ese momento hasta ahora: días enteros en algunos casos.
      const fin = esUltimo ? endTs : logs[i + 1].created;
      let duracion = fin - inicio;

      if (duracion > MAX_TRAMO_SEG) {
        segRecortados += duracion - MAX_TRAMO_SEG;
        nRecortados++;
        if (esUltimo) segColas += duracion - MAX_TRAMO_SEG;
        duracion = MAX_TRAMO_SEG;
      }

      if (duracion > 0) {
        if (estado === 'waiting_orders') horasWaiting += duracion;
        else horasHasOrder += duracion;
        const f = logs[i].__flota || 'desconocida';
        segPorFlota[f] = (segPorFlota[f] || 0) + duracion;
      }
    }
  });

  console.log('📊 [visor] Horas por flota (el informe de Bolt se descarga por empresa):');
  Object.keys(segPorFlota).forEach(f => {
    console.log(`     flota ${f}: ${(segPorFlota[f] / 3600).toFixed(1)} h`);
  });

  if (segRecortados > 0) {
    console.log(
      `✂️  [visor] Tope de ${MAX_TRAMO_SEG / 3600} h aplicado a ${nRecortados} tramos: ` +
      `${(segRecortados / 3600).toFixed(1)} h descartadas ` +
      `(${(segColas / 3600).toFixed(1)} h eran colas sin log de cierre). ` +
      `Sin el tope el visor mostraría ${((horasWaiting + horasHasOrder + segRecortados) / 3600).toFixed(0)} h.`
    );
  }

  // 2. Facturación de ambas flotas
  let facturacion = 0;
  for (const flotaId of flotas) {
    const ordenes = await fetchRangoCompleto(
      '/fleetIntegration/v1/getFleetOrders',
      { company_ids: [flotaId], time_range_filter_type: 'created' },
      'orders', startTs, endTs, 500, 'visor-ordenes-' + flotaId
    );

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

module.exports = { procesarYUnificar, refrescarHorasIncremental, olvidarCacheHoras, obtenerMetricasVisor, limpiarCacheDrivers };