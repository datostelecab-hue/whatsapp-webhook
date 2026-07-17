const { CONFIG_BOLT, fetchAllPaginated } = require('./bolt');
const { writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;

// ============================================================
// FUNCIÓN ÚNICA: UNA SOLA CONSULTA A BOLT PARA TODO
// ============================================================
async function actualizarTodo() {
  const ahora = new Date();
  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  const diaActual = ahora.getDate();
  const diasDelMes = new Date(ano, mes, 0).getDate();

  // Rango: desde inicio del mes hasta HOY
  const startTs = Math.floor(new Date(ano, mes - 1, 1).getTime() / 1000);
  const endTs = Math.floor(new Date(ano, mes - 1, diaActual, 23, 59, 59).getTime() / 1000);

  console.log(`📊 Consultando Bolt: ${new Date(startTs*1000).toISOString()} → ${new Date(endTs*1000).toISOString()}`);

  const flotas = [
    { id: 63530, nombre: 'Flota 63530' },
    { id: 143626, nombre: 'Flota 143626' }
  ];

  // ═══════════════════════════════════
  // 1. UNA SOLA CONSULTA: StateLogs
  // ═══════════════════════════════════
  const horasPorFlota = {};
  
  for (const flota of flotas) {
    console.log(`   🔍 Consultando flota ${flota.id}...`);
    
    const stateLogs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs', {
      company_id: flota.id, start_ts: startTs, end_ts: endTs
    }, 'state_logs', 1000);

    console.log(`   📋 Flota ${flota.id}: ${stateLogs.length} logs`);

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

        if (i + 1 < logs.length) {
          const duracion = logs[i + 1].created - logs[i].created;
          if (duracion > 0) {
            // Acumular para HORAS_POR_DIA (por número de día)
            if (!horasPorFlota[dia]) horasPorFlota[dia] = { flota63530: 0, flota143626: 0 };
            if (flota.id === 63530) {
              horasPorFlota[dia].flota63530 += duracion;
            } else {
              horasPorFlota[dia].flota143626 += duracion;
            }
          }
        }
      }
    }
  }

  // ═══════════════════════════════════
  // 2. UNA SOLA CONSULTA: Facturación
  // ═══════════════════════════════════
  let facturacion = 0;
  for (const flota of flotas) {
    const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders', {
      company_ids: [flota.id], start_ts: startTs, end_ts: endTs,
      time_range_filter_type: 'created'
    }, 'orders', 500);
    
    ordenes.forEach(order => {
      if (order.order_price && order.order_price.net_earnings) {
        facturacion += order.order_price.net_earnings;
      }
    });
  }

  // ═══════════════════════════════════
  // 3. ESCRIBIR HORAS_POR_DIA
  // ═══════════════════════════════════
  const ultimoDiaMostrar = Math.min(diaActual + DIAS_VENTANA_FUTURA, diasDelMes);
  
  await ensureSheet(SPREADSHEET_ID, 'HORAS_POR_DIA');
  
  const valuesPorDia = [['DÍA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO POR DÍA']];
  let acumuladoPorDia = 0;

  for (let d = 0; d <= ultimoDiaMostrar; d++) {
    const datos = horasPorFlota[d] || { flota63530: 0, flota143626: 0 };
    const esFuturo = d > diaActual;
    const esHoy = d === diaActual;

    if (esFuturo) {
      valuesPorDia.push([d.toString(), '', '', '', '']);
    } else {
      const h63530 = datos.flota63530 / 3600;
      const h143626 = datos.flota143626 / 3600;
      const total = h63530 + h143626;
      if (!esHoy) acumuladoPorDia += total;

      valuesPorDia.push([
        d.toString(),
        h63530.toFixed(1),
        h143626.toFixed(1),
        total.toFixed(1),
        esHoy ? '' : acumuladoPorDia.toFixed(1)
      ]);
    }
  }

  await clearSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A1', valuesPorDia);
  console.log(`✅ HORAS_POR_DIA: ${ultimoDiaMostrar + 1} días`);

  // ═══════════════════════════════════
  // 4. ESCRIBIR HORAS_15_DIAS (desde los mismos datos)
  // ═══════════════════════════════════
  await ensureSheet(SPREADSHEET_ID, 'HORAS_15_DIAS');

  const fechaFin = new Date(ahora);
  fechaFin.setDate(fechaFin.getDate() - 1); // ayer
  
  const fechaInicio = new Date(fechaFin);
  fechaInicio.setDate(fechaInicio.getDate() - 14); // 15 días atrás desde ayer

  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const values15dias = [['FECHA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO']];
  let acumulado15 = 0;
  const fechaTemp = new Date(fechaInicio);

  while (fechaTemp <= fechaFin) {
    const dia = fechaTemp.getDate();
    const datos = horasPorFlota[dia] || { flota63530: 0, flota143626: 0 };
    const h63530 = datos.flota63530 / 3600;
    const h143626 = datos.flota143626 / 3600;
    const total = h63530 + h143626;
    acumulado15 += total;

    // Solo mostrar si el mes coincide
    if (fechaTemp.getMonth() === ahora.getMonth()) {
      values15dias.push([
        `${meses[fechaTemp.getMonth()]} ${dia}`,
        h63530.toFixed(2),
        h143626.toFixed(2),
        total.toFixed(2),
        acumulado15.toFixed(2)
      ]);
    }

    fechaTemp.setDate(fechaTemp.getDate() + 1);
  }

  await clearSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A1', values15dias);
  console.log(`✅ HORAS_15_DIAS: ${values15dias.length - 1} días`);

  // ═══════════════════════════════════
  // 5. ESCRIBIR FLOTAS UNIFICADAS
  // ═══════════════════════════════════
  // Calcular horas waiting y has_order desde los mismos stateLogs
  let horasWaiting = 0, horasHasOrder = 0;

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

    Object.values(logsByDriver).forEach(logs => {
      logs.sort((a, b) => a.created - b.created);
      for (let i = 0; i < logs.length; i++) {
        const estado = logs[i].state;
        if (!STATE_VIAJE.includes(estado)) continue;
        const inicio = logs[i].created;
        const fin = (i < logs.length - 1) ? logs[i + 1].created : endTs;
        const duracion = fin - inicio;
        if (duracion > 0) {
          if (estado === 'waiting_orders') horasWaiting += duracion;
          else horasHasOrder += duracion;
        }
      }
    });
  }

  await ensureSheet(SPREADSHEET_ID, 'Flotas Unificadas');
  const valuesUnificadas = [
    ['Horas Waiting Orders', 'Horas Has Order', 'Facturación (net_earnings)'],
    [(horasWaiting / 3600).toFixed(2), (horasHasOrder / 3600).toFixed(2), facturacion.toFixed(2)]
  ];

  await clearSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:Z');
  await writeSheet(SPREADSHEET_ID, 'Flotas Unificadas!A1', valuesUnificadas);
  console.log(`✅ Flotas Unificadas: W=${(horasWaiting/3600).toFixed(2)}h | HO=${(horasHasOrder/3600).toFixed(2)}h | Fact=${facturacion.toFixed(2)}€`);

  return {
    horasPorDia: valuesPorDia.length - 1,
    ultimos15Dias: values15dias.length - 1,
    facturacion: facturacion.toFixed(2)
  };
}

module.exports = { actualizarTodo };