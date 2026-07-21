const { CONFIG_BOLT, fetchRangoCompleto, sleep } = require('./bolt');
const { readSheet, writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;

// La caché vive en su propia hoja y en SEGUNDOS. Antes se releía HORAS_POR_DIA,
// que se escribe con toFixed(1): cada día quedaba con una resolución de 6
// minutos y ese redondeo se reinyectaba como fuente de verdad para el resto del
// mes. Además las columnas de flota y las de estado se redondeaban por separado,
// así que TOTAL no tenía por qué cuadrar con WAITING + HAS_ORDER.
const HOJA_CACHE = 'CACHE_SEGUNDOS';

// Un estado dura hasta el siguiente log, pero si la app deja de reportar sin
// pasar por 'inactive' ese hueco no es tiempo trabajado: Bolt cierra la sesión
// con la telemetría del móvil, que la API no expone. Umbral empírico del
// 20/07/2026 contrastado con el informe de Bolt coche a coche: la espera
// legítima más larga fue 4,54 h y el caso patológico más claro 16,1 h.
const MAX_TRAMO_SEG = 6 * 3600;

// Se descarga algo antes del primer día a recalcular para no perder el tramo
// que ya venía en curso al cruzar la medianoche.
const MARGEN_ANTES_SEG = 6 * 3600;

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

  // 1. Caché del mes en curso. Si la hoja trae otro mes se ignora: antes, en la
  // primera ejecución de cada mes, se sumaban los días del mes anterior que aún
  // seguían escritos y "Flotas Unificadas" mostraba casi el doble durante una hora.
  const cache = await leerCache(mes, ano);
  const diasCalculados = Object.keys(cache).map(Number);

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

    const inicioTs = Math.floor(new Date(ano, mes - 1, primerDia, 0, 0, 0).getTime() / 1000);
    const startTs = inicioTs - MARGEN_ANTES_SEG;
    const endTs = (ultimoDia === diaActual)
      ? Math.floor(ahoraMs / 1000)
      : Math.floor(new Date(ano, mes - 1, ultimoDia + 1, 0, 0, 0).getTime() / 1000);

    console.log(`🔍 Bolt: días ${primerDia} → ${ultimoDia}`);

    for (const d of diasFaltantes) cache[d] = crearCacheVacio();

    // ═══════════════════════════════════
    // STATE LOGS (horas, waiting, has_order)
    // ═══════════════════════════════════
    for (const flota of CONFIG_BOLT.flotas) {
      // fetchRangoCompleto y no fetchAllPaginated: parte el rango si la API lo
      // rechaza por largo (498806) o da timeout. Antes, en la primera ejecución
      // de un mes se pedían hasta 31 días de golpe y un fallo devolvía datos
      // parciales que se congelaban en la caché para siempre.
      const stateLogs = await fetchRangoCompleto(
        '/fleetIntegration/v1/getFleetStateLogs', { company_id: flota.id },
        'state_logs', startTs, endTs, 1000, 'resumen-logs-' + flota.id
      );
      await sleep(1000);

      acumularHoras(stateLogs, flota.id, cache, diasFaltantes, mes, ano, endTs);
    }

    // ═══════════════════════════════════
    // FACTURACIÓN Y VIAJES POR DÍA
    // ═══════════════════════════════════
    for (const flota of CONFIG_BOLT.flotas) {
      // Un día hacia atrás de margen: getFleetOrders filtra por fecha de
      // creación, pero el día se asigna por la de finalización. Sin margen, una
      // carrera creada a las 23:50 y terminada a las 00:20 no se pedía nunca.
      const ordenes = await fetchRangoCompleto(
        '/fleetIntegration/v1/getFleetOrders',
        { company_ids: [flota.id], company_id: flota.id, time_range_filter_type: 'created' },
        'orders', startTs - 86400, endTs, 500, 'resumen-ordenes-' + flota.id
      );
      await sleep(1000);

      ordenes.forEach(o => {
        const ts = o.order_finished_timestamp || o.order_created_timestamp;
        if (!ts) return;

        const f = new Date(ts * 1000);
        if (f.getMonth() + 1 !== mes || f.getFullYear() !== ano) return;

        const diaOrden = f.getDate();
        if (!diasFaltantes.includes(diaOrden)) return;
        if (!cache[diaOrden]) cache[diaOrden] = crearCacheVacio();

        if (o.order_price && o.order_price.net_earnings) {
          cache[diaOrden].facturacion += o.order_price.net_earnings;
        }
        if (o.order_status === 'finished') cache[diaOrden].viajes++;
      });
    }

    await guardarCache(cache, mes, ano);
  }

  // 2. Totales sumando TODA la caché (en segundos, sin redondeos intermedios)
  let totalW = 0, totalHO = 0, totalFact = 0, totalViajes = 0;
  for (const datos of Object.values(cache)) {
    totalW += (datos.waiting || 0);
    totalHO += (datos.hasOrder || 0);
    totalFact += (datos.facturacion || 0);
    totalViajes += (datos.viajes || 0);
  }

  console.log(`💰 Total: W=${(totalW / 3600).toFixed(1)}h | HO=${(totalHO / 3600).toFixed(1)}h | Fact=${totalFact.toFixed(2)}€ | Viajes=${totalViajes}`);

  // 3. HORAS_POR_DIA (9 columnas, formato intacto)
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
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const values15 = [['FECHA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'ACUMULADO']];
  let ac15 = 0;
  const ft = new Date(fechaInicio);
  while (ft <= fechaFin) {
    const d = ft.getDate();
    const em = ft.getMonth() === ahora.getMonth() && ft.getFullYear() === ahora.getFullYear();
    const dat = em ? (cache[d] || crearCacheVacio()) : crearCacheVacio();
    const t = (dat.flota63530 + dat.flota143626) / 3600;
    ac15 += t;
    values15.push([`${meses[ft.getMonth()]} ${d}`, (dat.flota63530 / 3600).toFixed(2), (dat.flota143626 / 3600).toFixed(2), t.toFixed(2), ac15.toFixed(2)]);
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
    [(totalW / 3600).toFixed(2), (totalHO / 3600).toFixed(2), totalViajes, totalFact.toFixed(2), vph]
  ];

  await clearSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:F');
  await writeSheet(SPREADSHEET_ID, 'Flotas Unificadas!A1', valuesUni);
  console.log(`✅ Unificadas: W=${(totalW / 3600).toFixed(1)} | HO=${(totalHO / 3600).toFixed(1)} | V=${totalViajes} | €=${totalFact.toFixed(2)} | V/h=${vph}`);

  return { diasCache: diasCalculados.length, diasNuevos: diasFaltantes.length };
}


// ═══════════════════════════════
// CÁLCULO DE HORAS
// ═══════════════════════════════

/**
 * Convierte los state logs en segundos por día, flota y estado.
 *
 * Tres diferencias con la versión anterior:
 *  · el último tramo de cada conductor ya no se descarta (antes: `if (i+1 >=
 *    logs.length) continue`), se cierra al final de la ventana
 *  · los tramos se reparten por medianoche en vez de imputarse enteros al día
 *    del log inicial, así que un turno de 23:40 a 00:50 ya no suma 70 min al día
 *    anterior
 *  · se aplica MAX_TRAMO_SEG a los huecos sin telemetría
 */
function acumularHoras(stateLogs, flotaId, cache, diasFaltantes, mes, ano, cierreTs) {
  const logsPorDriver = {};
  stateLogs.forEach(log => {
    const duuid = log.driver_uuid || 'unknown';
    if (!logsPorDriver[duuid]) logsPorDriver[duuid] = [];
    logsPorDriver[duuid].push(log);
  });

  let recortados = 0, segRecortados = 0;

  for (const logs of Object.values(logsPorDriver)) {
    logs.sort((a, b) => a.created - b.created);

    for (let i = 0; i < logs.length; i++) {
      const estado = logs[i].state;
      if (!STATE_VIAJE.includes(estado)) continue;

      const inicio = logs[i].created;
      let fin = (i + 1 < logs.length) ? logs[i + 1].created : cierreTs;

      if (fin - inicio > MAX_TRAMO_SEG) {
        segRecortados += (fin - inicio) - MAX_TRAMO_SEG;
        recortados++;
        fin = inicio + MAX_TRAMO_SEG;
      }
      if (fin <= inicio) continue;

      repartirPorDias(inicio, fin, (dia, seg, mesTramo, anoTramo) => {
        if (mesTramo !== mes || anoTramo !== ano) return;
        if (!diasFaltantes.includes(dia)) return;
        if (!cache[dia]) cache[dia] = crearCacheVacio();

        if (flotaId === 63530) cache[dia].flota63530 += seg;
        else cache[dia].flota143626 += seg;

        if (estado === 'waiting_orders') cache[dia].waiting += seg;
        else cache[dia].hasOrder += seg;
      });
    }
  }

  if (recortados > 0) {
    console.log(`✂️  [flota ${flotaId}] ${recortados} tramos superaban ${MAX_TRAMO_SEG / 3600} h: ` +
      `${(segRecortados / 3600).toFixed(1)} h descartadas (huecos sin telemetría)`);
  }
}

/** Parte un tramo por medianoches y llama cb(dia, segundos, mes, ano) por trozo. */
function repartirPorDias(inicio, fin, cb) {
  let cursor = inicio;
  while (cursor < fin) {
    const f = new Date(cursor * 1000);
    const dia = f.getDate();
    const mes = f.getMonth();
    const ano = f.getFullYear();
    const medianoche = Math.floor(new Date(ano, mes, dia + 1, 0, 0, 0).getTime() / 1000);
    const corte = Math.min(fin, medianoche);
    if (corte > cursor) cb(dia, corte - cursor, mes + 1, ano);
    cursor = corte;
  }
}


// ═══════════════════════════════
// CACHÉ EN SEGUNDOS
// ═══════════════════════════════

function crearCacheVacio() {
  return { flota63530: 0, flota143626: 0, waiting: 0, hasOrder: 0, facturacion: 0, viajes: 0 };
}

async function leerCache(mes, ano) {
  try {
    const data = await readSheet(SPREADSHEET_ID, `${HOJA_CACHE}!A:I`);
    const cache = {};
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      const dia = parseInt(fila[0]);
      if (isNaN(dia) || dia === 0) continue;
      // Solo el mes en curso: así la primera ejecución de cada mes no arrastra
      // los días del anterior.
      if (parseInt(fila[1]) !== mes || parseInt(fila[2]) !== ano) continue;

      cache[dia] = {
        flota63530: parseFloat(fila[3]) || 0,
        flota143626: parseFloat(fila[4]) || 0,
        waiting: parseFloat(fila[5]) || 0,
        hasOrder: parseFloat(fila[6]) || 0,
        facturacion: parseFloat(fila[7]) || 0,
        viajes: parseInt(fila[8]) || 0
      };
    }
    console.log(`📋 Caché: ${Object.keys(cache).length} días de ${mes}/${ano}`);
    return cache;
  } catch (e) {
    console.log(`📋 Caché vacía (${e.message})`);
    return {};
  }
}

async function guardarCache(cache, mes, ano) {
  await ensureSheet(SPREADSHEET_ID, HOJA_CACHE);

  const filas = [['DIA', 'MES', 'ANO', 'F63530_SEG', 'F143626_SEG', 'WAITING_SEG', 'HASORDER_SEG', 'FACTURACION', 'VIAJES']];
  Object.keys(cache)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach(d => {
      const c = cache[d];
      filas.push([d, mes, ano, c.flota63530, c.flota143626, c.waiting, c.hasOrder, c.facturacion, c.viajes]);
    });

  await clearSheet(SPREADSHEET_ID, `${HOJA_CACHE}!A:Z`);
  await writeSheet(SPREADSHEET_ID, `${HOJA_CACHE}!A1`, filas);
}

module.exports = { actualizarTodo };
