const { CONFIG_BOLT, fetchAllPaginated } = require('./bolt');
const { writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;

async function actualizarTodo() {
  const ahora = new Date();
  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  const diaActual = ahora.getDate();
  const diasDelMes = new Date(ano, mes, 0).getDate();

  const startTs = Math.floor(new Date(ano, mes - 1, 1).getTime() / 1000);
  const endTs = Math.floor(new Date(ano, mes - 1, diaActual, 23, 59, 59).getTime() / 1000);

  console.log(`📊 Rango: día 1 → ${diaActual} de ${mes}/${ano}`);

  const flotas = [
    { id: 63530, nombre: 'Flota 63530' },
    { id: 143626, nombre: 'Flota 143626' }
  ];

  // ═══════════════════════════════════
  // 1. STATE LOGS (UNA SOLA CONSULTA POR FLOTA)
  // ═══════════════════════════════════
  const horasPorDia = {};
  let horasWaiting = 0;
  let horasHasOrder = 0;

  for (const flota of flotas) {
    console.log(`   🔍 Flota ${flota.id}...`);
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
        const estado = logs[i].state;
        if (!STATE_VIAJE.includes(estado)) continue;

        const dia = new Date(logs[i].created * 1000).getDate();
        const inicio = logs[i].created;
        const fin = (i < logs.length - 1) ? logs[i + 1].created : endTs;
        const duracion = fin - inicio;
        if (duracion <= 0) continue;

        // Acumular por día
        if (!horasPorDia[dia]) horasPorDia[dia] = { flota63530: 0, flota143626: 0 };
        if (flota.id === 63530) horasPorDia[dia].flota63530 += duracion;
        else horasPorDia[dia].flota143626 += duracion;

        // Acumular por tipo (waiting vs has_order)
        if (estado === 'waiting_orders') horasWaiting += duracion;
        else horasHasOrder += duracion;
      }
    }
  }

  // ═══════════════════════════════════
  // 2. FACTURACIÓN (UNA SOLA CONSULTA)
  // ═══════════════════════════════════
  let facturacion = 0;
  for (const flotaId of [63530, 143626]) {
    const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders', {
      company_ids: [flotaId], start_ts: startTs, end_ts: endTs,
      time_range_filter_type: 'created'
    }, 'orders', 500);
    ordenes.forEach(o => {
      if (o.order_price?.net_earnings) facturacion += o.order_price.net_earnings;
    });
  }

  // ═══════════════════════════════════
  // 3. ESCRIBIR HORAS_POR_DIA
  // ═══════════════════════════════════
  const ultimoDiaMostrar = Math.min(diaActual + DIAS_VENTANA_FUTURA, diasDelMes);
  await ensureSheet(SPREADSHEET_ID, 'HORAS_POR_DIA');

  const valuesPorDia = [['DÍA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO POR DÍA']];
  let acumulado = 0;

  for (let d = 0; d <= ultimoDiaMostrar; d++) {
    const datos = horasPorDia[d] || { flota63530: 0, flota143626: 0 };
    const esFuturo = d > diaActual;
    const esHoy = d === diaActual;

    if (esFuturo) {
      valuesPorDia.push([d.toString(), '', '', '', '']);
    } else {
      const h63530 = datos.flota63530 / 3600;
      const h143626 = datos.flota143626 / 3600;
      const total = h63530 + h143626;
      if (!esHoy) acumulado += total;

      valuesPorDia.push([
        d.toString(),
        h63530.toFixed(1),
        h143626.toFixed(1),
        total.toFixed(1),
        esHoy ? '' : acumulado.toFixed(1)
      ]);
    }
  }

  await clearSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A1', valuesPorDia);
  console.log(`✅ HORAS_POR_DIA: ${ultimoDiaMostrar + 1} días | Acumulado: ${acumulado.toFixed(1)}h`);

  // ═══════════════════════════════════
  // 4. ESCRIBIR HORAS_15_DIAS (de los mismos datos)
  // ═══════════════════════════════════
  await ensureSheet(SPREADSHEET_ID, 'HORAS_15_DIAS');

  const fechaFin = new Date(ahora);
  fechaFin.setDate(fechaFin.getDate() - 1);
  const fechaInicio = new Date(fechaFin);
  fechaInicio.setDate(fechaInicio.getDate() - 14);

  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const values15dias = [['FECHA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO']];
  let acumulado15 = 0;
  const fechaTemp = new Date(fechaInicio);

  while (fechaTemp <= fechaFin) {
    const dia = fechaTemp.getDate();
    const esMesActual = fechaTemp.getMonth() === ahora.getMonth();
    const datos = esMesActual ? (horasPorDia[dia] || { flota63530: 0, flota143626: 0 }) : { flota63530: 0, flota143626: 0 };
    
    const h63530 = datos.flota63530 / 3600;
    const h143626 = datos.flota143626 / 3600;
    const total = h63530 + h143626;
    acumulado15 += total;

    values15dias.push([
      `${meses[fechaTemp.getMonth()]} ${dia}`,
      h63530.toFixed(2),
      h143626.toFixed(2),
      total.toFixed(2),
      acumulado15.toFixed(2)
    ]);

    fechaTemp.setDate(fechaTemp.getDate() + 1);
  }

  await clearSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A1', values15dias);
  console.log(`✅ HORAS_15_DIAS: ${values15dias.length - 1} días | Acumulado: ${acumulado15.toFixed(1)}h`);

  // ═══════════════════════════════════
  // 5. ESCRIBIR FLOTAS UNIFICADAS
  // ═══════════════════════════════════
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
    horasWaiting: (horasWaiting / 3600).toFixed(2),
    horasHasOrder: (horasHasOrder / 3600).toFixed(2),
    facturacion: facturacion.toFixed(2)
  };
}

module.exports = { actualizarTodo };