const { CONFIG_BOLT, fetchAllPaginated } = require('./bolt');
const { writeSheet, clearSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';

// ============================================================
// OBTENER RANGO MES CURSANTE
// ============================================================
function obtenerRangoMesCursante() {
  const ahora = new Date();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const startTs = Math.floor(inicioMes.getTime() / 1000);
  const endTs = Math.floor(ahora.getTime() / 1000);
  return { startTs, endTs };
}

// ============================================================
// HORAS UNIFICADAS
// ============================================================
async function procesarHorasUnificado() {
  const { startTs, endTs } = obtenerRangoMesCursante();
  const flotas = [63530, 143626];

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

  return {
    horasWaiting: horasWaiting / 3600,
    horasHasOrder: horasHasOrder / 3600
  };
}

// ============================================================
// FACTURACIÓN UNIFICADA
// ============================================================
async function procesarFacturacionUnificada() {
  const { startTs, endTs } = obtenerRangoMesCursante();
  const flotas = [63530, 143626];

  let allOrders = [];
  for (const flotaId of flotas) {
    const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders', {
      company_ids: [flotaId], start_ts: startTs, end_ts: endTs,
      time_range_filter_type: 'created'
    }, 'orders', 500);
    allOrders.push(...ordenes);
  }

  let facturacion = 0;
  allOrders.forEach(order => {
    if (order.order_price && order.order_price.net_earnings) {
      facturacion += order.order_price.net_earnings;
    }
  });

  return facturacion;
}

// ============================================================
// ESCRIBIR RESULTADOS EN SHEET
// ============================================================
async function escribirResultadosUnificados() {
  const horas = await procesarHorasUnificado();
  const facturacion = await procesarFacturacionUnificada();

  const values = [
    ['Horas Waiting Orders', 'Horas Has Order', 'Facturación (net_earnings)'],
    [horas.horasWaiting.toFixed(2), horas.horasHasOrder.toFixed(2), facturacion.toFixed(2)]
  ];

  await clearSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:Z');
  await writeSheet(SPREADSHEET_ID, 'Flotas Unificadas!A1', values);

  console.log(`✅ Flotas Unificadas: Waiting=${horas.horasWaiting.toFixed(2)}h | HasOrder=${horas.horasHasOrder.toFixed(2)}h | Fact=${facturacion.toFixed(2)}€`);

  return { horas, facturacion };
}

// ============================================================
// ÚLTIMOS 15 DÍAS
// ============================================================
async function procesarUltimos15Dias() {
  const ahora = new Date();

  const fechaFin = new Date(ahora);
  fechaFin.setDate(fechaFin.getDate() - 1);
  fechaFin.setHours(23, 59, 59, 999);

  const fechaInicio = new Date(fechaFin);
  fechaInicio.setDate(fechaInicio.getDate() - 14);
  fechaInicio.setHours(0, 0, 0, 0);

  const startTs = Math.floor(fechaInicio.getTime() / 1000);
  const endTs = Math.floor(fechaFin.getTime() / 1000);

  console.log(`📅 Últimos 15 días: ${fechaInicio.toISOString()} → ${fechaFin.toISOString()}`);

  const flotas = [
    { id: 63530, nombre: 'Flota 63530' },
    { id: 143626, nombre: 'Flota 143626' }
  ];

  // Inicializar días
  const horasPorDia = {};
  const fechaTemp = new Date(fechaInicio);

  while (fechaTemp <= fechaFin) {
    const fechaKey = fechaTemp.toISOString().split('T')[0];
    horasPorDia[fechaKey] = { total: 0, flota63530: 0, flota143626: 0 };
    fechaTemp.setDate(fechaTemp.getDate() + 1);
  }

  // Obtener datos de cada flota
  for (const flota of flotas) {
    const stateLogs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs', {
      company_id: flota.id, start_ts: startTs, end_ts: endTs
    }, 'state_logs', 1000);

    const logsByDriver = {};
    stateLogs.forEach(log => {
      const duuid = log.driver_uuid || 'unknown';
      if (!logsByDriver[duuid]) logsByDriver[duuid] = [];
      logsByDriver[duuid].push(log);
    });

    for (const logs of Object.values(logsByDriver)) {
      logs.sort((a, b) => a.created - b.created);

      for (let i = 0; i < logs.length; i++) {
        if (!STATE_VIAJE.includes(logs[i].state)) continue;

        const fecha = new Date(logs[i].created * 1000);
        const fechaKey = fecha.toISOString().split('T')[0];

        if (!horasPorDia[fechaKey]) continue;

        if (i + 1 < logs.length) {
          const duracion = logs[i + 1].created - logs[i].created;

          if (duracion > 0) {
            if (flota.id === 63530) {
              horasPorDia[fechaKey].flota63530 += duracion;
            } else {
              horasPorDia[fechaKey].flota143626 += duracion;
            }
            horasPorDia[fechaKey].total += duracion;
          }
        }
      }
    }
  }

  // Escribir en Google Sheets
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const values = [['FECHA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO']];

  let acumulado = 0;
  const fechasOrdenadas = Object.keys(horasPorDia).sort();

  for (const fechaKey of fechasOrdenadas) {
    const datos = horasPorDia[fechaKey];
    const [ano, mes, dia] = fechaKey.split('-').map(Number);
    const fechaFormateada = `${meses[mes - 1]} ${dia}`;

    acumulado += datos.total / 3600;

    values.push([
      fechaFormateada,
      (datos.flota63530 / 3600).toFixed(2),
      (datos.flota143626 / 3600).toFixed(2),
      (datos.total / 3600).toFixed(2),
      acumulado.toFixed(2)
    ]);
  }

  await clearSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A1', values);

  console.log(`✅ HORAS_15_DIAS actualizada: ${fechasOrdenadas.length} días`);

  return { dias: fechasOrdenadas.length, acumulado: acumulado.toFixed(2) };
}

module.exports = { procesarHorasUnificado, procesarFacturacionUnificada, escribirResultadosUnificados, procesarUltimos15Dias };