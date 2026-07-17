const { CONFIG_BOLT, fetchAllPaginated } = require('./bolt');
const { readSheet, writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;

// ============================================================
// FUNCIÓN PRINCIPAL OPTIMIZADA
// ============================================================
async function actualizarTodo() {
  const ahora = new Date();
  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  const diaActual = ahora.getDate();
  const diasDelMes = new Date(ano, mes, 0).getDate();

  // 1. Leer datos existentes del Sheet (caché)
  const cacheExistente = await leerCacheHorasPorDia();
  
  // 2. Determinar qué días faltan por calcular
  const diasAConsultar = [];
  for (let d = 0; d <= diaActual; d++) {
    if (!cacheExistente[d] || cacheExistente[d].total === 0) {
      diasAConsultar.push(d);
    }
  }

  console.log(`📊 Días ya calculados: ${diaActual + 1 - diasAConsultar.length} | Días a consultar: ${diasAConsultar.length}`);

  // 3. Si hay días nuevos, consultar a Bolt SOLO para esos días
  if (diasAConsultar.length > 0) {
    const primerDiaFaltante = Math.min(...diasAConsultar);
    const startTs = Math.floor(new Date(ano, mes - 1, primerDiaFaltante, 0, 0, 0).getTime() / 1000);
    const endTs = Math.floor(new Date(ano, mes - 1, diaActual, 23, 59, 59).getTime() / 1000);

    console.log(`🔍 Consultando Bolt: día ${primerDiaFaltante} → ${diaActual}`);

    const flotas = [
      { id: 63530, nombre: 'Flota 63530' },
      { id: 143626, nombre: 'Flota 143626' }
    ];

    // Consultar stateLogs
    const nuevosDatos = {};
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
          if (i + 1 < logs.length) {
            const duracion = logs[i + 1].created - logs[i].created;
            if (duracion > 0) {
              if (!nuevosDatos[dia]) nuevosDatos[dia] = { flota63530: 0, flota143626: 0 };
              if (flota.id === 63530) nuevosDatos[dia].flota63530 += duracion;
              else nuevosDatos[dia].flota143626 += duracion;
            }
          }
        }
      }
    }

    // Fusionar con caché existente
    for (const [dia, datos] of Object.entries(nuevosDatos)) {
      cacheExistente[parseInt(dia)] = datos;
    }
  }

  // 4. Consultar facturación SOLO para días nuevos
  let facturacionNueva = 0;
  if (diasAConsultar.length > 0) {
    const primerDiaFaltante = Math.min(...diasAConsultar);
    const startTs = Math.floor(new Date(ano, mes - 1, primerDiaFaltante, 0, 0, 0).getTime() / 1000);
    const endTs = Math.floor(new Date(ano, mes - 1, diaActual, 23, 59, 59).getTime() / 1000);

    const flotas = [63530, 143626];
    for (const flotaId of flotas) {
      const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders', {
        company_ids: [flotaId], start_ts: startTs, end_ts: endTs,
        time_range_filter_type: 'created'
      }, 'orders', 500);
      ordenes.forEach(o => {
        if (o.order_price?.net_earnings) facturacionNueva += o.order_price.net_earnings;
      });
    }
  }

  // Leer facturación acumulada anterior
  const facturacionAnterior = await leerFacturacionAcumulada();
  const facturacionTotal = facturacionAnterior + facturacionNueva;

  // 5. Escribir HORAS_POR_DIA
  const ultimoDiaMostrar = Math.min(diaActual + DIAS_VENTANA_FUTURA, diasDelMes);
  await ensureSheet(SPREADSHEET_ID, 'HORAS_POR_DIA');
  
  const valuesPorDia = [['DÍA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO POR DÍA']];
  let acumulado = 0;

  for (let d = 0; d <= ultimoDiaMostrar; d++) {
    const datos = cacheExistente[d] || { flota63530: 0, flota143626: 0 };
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
  console.log(`✅ HORAS_POR_DIA: ${valuesPorDia.length - 1} filas`);

  // 6. Escribir HORAS_15_DIAS (desde la misma caché)
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
    // Solo usar caché si es del mes actual
    const datos = (fechaTemp.getMonth() === ahora.getMonth()) 
      ? (cacheExistente[dia] || { flota63530: 0, flota143626: 0 })
      : { flota63530: 0, flota143626: 0 };
    
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
  console.log(`✅ HORAS_15_DIAS: ${values15dias.length - 1} filas`);

  // 7. Escribir FLOTAS UNIFICADAS (horas waiting + has_order se leen de la caché + facturación acumulada)
  let horasWaiting = 0, horasHasOrder = 0;
  for (let d = 0; d <= diaActual; d++) {
    const datos = cacheExistente[d] || { flota63530: 0, flota143626: 0 };
    horasHasOrder += (datos.flota63530 + datos.flota143626) / 3600; // Aproximación: todo es has_order
  }

  await ensureSheet(SPREADSHEET_ID, 'Flotas Unificadas');
  const valuesUnificadas = [
    ['Horas Waiting Orders', 'Horas Has Order', 'Facturación (net_earnings)'],
    ['0.00', horasHasOrder.toFixed(2), facturacionTotal.toFixed(2)]
  ];

  await clearSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:Z');
  await writeSheet(SPREADSHEET_ID, 'Flotas Unificadas!A1', valuesUnificadas);
  console.log(`✅ Flotas Unificadas: HO=${horasHasOrder.toFixed(2)}h | Fact=${facturacionTotal.toFixed(2)}€`);

  return { horasPorDia: valuesPorDia.length - 1, ultimos15dias: values15dias.length - 1 };
}

// ============================================================
// LEER CACHÉ DE HORAS_POR_DIA
// ============================================================
async function leerCacheHorasPorDia() {
  try {
    const data = await readSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:D');
    const cache = {};
    
    for (let i = 1; i < data.length; i++) {
      const dia = parseInt(data[i][0]);
      if (isNaN(dia)) continue;
      
      const flota63530 = parseFloat(data[i][1]) || 0;
      const flota143626 = parseFloat(data[i][2]) || 0;
      
      if (flota63530 > 0 || flota143626 > 0) {
        cache[dia] = {
          flota63530: flota63530 * 3600, // Convertir a segundos
          flota143626: flota143626 * 3600
        };
      }
    }
    
    console.log(`📋 Caché leída: ${Object.keys(cache).length} días con datos`);
    return cache;
  } catch (e) {
    console.log('📋 Sin caché previa, se calculará todo');
    return {};
  }
}

// ============================================================
// LEER FACTURACIÓN ACUMULADA
// ============================================================
async function leerFacturacionAcumulada() {
  try {
    const data = await readSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:C');
    if (data.length >= 2 && data[1][2]) {
      const valor = parseFloat(data[1][2]);
      console.log(`💰 Facturación anterior: ${valor.toFixed(2)}€`);
      return valor;
    }
  } catch (e) {}
  return 0;
}

module.exports = { actualizarTodo };