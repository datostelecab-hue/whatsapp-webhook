const { CONFIG_BOLT, fetchRangoCompleto, apiRequest, sleep } = require('./bolt');
const { readSheet, writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;

// Un estado dura hasta el siguiente log, pero si la app deja de reportar sin
// pasar por 'inactive' ese hueco no es tiempo trabajado: Bolt cierra la sesión
// con la telemetría del móvil, que la API no expone. Umbral empírico del
// 20/07/2026 contrastado con el informe de Bolt coche a coche: la espera
// legítima más larga fue 4,54 h y el caso patológico más claro 16,1 h.
const MAX_TRAMO_SEG = 6 * 3600;

// Se descarga algo antes del primer día a recalcular para no perder el tramo
// que ya venía en curso al cruzar la medianoche.
const MARGEN_ANTES_SEG = 6 * 3600;

// ─── Regiones ────────────────────────────────────────────────────────
// Cada región tiene sus flotas y sus hojas. Madrid conserva los nombres de
// siempre (hay IMPORTRANGE y visor colgando de ellos); Barcelona estrena hojas.
const FLOTAS_MADRID = [63530, 143626];

// ID de la flota de Barcelona. null = autodetectar con getCompanies: todas las
// empresas a las que llega el token menos las de Madrid. Si Bolt os da acceso a
// más empresas en el futuro, fija aquí el ID a mano.
const FLOTA_BARCELONA = null;

const REGION_MADRID = {
  nombre: 'Madrid',
  flotas: FLOTAS_MADRID,
  hojaPorDia: 'HORAS_POR_DIA',
  hoja15: 'HORAS_15_DIAS',
  hojaUnificadas: 'Flotas Unificadas',
  hojaCache: 'CACHE_SEGUNDOS'
};

const REGION_BARCELONA = {
  nombre: 'Barcelona',
  flotas: null,                       // se resuelve en tiempo de ejecución
  hojaPorDia: 'FlotaBarcelona',
  hoja15: 'HORAS_15_DIAS_BARCELONA',
  hojaUnificadas: 'Flotas Unificadas Barcelona',
  hojaCache: 'CACHE_SEGUNDOS_BARCELONA'
};

let ultimaEjecucion = 0;
const COOLDOWN = 60;
let flotasBarcelonaDetectadas = null;

async function actualizarTodo() {
  const ahora = new Date();
  const ahoraMs = ahora.getTime();

  if (ahoraMs - ultimaEjecucion < COOLDOWN * 1000) {
    console.log(`⏳ Cooldown. Espera ${COOLDOWN}s`);
    return { status: 'cooldown' };
  }
  ultimaEjecucion = ahoraMs;

  const regiones = [REGION_MADRID];

  // Barcelona solo si conocemos su flota. Un fallo aquí no debe tumbar Madrid.
  try {
    const flotasBcn = await resolverFlotasBarcelona();
    if (flotasBcn.length > 0) {
      regiones.push({ ...REGION_BARCELONA, flotas: flotasBcn });
    } else {
      console.log('🏙️ [Barcelona] Sin flota detectada: se omite esta región');
    }
  } catch (e) {
    console.error(`❌ [Barcelona] No se pudo resolver la flota: ${e.message}`);
  }

  const resultado = {};
  for (const region of regiones) {
    try {
      resultado[region.nombre] = await actualizarRegion(region, ahora);
    } catch (e) {
      // Que un fallo en una región no impida actualizar la otra.
      console.error(`❌ [${region.nombre}] ${e.message}`);
      resultado[region.nombre] = { error: e.message };
    }
  }
  return resultado;
}

async function resolverFlotasBarcelona() {
  if (FLOTA_BARCELONA) return [FLOTA_BARCELONA];
  if (flotasBarcelonaDetectadas) return flotasBarcelonaDetectadas;

  const r = await apiRequest('/fleetIntegration/v1/getCompanies', 'GET');
  const ids = (r.data && r.data.data && r.data.data.company_ids) || [];
  const otras = ids.filter(id => !FLOTAS_MADRID.includes(id));
  console.log(`🏙️ getCompanies → [${ids.join(', ')}] | Barcelona: [${otras.join(', ') || 'ninguna'}]`);

  flotasBarcelonaDetectadas = otras;
  return otras;
}


// ═══════════════════════════════
// UNA REGIÓN COMPLETA
// ═══════════════════════════════

async function actualizarRegion(region, ahora) {
  const tag = region.nombre;
  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  const diaActual = ahora.getDate();
  const hora = ahora.getHours();
  const diasDelMes = new Date(ano, mes, 0).getDate();

  // Caché del mes en curso, en SEGUNDOS y con sello de mes/año: sin redondeos
  // reinyectados y sin arrastrar el mes anterior en la primera ejecución.
  const cache = await leerCache(region, mes, ano);
  const diasCalculados = Object.keys(cache).map(Number);

  const diasFaltantes = [];
  for (let d = 1; d <= diaActual; d++) {
    if (!diasCalculados.includes(d) || d === diaActual || (hora === 0 && d === diaActual - 1)) {
      diasFaltantes.push(d);
    }
  }

  console.log(`📊 [${tag}] Caché: ${diasCalculados.length} días | Recalculando: ${diasFaltantes.join(',')}`);

  if (diasFaltantes.length > 0) {
    const primerDia = Math.min(...diasFaltantes);
    const ultimoDia = Math.max(...diasFaltantes);

    const inicioTs = Math.floor(new Date(ano, mes - 1, primerDia, 0, 0, 0).getTime() / 1000);
    const startTs = inicioTs - MARGEN_ANTES_SEG;
    const endTs = (ultimoDia === diaActual)
      ? Math.floor(ahora.getTime() / 1000)
      : Math.floor(new Date(ano, mes - 1, ultimoDia + 1, 0, 0, 0).getTime() / 1000);

    for (const d of diasFaltantes) cache[d] = crearCacheVacio(region);

    // ---- State logs (horas) ----
    for (const flotaId of region.flotas) {
      const stateLogs = await fetchRangoCompleto(
        '/fleetIntegration/v1/getFleetStateLogs', { company_id: flotaId },
        'state_logs', startTs, endTs, 1000, `${tag}-logs-${flotaId}`
      );
      await sleep(1000);

      acumularHoras(stateLogs, flotaId, cache, region, diasFaltantes, mes, ano, endTs);
    }

    // ---- Facturación y viajes ----
    for (const flotaId of region.flotas) {
      // Un día hacia atrás de margen: getFleetOrders filtra por fecha de
      // creación pero el día se asigna por la de finalización.
      const ordenes = await fetchRangoCompleto(
        '/fleetIntegration/v1/getFleetOrders',
        { company_ids: [flotaId], company_id: flotaId, time_range_filter_type: 'created' },
        'orders', startTs - 86400, endTs, 500, `${tag}-ordenes-${flotaId}`
      );
      await sleep(1000);

      ordenes.forEach(o => {
        const ts = o.order_finished_timestamp || o.order_created_timestamp;
        if (!ts) return;

        const f = new Date(ts * 1000);
        if (f.getMonth() + 1 !== mes || f.getFullYear() !== ano) return;

        const diaOrden = f.getDate();
        if (!diasFaltantes.includes(diaOrden)) return;
        if (!cache[diaOrden]) cache[diaOrden] = crearCacheVacio(region);

        if (o.order_price && o.order_price.net_earnings) {
          cache[diaOrden].facturacion += o.order_price.net_earnings;
        }
        if (o.order_status === 'finished') cache[diaOrden].viajes++;
      });
    }

    await guardarCache(region, cache, mes, ano);
  }

  // ---- Totales del mes ----
  let totalW = 0, totalHO = 0, totalFact = 0, totalViajes = 0;
  for (const datos of Object.values(cache)) {
    totalW += (datos.waiting || 0);
    totalHO += (datos.hasOrder || 0);
    totalFact += (datos.facturacion || 0);
    totalViajes += (datos.viajes || 0);
  }

  console.log(`💰 [${tag}] W=${(totalW / 3600).toFixed(1)}h | HO=${(totalHO / 3600).toFixed(1)}h | ` +
    `Fact=${totalFact.toFixed(2)}€ | Viajes=${totalViajes}`);

  // ---- Hoja de horas por día ----
  const ultimoDiaMostrar = Math.min(diaActual + DIAS_VENTANA_FUTURA, diasDelMes);
  await ensureSheet(SPREADSHEET_ID, region.hojaPorDia);

  const cabecera = ['DÍA'];
  region.flotas.forEach(f => cabecera.push('FLOTA ' + f));
  cabecera.push('TOTAL', 'WAITING', 'HAS_ORDER', 'FACTURACIÓN', 'VIAJES', 'ACUMULADO POR DÍA');

  const valuesPorDia = [cabecera];
  let acumulado = 0;

  for (let d = 0; d <= ultimoDiaMostrar; d++) {
    const dat = cache[d] || crearCacheVacio(region);
    const esFuturo = d > diaActual;

    if (esFuturo) {
      valuesPorDia.push([d.toString()].concat(new Array(cabecera.length - 1).fill('')));
    } else {
      const porFlota = region.flotas.map(f => (dat.porFlota[f] || 0) / 3600);
      const total = porFlota.reduce((s, h) => s + h, 0);
      // El día en curso también acumula: el visor debe estar "en vivo" hasta la
      // última pasada del cron, no congelado en ayer.
      acumulado += total;

      valuesPorDia.push([
        d.toString(),
        ...porFlota.map(h => h.toFixed(1)),
        total.toFixed(1),
        (dat.waiting / 3600).toFixed(1),
        (dat.hasOrder / 3600).toFixed(1),
        dat.facturacion > 0 ? dat.facturacion.toFixed(2) : '',
        dat.viajes > 0 ? dat.viajes.toString() : '',
        acumulado.toFixed(1)
      ]);
    }
  }

  await clearSheet(SPREADSHEET_ID, `${region.hojaPorDia}!A:Z`);
  await writeSheet(SPREADSHEET_ID, `${region.hojaPorDia}!A1`, valuesPorDia);

  // ---- Últimos 15 días ----
  await ensureSheet(SPREADSHEET_ID, region.hoja15);
  // Termina en HOY (en curso hasta la última pasada del cron), no en ayer.
  const fechaFin = new Date(ahora);
  const fechaInicio = new Date(fechaFin); fechaInicio.setDate(fechaInicio.getDate() - 14);
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const cabecera15 = ['FECHA'];
  region.flotas.forEach(f => cabecera15.push('FLOTA ' + f));
  cabecera15.push('TOTAL', 'ACUMULADO');

  const values15 = [cabecera15];
  let ac15 = 0;
  const ft = new Date(fechaInicio);
  while (ft <= fechaFin) {
    const d = ft.getDate();
    const em = ft.getMonth() === ahora.getMonth() && ft.getFullYear() === ahora.getFullYear();
    const dat = em ? (cache[d] || crearCacheVacio(region)) : crearCacheVacio(region);
    const porFlota = region.flotas.map(f => (dat.porFlota[f] || 0) / 3600);
    const t = porFlota.reduce((s, h) => s + h, 0);
    ac15 += t;
    values15.push([
      `${meses[ft.getMonth()]} ${d}`,
      ...porFlota.map(h => h.toFixed(2)),
      t.toFixed(2),
      ac15.toFixed(2)
    ]);
    ft.setDate(ft.getDate() + 1);
  }
  await clearSheet(SPREADSHEET_ID, `${region.hoja15}!A:Z`);
  await writeSheet(SPREADSHEET_ID, `${region.hoja15}!A1`, values15);

  // ---- Unificadas ----
  await ensureSheet(SPREADSHEET_ID, region.hojaUnificadas);
  const horasTotal = (totalW + totalHO) / 3600;
  const vph = horasTotal > 0 ? (totalViajes / horasTotal).toFixed(2) : '0.00';

  const valuesUni = [
    ['Horas Waiting Orders', 'Horas Has Order', 'Viajes Completados', 'Facturación (net_earnings)', 'Viajes/Hora'],
    [(totalW / 3600).toFixed(2), (totalHO / 3600).toFixed(2), totalViajes, totalFact.toFixed(2), vph]
  ];

  await clearSheet(SPREADSHEET_ID, `${region.hojaUnificadas}!A:F`);
  await writeSheet(SPREADSHEET_ID, `${region.hojaUnificadas}!A1`, valuesUni);
  console.log(`✅ [${tag}] ${region.hojaUnificadas}: W=${(totalW / 3600).toFixed(1)} | ` +
    `HO=${(totalHO / 3600).toFixed(1)} | V=${totalViajes} | €=${totalFact.toFixed(2)} | V/h=${vph}`);

  return { diasCache: diasCalculados.length, diasNuevos: diasFaltantes.length };
}


// ═══════════════════════════════
// CÁLCULO DE HORAS
// ═══════════════════════════════

/**
 * State logs → segundos por día, flota y estado.
 *  · el último tramo de cada conductor se cierra al final de la ventana (no se
 *    descarta, como hacía la versión antigua)
 *  · los tramos se reparten por medianoche
 *  · los huecos sin telemetría se recortan a MAX_TRAMO_SEG
 */
function acumularHoras(stateLogs, flotaId, cache, region, diasFaltantes, mes, ano, cierreTs) {
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
        if (!cache[dia]) cache[dia] = crearCacheVacio(region);

        cache[dia].porFlota[flotaId] = (cache[dia].porFlota[flotaId] || 0) + seg;
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
// CACHÉ EN SEGUNDOS (una hoja por región)
// ═══════════════════════════════

function crearCacheVacio(region) {
  const c = { porFlota: {}, waiting: 0, hasOrder: 0, facturacion: 0, viajes: 0 };
  region.flotas.forEach(f => c.porFlota[f] = 0);
  return c;
}

async function leerCache(region, mes, ano) {
  try {
    const data = await readSheet(SPREADSHEET_ID, `${region.hojaCache}!A:Z`);
    const cache = {};
    const nFlotas = region.flotas.length;

    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      const dia = parseInt(fila[0]);
      if (isNaN(dia) || dia === 0) continue;
      // Solo el mes en curso: la primera ejecución de cada mes no debe arrastrar
      // los días del anterior.
      if (parseInt(fila[1]) !== mes || parseInt(fila[2]) !== ano) continue;

      const c = crearCacheVacio(region);
      region.flotas.forEach((f, idx) => { c.porFlota[f] = parseFloat(fila[3 + idx]) || 0; });
      c.waiting = parseFloat(fila[3 + nFlotas]) || 0;
      c.hasOrder = parseFloat(fila[4 + nFlotas]) || 0;
      c.facturacion = parseFloat(fila[5 + nFlotas]) || 0;
      c.viajes = parseInt(fila[6 + nFlotas]) || 0;
      cache[dia] = c;
    }
    console.log(`📋 [${region.nombre}] Caché: ${Object.keys(cache).length} días de ${mes}/${ano}`);
    return cache;
  } catch (e) {
    console.log(`📋 [${region.nombre}] Caché vacía (${e.message})`);
    return {};
  }
}

async function guardarCache(region, cache, mes, ano) {
  await ensureSheet(SPREADSHEET_ID, region.hojaCache);

  const cabecera = ['DIA', 'MES', 'ANO'];
  region.flotas.forEach(f => cabecera.push(`F${f}_SEG`));
  cabecera.push('WAITING_SEG', 'HASORDER_SEG', 'FACTURACION', 'VIAJES');

  const filas = [cabecera];
  Object.keys(cache)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach(d => {
      const c = cache[d];
      filas.push([
        d, mes, ano,
        ...region.flotas.map(f => c.porFlota[f] || 0),
        c.waiting, c.hasOrder, c.facturacion, c.viajes
      ]);
    });

  await clearSheet(SPREADSHEET_ID, `${region.hojaCache}!A:Z`);
  await writeSheet(SPREADSHEET_ID, `${region.hojaCache}!A1`, filas);
}

module.exports = { actualizarTodo };
