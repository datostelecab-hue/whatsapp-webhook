const { CONFIG_BOLT, fetchAllPaginated } = require('./bolt');
const { readSheet, writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;

let ultimaEjecucion = 0;
const COOLDOWN = 60;

async function actualizarTodo() {
  const ahora = new Date();
  const ahoraMs = ahora.getTime();

  if (ahoraMs - ultimaEjecucion < COOLDOWN * 1000) {
    console.log(`⏳ Cooldown. Espera ${COOLDOWN}s`);
    return { status: 'cooldown' };
  }
  ultimaEjecucion = ahoraMs;

  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  const diaActual = ahora.getDate();
  const hora = ahora.getHours();
  const diasDelMes = new Date(ano, mes, 0).getDate();

  // 1. Leer caché COMPLETA
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
    const endTs = (ultimoDia === diaActual)
      ? Math.floor(ahora.getTime() / 1000)
      : Math.floor(new Date(ano, mes - 1, ultimoDia, 23, 59, 59).getTime() / 1000);

    console.log(`🔍 Bolt: días ${primerDia} → ${ultimoDia}`);

    const flotas = [{ id: 63530 }, { id: 143626 }];

// Todos los días recalculados se sobrescriben
// El día actual se recalcula DESDE 00:00 hasta AHORA (endTs ya lo hace)
for (const d of diasFaltantes) {
  cache[d] = crearCacheVacio();
}

    // ═══════════════════════════════════
    // STATE LOGS (horas, waiting, has_order)
    // ═══════════════════════════════════
    for (const flota of flotas) {
      const stateLogs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs', {
        company_id: flota.id, start_ts: startTs, end_ts: endTs
      }, 'state_logs', 1000);
      await sleep(1000);

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

    // ═══════════════════════════════════
    // FACTURACIÓN Y VIAJES POR DÍA
    // ═══════════════════════════════════
    for (const flotaId of [63530, 143626]) {
      const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders', {
        company_ids: [flotaId], start_ts: startTs, end_ts: endTs,
        time_range_filter_type: 'created'
      }, 'orders', 500);
      await sleep(1000);

      ordenes.forEach(o => {
        // Determinar el día de la orden
        const ts = o.order_finished_timestamp || o.order_created_timestamp;
        const diaOrden = new Date(ts * 1000).getDate();

        // Solo asignar si el día está en el rango recalculado
        if (!diasFaltantes.includes(diaOrden)) return;

        if (!cache[diaOrden]) cache[diaOrden] = crearCacheVacio();

        if (o.order_price?.net_earnings) cache[diaOrden].facturacion += o.order_price.net_earnings;
        if (o.order_status === 'finished') cache[diaOrden].viajes++;
      });
    }
  }

  // 2. Calcular totales SUMANDO TODA la caché
  let totalW = 0, totalHO = 0, totalFact = 0, totalViajes = 0;
  for (const datos of Object.values(cache)) {
    totalW += (datos.waiting || 0);
    totalHO += (datos.hasOrder || 0);
    totalFact += (datos.facturacion || 0);
    totalViajes += (datos.viajes || 0);
  }

  console.log(`💰 Total: W=${(totalW/3600).toFixed(1)}h | HO=${(totalHO/3600).toFixed(1)}h | Fact=${totalFact.toFixed(2)}€ | Viajes=${totalViajes}`);

  // 3. Escribir HORAS_POR_DIA (9 columnas)
  const ultimoDiaMostrar = Math.min(diaActual + DIAS_VENTANA_FUTURA, diasDelMes);
  await ensureSheet(SPREADSHEET_ID, 'HORAS_POR_DIA');

  const valuesPorDia = [['DÍA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'WAITING', 'HAS_ORDER', 'FACTURACIÓN', 'VIAJES', 'ACUMULADO POR DÍA']];
  let acumulado = 0;

  for (let d = 0; d <= ultimoDiaMostrar; d++) {
    const dat = cache[d] || crearCacheVacio();
    const esFuturo = d > diaActual;
    const esHoy = d === diaActual;

    if (esFuturo) {
      valuesPorDia.push([d.toString(), '', '', '', '', '', '', '', '']);
    } else {
      const h63530 = dat.flota63530 / 3600;
      const h143626 = dat.flota143626 / 3600;
      const total = h63530 + h143626;
      if (!esHoy) acumulado += total;

      valuesPorDia.push([
        d.toString(),
        h63530.toFixed(1),
        h143626.toFixed(1),
        total.toFixed(1),
        (dat.waiting / 3600).toFixed(1),
        (dat.hasOrder / 3600).toFixed(1),
        dat.facturacion > 0 ? dat.facturacion.toFixed(2) : '',
        dat.viajes > 0 ? dat.viajes.toString() : '',
        esHoy ? '' : acumulado.toFixed(1)
      ]);
    }
  }

  await clearSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A1', valuesPorDia);

  // 4. HORAS_15_DIAS
  await ensureSheet(SPREADSHEET_ID, 'HORAS_15_DIAS');
  const fechaFin = new Date(ahora); fechaFin.setDate(fechaFin.getDate() - 1);
  const fechaInicio = new Date(fechaFin); fechaInicio.setDate(fechaInicio.getDate() - 14);
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const values15 = [['FECHA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO']];
  let ac15 = 0;
  const ft = new Date(fechaInicio);
  while (ft <= fechaFin) {
    const d = ft.getDate();
    const em = ft.getMonth() === ahora.getMonth();
    const dat = em ? (cache[d] || crearCacheVacio()) : crearCacheVacio();
    const t = (dat.flota63530 + dat.flota143626) / 3600;
    ac15 += t;
    values15.push([`${meses[ft.getMonth()]} ${d}`, (dat.flota63530/3600).toFixed(2), (dat.flota143626/3600).toFixed(2), t.toFixed(2), ac15.toFixed(2)]);
    ft.setDate(ft.getDate() + 1);
  }
  await clearSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A:Z');
  await writeSheet(SPREADSHEET_ID, 'HORAS_15_DIAS!A1', values15);

  // 5. FLOTAS UNIFICADAS
  await ensureSheet(SPREADSHEET_ID, 'Flotas Unificadas');
  const horasTotal = (totalW + totalHO) / 3600;
  const vph = horasTotal > 0 ? (totalViajes / horasTotal).toFixed(2) : '0.00';

  const valuesUni = [
    ['Horas Waiting Orders', 'Horas Has Order', 'Viajes Completados', 'Facturación (net_earnings)', 'Viajes/Hora'],
    [(totalW/3600).toFixed(2), (totalHO/3600).toFixed(2), totalViajes, totalFact.toFixed(2), vph]
  ];

  await clearSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:F');
  await writeSheet(SPREADSHEET_ID, 'Flotas Unificadas!A1', valuesUni);
  console.log(`✅ Unificadas: W=${(totalW/3600).toFixed(1)} | HO=${(totalHO/3600).toFixed(1)} | V=${totalViajes} | €=${totalFact.toFixed(2)} | V/h=${vph}`);

  return { diasCache: diasCalculados.length, diasNuevos: diasFaltantes.length };
}

// ═══════════════════════════════
function crearCacheVacio() {
  return { flota63530: 0, flota143626: 0, waiting: 0, hasOrder: 0, facturacion: 0, viajes: 0 };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    console.log(`📋 Caché: ${Object.keys(cache).length} días`);
    return cache;
  } catch (e) { return {}; }
}

module.exports = { actualizarTodo };