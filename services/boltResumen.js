const { CONFIG_BOLT, fetchAllPaginated } = require('./bolt');
const { writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;

// ============================================================
// HORAS POR DÍA (MES ACTUAL)
// ============================================================
async function actualizarHorasPorDia() {
  const ahora = new Date();
  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  const diasDelMes = new Date(ano, mes, 0).getDate();
  const diaActual = ahora.getDate();

  const startTs = Math.floor(new Date(ano, mes - 1, 1).getTime() / 1000);
  const endTs = Math.floor(new Date(ano, mes - 1, diaActual, 23, 59, 59).getTime() / 1000);

  const ultimoDiaMostrar = Math.min(diaActual + DIAS_VENTANA_FUTURA, diasDelMes);

  const flotas = [
    { id: 63530, nombre: 'Flota 63530' },
    { id: 143626, nombre: 'Flota 143626' }
  ];

  const horasPorFlota = {};

  for (const flota of flotas) {
    horasPorFlota[flota.id] = {};
    for (let d = 0; d <= ultimoDiaMostrar; d++) {
      horasPorFlota[flota.id][d] = 0;
    }
  }

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

        const dia = new Date(logs[i].created * 1000).getDate();
        if (dia > ultimoDiaMostrar) continue;

        if (i + 1 < logs.length) {
          const duracion = logs[i + 1].created - logs[i].created;
          if (duracion > 0) {
            horasPorFlota[flota.id][dia] += duracion;
          }
        }
      }
    }
  }

  // Escribir en Sheets
  await ensureSheet(SPREADSHEET_ID, 'HORAS_POR_DIA');

  const values = [['DÍA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO POR DÍA']];
  let acumulado = 0;

  for (let d = 0; d <= ultimoDiaMostrar; d++) {
    const esDiaFuturo = d > diaActual;
    const esDiaActual = d === diaActual;

    if (esDiaFuturo) {
      values.push([d.toString(), '', '', '', '']);
    } else {
      const h63530 = horasPorFlota[63530]?.[d] || 0;
      const h143626 = horasPorFlota[143626]?.[d] || 0;
      const totalDia = (h63530 + h143626) / 3600;

      if (!esDiaActual) acumulado += totalDia;

      values.push([
        d.toString(),
        (h63530 / 3600).toFixed(1),
        (h143626 / 3600).toFixed(1),
        totalDia.toFixed(1),
        esDiaActual ? '' : acumulado.toFixed(1)
      ]);
    }
  }

  await clearSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A1', values);

  console.log(`✅ HORAS_POR_DIA actualizada: ${values.length - 1} días`);
  return { dias: values.length - 1 };
}

// ============================================================
// ÚLTIMOS 15 DÍAS
// ============================================================
async function actualizarUltimos15Dias() {
  const ahora = new Date();

  const fechaFin = new Date(ahora);
  fechaFin.setDate(fechaFin.getDate() - 1);
  fechaFin.setHours(23, 59, 59, 999);

  const fechaInicio = new Date(fechaFin);
  fechaInicio.setDate(fechaInicio.getDate() - 14);
  fechaInicio.setHours(0, 0, 0, 0);

  const startTs = Math.floor(fechaInicio.getTime() / 1000);
  const endTs = Math.floor(fechaFin.getTime() / 1000);

  console.log(`📅 Últimos 15 días: ${fechaInicio.toISOString().split('T')[0]} → ${fechaFin.toISOString().split('T')[0]}`);

  const flotas = [
    { id: 63530, nombre: 'Flota 63530' },
    { id: 143626, nombre: 'Flota 143626' }
  ];

  const horasPorDia = {};
  const fechaTemp = new Date(fechaInicio);

  while (fechaTemp <= fechaFin) {
    const fechaKey = fechaTemp.toISOString().split('T')[0];
    horasPorDia[fechaKey] = { total: 0, flota63530: 0, flota143626: 0 };
    fechaTemp.setDate(fechaTemp.getDate() + 1);
  }

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

  await ensureSheet(SPREADSHEET_ID, 'HORAS_15_DIAS');

  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const values = [['FECHA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO']];
  let acumulado = 0;
  const fechasOrdenadas = Object.keys(horasPorDia).sort();

  for (const fechaKey of fechasOrdenadas) {
    const datos = horasPorDia[fechaKey];
    const [ano, mes, dia] = fechaKey.split('-').map(Number);
    acumulado += datos.total / 3600;

    values.push([
      `${meses[mes - 1]} ${dia}`,
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

// ============================================================
// FLOTAS UNIFICADAS
// ============================================================
async function actualizarFlotasUnificadas() {
  const { startTs, endTs } = (() => {
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    return {
      startTs: Math.floor(inicioMes.getTime() / 1000),
      endTs: Math.floor(ahora.getTime() / 1000)
    };
  })();

  const flotas = [63530, 143626];

  // Horas
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

  let horasWaiting = 0, horasHasOrder = 0;
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

  // Facturación
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

  await ensureSheet(SPREADSHEET_ID, 'Flotas Unificadas');

  const values = [
    ['Horas Waiting Orders', 'Horas Has Order', 'Facturación (net_earnings)'],
    [(horasWaiting / 3600).toFixed(2), (horasHasOrder / 3600).toFixed(2), facturacion.toFixed(2)]
  ];

  await clearSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:Z');
  await writeSheet(SPREADSHEET_ID, 'Flotas Unificadas!A1', values);

  console.log(`✅ Flotas Unificadas: W=${(horasWaiting/3600).toFixed(2)}h | HO=${(horasHasOrder/3600).toFixed(2)}h | Fact=${facturacion.toFixed(2)}€`);
  return { horasWaiting: horasWaiting/3600, horasHasOrder: horasHasOrder/3600, facturacion };
}

// ============================================================
// FUNCIÓN PRINCIPAL: ACTUALIZAR TODO
// ============================================================
async function actualizarTodo() {
  const unificadas = await actualizarFlotasUnificadas();
  const quinceDias = await actualizarUltimos15Dias();
  const horasPorDia = await actualizarHorasPorDia();
  return { unificadas, quinceDias, horasPorDia };
}

module.exports = { actualizarHorasPorDia, actualizarUltimos15Dias, actualizarFlotasUnificadas, actualizarTodo };