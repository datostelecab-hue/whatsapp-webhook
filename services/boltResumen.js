const { CONFIG_BOLT, fetchAllPaginated } = require('./bolt');
const { readSheet, writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;

async function actualizarTodo() {
  const ahora = new Date();
  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  const diaActual = ahora.getDate();
  const hora = ahora.getHours();
  const diasDelMes = new Date(ano, mes, 0).getDate();

  // 1. Leer caché COMPLETA (incluye waiting, hasOrder, facturacion, viajes)
  const cache = await leerCacheCompleta();
  const diasCalculados = Object.keys(cache).map(Number);

  // Días a recalcular
  const diasFaltantes = [];
  for (let d = 1; d <= diaActual; d++) {
    if (!diasCalculados.includes(d) || d === diaActual || (hora === 0 && d === diaActual - 1)) {
      diasFaltantes.push(d);
    }
  }

  console.log(`📊 Caché: ${diasCalculados.length} días | Recalculando: ${diasFaltantes.join(',')}`);

  if (diasFaltantes.length > 0) {
    const primerDia = Math.min(...diasFaltantes);
    const ultimoDia = Math.max(...diasFaltantes);

    const startTs = Math.floor(new Date(ano, mes - 1, primerDia, 0, 0, 0).getTime() / 1000);
    const endTs = Math.floor(new Date(ano, mes - 1, ultimoDia, 23, 59, 59).getTime() / 1000);

    console.log(`🔍 Bolt: días ${primerDia} → ${ultimoDia}`);

    const flotas = [{ id: 63530 }, { id: 143626 }];

// Solo reiniciar días que NO sean el día actual (el día actual se acumula)
for (const d of diasFaltantes) {
  if (d !== diaActual) {
    cache[d] = { flota63530: 0, flota143626: 0, waiting: 0, hasOrder: 0, facturacion: 0, viajes: 0 };
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
          const estado = logs[i].state;
          if (!STATE_VIAJE.includes(estado)) continue;
          if (i + 1 >= logs.length) continue;

          const dia = new Date(logs[i].created * 1000).getDate();
          const duracion = logs[i + 1].created - logs[i].created;
          if (duracion <= 0) continue;
          if (!diasFaltantes.includes(dia)) continue;

          if (flota.id === 63530) cache[dia].flota63530 += duracion;
          else cache[dia].flota143626 += duracion;

          if (estado === 'waiting_orders') cache[dia].waiting += duracion;
          else cache[dia].hasOrder += duracion;
        }
      }
    }

    // Facturación y viajes SOLO del período
    for (const flotaId of [63530, 143626]) {
      const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders', {
        company_ids: [flotaId], start_ts: startTs, end_ts: endTs,
        time_range_filter_type: 'created'
      }, 'orders', 500);
      
      // Solo asignar al primer día del período (simplificado)
      const diaAsignar = diasFaltantes[0];
      ordenes.forEach(o => {
        if (o.order_price?.net_earnings) cache[diaAsignar].facturacion += o.order_price.net_earnings;
        if (o.order_status === 'finished') cache[diaAsignar].viajes++;
      });
    }
  }

  // 2. Calcular totales SUMANDO TODA la caché
  let horasWaitingTotal = 0, horasHasOrderTotal = 0;
  let facturacionTotal = 0, viajesTotales = 0;

  for (const datos of Object.values(cache)) {
    horasWaitingTotal += (datos.waiting || 0);
    horasHasOrderTotal += (datos.hasOrder || 0);
    facturacionTotal += (datos.facturacion || 0);
    viajesTotales += (datos.viajes || 0);
  }

  console.log(`💰 Total mes: Fact=${facturacionTotal.toFixed(2)} | Viajes=${viajesTotales}`);

  // 3. Escribir HORAS_POR_DIA (con columnas WAITING, HAS_ORDER, FACTURACION, VIAJES)
  const ultimoDiaMostrar = Math.min(diaActual + DIAS_VENTANA_FUTURA, diasDelMes);
  await ensureSheet(SPREADSHEET_ID, 'HORAS_POR_DIA');

  const valuesPorDia = [['DÍA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'WAITING', 'HAS_ORDER', 'FACTURACIÓN', 'VIAJES', 'ACUMULADO POR DÍA']];
  let acumulado = 0;

  for (let d = 0; d <= ultimoDiaMostrar; d++) {
    const datos = cache[d] || { flota63530: 0, flota143626: 0, waiting: 0, hasOrder: 0, facturacion: 0, viajes: 0 };
    const esFuturo = d > diaActual;
    const esHoy = d === diaActual;

    if (esFuturo) {
      valuesPorDia.push([d.toString(), '', '', '', '', '', '', '', '']);
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
        (datos.waiting / 3600).toFixed(1),
        (datos.hasOrder / 3600).toFixed(1),
        datos.facturacion > 0 ? datos.facturacion.toFixed(2) : '',
        datos.viajes > 0 ? datos.viajes.toString() : '',
        esHoy ? '' : acumulado.toFixed(1)
      ]);
    }
  }

  await clearSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A1', valuesPorDia);

  // 4. HORAS_15_DIAS (sin cambios)
  await ensureSheet(SPREADSHEET_ID, 'HORAS_15_DIAS');
  const fechaFin = new Date(ahora); fechaFin.setDate(fechaFin.getDate() - 1);
  const fechaInicio = new Date(fechaFin); fechaInicio.setDate(fechaInicio.getDate() - 14);
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const values15dias = [['FECHA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO']];
  let acumulado15 = 0;
  const ft = new Date(fechaInicio);
  while (ft <= fechaFin) {
    const d = ft.getDate();
    const em = ft.getMonth() === ahora.getMonth();
    const dat = em ? (cache[d] || { flota63530: 0, flota143626: 0 }) : { flota63530: 0, flota143626: 0 };
    const t = (dat.flota63530 + dat.flota143626) / 3600;
    acumulado15 += t;
    values15dias.push([`${meses[ft.getMonth()]} ${d}`, (dat.flota63530/3600).toFixed(2), (dat.flota143626/3600).toFixed(2), t.toFixed(2), acumulado15.toFixed(2)]);
    ft.setDate(ft.getDate() + 1);
  }
  await clearSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A1', values15dias);

  // 5. FLOTAS UNIFICADAS (suma de toda la caché)
  await ensureSheet(SPREADSHEET_ID, 'Flotas Unificadas');
  const horasTotal = (horasWaitingTotal + horasHasOrderTotal) / 3600;
  const viajesPorHora = horasTotal > 0 ? (viajesTotales / horasTotal).toFixed(2) : '0.00';

  const valuesUnificadas = [
    ['Horas Waiting Orders', 'Horas Has Order', 'Viajes Completados', 'Facturación (net_earnings)', 'Viajes/Hora'],
    [
      (horasWaitingTotal / 3600).toFixed(2),
      (horasHasOrderTotal / 3600).toFixed(2),
      viajesTotales,
      facturacionTotal.toFixed(2),
      viajesPorHora
    ]
  ];

  await clearSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:F');
  await writeSheet(SPREADSHEET_ID, 'Flotas Unificadas!A1', valuesUnificadas);
  console.log(`✅ Unificadas: W=${(horasWaitingTotal/3600).toFixed(2)} | HO=${(horasHasOrderTotal/3600).toFixed(2)} | V=${viajesTotales} | €=${facturacionTotal.toFixed(2)}`);

  return { diasCache: diasCalculados.length, diasNuevos: diasFaltantes.length };
}

// ═══════════════════════════════
async function leerCacheCompleta() {
  try {
    const data = await readSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:I');
    const cache = {};
    for (let i = 1; i < data.length; i++) {
      const dia = parseInt(data[i][0]);
      if (isNaN(dia) || dia === 0) continue;
      cache[dia] = {
        flota63530: (parseFloat(data[i][1]) || 0) * 3600,
        flota143626: (parseFloat(data[i][2]) || 0) * 3600,
        waiting: (parseFloat(data[i][4]) || 0) * 3600,
        hasOrder: (parseFloat(data[i][5]) || 0) * 3600,
        facturacion: parseFloat(data[i][6]) || 0,
        viajes: parseInt(data[i][7]) || 0
      };
    }
    console.log(`📋 Caché completa: ${Object.keys(cache).length} días`);
    return cache;
  } catch (e) { return {}; }
}

module.exports = { actualizarTodo };