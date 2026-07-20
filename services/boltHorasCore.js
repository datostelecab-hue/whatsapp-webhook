const { CONFIG_BOLT, fetchAllPaginated, sleep } = require('./bolt');
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

// ============================================================
// PROCESAR Y UNIFICAR
// ============================================================
async function procesarYUnificar(mes, ano, opciones = {}) {
  const hojaDestino = opciones.hojaDestino || HOJA_MES_ACTUAL;
  const pausaMs = opciones.pausaMs;
  const incluirTodos = opciones.incluirTodos === true;

  const turnosDB = await leerTurnos();
  const postMortem = await leerPostMortem();

  const todosConductores = {};

  for (const flota of CONFIG_BOLT.flotas) {
    const datos = await calcularHorasFlota(flota.id, mes, ano, turnosDB, postMortem, { pausaMs });

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
  }

  await escribirHojaUnificada(todosConductores, mes, ano, hojaDestino, { incluirTodos });
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
      const tiempos = stateLogs.map(l => l.created);
      const minTs = Math.min(...tiempos);
      const maxTs = Math.max(...tiempos);
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
      const info = driverInfo[duuid];
      if (!info) {
        // El conductor tiene actividad pero no vino en getDrivers (p. ej. ya
        // no pertenece a la flota). Sus horas se pierden por completo.
        logsDescartados += logs.length;
        uuidsDesconocidos.add(duuid);
        return;
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
      console.error(
        `❌ [${tag}] ${logsDescartados} logs DESCARTADOS de ${uuidsDesconocidos.size} ` +
        `conductores que no vinieron en getDrivers — sus horas no se contarán`
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
    allStateLogs.push(...logs);
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

module.exports = { procesarYUnificar, obtenerMetricasVisor };