const { CONFIG_BOLT, fetchRangoCompleto, apiRequest, sleep } = require('./bolt');
const { readSheet, writeSheet, clearSheet, ensureSheet } = require('./sheets');

const STATE_VIAJE = ['has_order', 'waiting_orders'];
const SPREADSHEET_ID = '1ixCx1SHICLv_VjrrOs030YswcNSOBbiET2_T_f1Gkm8';
const DIAS_VENTANA_FUTURA = 7;
const DIAS_HISTORICO_MANTENER = 45;   // días que se conservan en el histórico diario

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
const FLOTAS_MADRID = [143626];

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
  hojaCache: 'CACHE_SEGUNDOS',
  hojaHistorico: 'HISTORICO_DIARIO'
};

const REGION_BARCELONA = {
  nombre: 'Barcelona',
  flotas: null,                       // se resuelve en tiempo de ejecución
  hojaPorDia: 'FlotaBarcelona',
  hoja15: 'HORAS_15_DIAS_BARCELONA',
  hojaUnificadas: 'Flotas Unificadas Barcelona',
  hojaCache: 'CACHE_SEGUNDOS_BARCELONA',
  hojaHistorico: 'HISTORICO_DIARIO_BARCELONA'
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
  let maxLogTs = 0;   // instrumentación: el state-log más reciente que devuelve Bolt (para ver si HOY se congela)

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

      for (const l of stateLogs) { if (l.created > maxLogTs) maxLogTs = l.created; }
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
    const esFuturo = d >= diaActual;   // HOY también se deja en blanco (día a medias)

    if (esFuturo) {
      valuesPorDia.push([d.toString()].concat(new Array(cabecera.length - 1).fill('')));
    } else {
      const porFlota = region.flotas.map(f => (dat.porFlota[f] || 0) / 3600);
      const total = porFlota.reduce((s, h) => s + h, 0);
      // Solo días ya cerrados (hoy queda en blanco): la serie no arrastra un día a
      // medias, que en los gráficos dibuja una bajada.
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

  // ---- Últimos 15 días (independiente del mes: histórico diario propio) ----
  // El resumen de 15 días NO depende del caché mensual (se vacía cada mes y por eso
  // a principios de mes solo salían 2-3 días). Se mantiene un HISTÓRICO DIARIO propio,
  // por fecha completa, que cruza meses: se vuelcan los días ya cerrados del mes en
  // curso y lo que falte (p. ej. el mes anterior la 1ª vez) se trae UNA vez de la API.
  // HOY no entra en la serie (un día a medias dibuja una bajada); su valor en curso va
  // en una columna aparte, para poder pintarlo como un punto suelto en el gráfico.
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const hist = await leerHistorico(region);

  // 1) Vuelca al histórico los días YA COMPLETOS del mes en curso (todos menos hoy).
  for (let d = 1; d < diaActual; d++) {
    const c = cache[d];
    if (!c) continue;
    const porFlota = {}; let total = 0;
    region.flotas.forEach(f => { const h = (c.porFlota[f] || 0) / 3600; porFlota[f] = h; total += h; });
    hist[claveFecha(ano, mes, d)] = { porFlota, total };
  }

  // 2) Ventana: los 15 días ANTERIORES a hoy (termina ayer).
  const hoy0 = new Date(ano, mes - 1, diaActual);
  const fechasVentana = [];
  for (let i = 15; i >= 1; i--) { const f = new Date(hoy0); f.setDate(f.getDate() - i); fechasVentana.push(f); }

  // 3) Lo que falte en el histórico (típicamente el mes anterior la 1ª vez) → API.
  const faltan = fechasVentana.filter(f => !hist[claveFecha(f.getFullYear(), f.getMonth() + 1, f.getDate())]);
  if (faltan.length) {
    console.log(`🕳️ [${tag}] 15 días: faltan ${faltan.length} día(s) en el histórico → backfill desde la API`);
    Object.assign(hist, await backfillFechas(region, faltan, ahora, tag));
  }
  await guardarHistorico(region, hist);

  // 4) HOY en curso: un solo valor, en columna aparte (la serie no lo cuenta).
  const cHoy = cache[diaActual];
  const hoyTotal = cHoy ? region.flotas.reduce((s, f) => s + (cHoy.porFlota[f] || 0) / 3600, 0) : 0;
  // Instrumentación: si "último state-log" avanza pero HOY no crece, el valor de hoy se
  // está congelando (probable recorte de 6h del tramo abierto); si no avanza, Bolt no da datos.
  const ultimoLogTxt = maxLogTs
    ? new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(maxLogTs * 1000))
    : '—';
  console.log(`🕐 [${tag}] HOY (día ${diaActual}) = ${hoyTotal.toFixed(1)} h · último state-log de Bolt = ${ultimoLogTxt}`);

  // 5) Escribe la hoja de 15 días.
  await ensureSheet(SPREADSHEET_ID, region.hoja15);
  const nF = region.flotas.length;
  const cabecera15 = ['FECHA'];
  region.flotas.forEach(f => cabecera15.push('FLOTA ' + f));
  const selloAct = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(ahora);
  cabecera15.push('TOTAL', 'ACUMULADO', '', `HOY (${meses[ahora.getMonth()]} ${diaActual}) · act. ${selloAct}`);

  const values15 = [cabecera15];
  let ac15 = 0;
  fechasVentana.forEach((f, idx) => {
    const h = hist[claveFecha(f.getFullYear(), f.getMonth() + 1, f.getDate())] || { porFlota: {}, total: 0 };
    ac15 += h.total;
    const fila = new Array(cabecera15.length).fill('');
    fila[0] = `${meses[f.getMonth()]} ${f.getDate()}`;
    region.flotas.forEach((fl, k) => { fila[1 + k] = (h.porFlota[fl] || 0).toFixed(2); });
    fila[1 + nF] = h.total.toFixed(2);
    fila[2 + nF] = ac15.toFixed(2);
    if (idx === 0) fila[4 + nF] = hoyTotal.toFixed(2);   // valor de HOY, en su columna autónoma
    values15.push(fila);
  });
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
    // Si el caché guardado tiene OTRAS flotas (p. ej. se quitó una), sus columnas
    // ya no cuadran con las actuales y se desalinearía todo: se ignora y se
    // recalcula limpio desde la API en esta pasada.
    const flotasG = (data[0] || []).map(String).filter(c => /^F\d+_SEG$/i.test(c)).map(c => parseInt(c.match(/\d+/)[0], 10));
    if (data.length > 1 && !(flotasG.length === region.flotas.length && region.flotas.every(f => flotasG.includes(f)))) {
      console.log(`♻️  [${region.nombre}] Caché con flotas [${flotasG.join(',')}] ≠ [${region.flotas.join(',')}] → se recalcula el mes`);
      return {};
    }
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


// ═══════════════════════════════
// HISTÓRICO DIARIO (cruza meses; alimenta el resumen de 15 días)
// ═══════════════════════════════

const claveFecha = (ano, mes, dia) => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

async function leerHistorico(region) {
  try {
    const data = await readSheet(SPREADSHEET_ID, `${region.hojaHistorico}!A:Z`);
    // Igual que el caché: si el histórico se escribió con otras flotas, se ignora
    // y se reconstruye (backfill) con la lista actual, para no desalinear columnas.
    const flotasG = (data[0] || []).map(String).filter(c => /^FLOTA\s+\d+$/i.test(c)).map(c => parseInt(c.match(/\d+/)[0], 10));
    if (data.length > 1 && !(flotasG.length === region.flotas.length && region.flotas.every(f => flotasG.includes(f)))) {
      console.log(`♻️  [${region.nombre}] Histórico con flotas [${flotasG.join(',')}] ≠ actuales → se reconstruye`);
      return {};
    }
    const hist = {};
    const nF = region.flotas.length;
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      const fecha = (fila[0] || '').toString().trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
      const porFlota = {};
      region.flotas.forEach((f, idx) => { porFlota[f] = parseFloat(fila[1 + idx]) || 0; });
      hist[fecha] = { porFlota, total: parseFloat(fila[1 + nF]) || 0 };
    }
    return hist;
  } catch (e) {
    console.log(`📅 [${region.nombre}] Histórico diario vacío (${e.message})`);
    return {};
  }
}

async function guardarHistorico(region, hist) {
  await ensureSheet(SPREADSHEET_ID, region.hojaHistorico);
  const cab = ['FECHA'];
  region.flotas.forEach(f => cab.push('FLOTA ' + f));
  cab.push('TOTAL');
  // Ordena por fecha y conserva solo los últimos días (acota el tamaño de la hoja).
  const recientes = Object.keys(hist).sort().slice(-DIAS_HISTORICO_MANTENER);
  const filas = [cab];
  recientes.forEach(fk => {
    const h = hist[fk];
    filas.push([fk, ...region.flotas.map(f => +((h.porFlota[f] || 0).toFixed(4))), +(h.total.toFixed(4))]);
  });
  await clearSheet(SPREADSHEET_ID, `${region.hojaHistorico}!A:Z`);
  await writeSheet(SPREADSHEET_ID, `${region.hojaHistorico}!A1`, filas);
}

/**
 * Trae de la API las horas por flota de unas fechas concretas y las deja en formato
 * de histórico { 'YYYY-MM-DD': { porFlota:{id:horas}, total } }. Se usa solo para
 * rellenar lo que aún no está en el histórico (bootstrap y tras cambiar de mes).
 */
async function backfillFechas(region, fechas, ahora, tag) {
  const orden = fechas.slice().sort((a, b) => a - b);
  const primera = orden[0], ultima = orden[orden.length - 1];
  const startTs = Math.floor(new Date(primera.getFullYear(), primera.getMonth(), primera.getDate(), 0, 0, 0).getTime() / 1000) - MARGEN_ANTES_SEG;
  const finExcl = new Date(ultima.getFullYear(), ultima.getMonth(), ultima.getDate() + 1, 0, 0, 0);
  const endTs = Math.min(Math.floor(finExcl.getTime() / 1000), Math.floor(ahora.getTime() / 1000));
  const quiero = new Set(fechas.map(f => claveFecha(f.getFullYear(), f.getMonth() + 1, f.getDate())));

  const seg = {};   // 'YYYY-MM-DD' → { flotaId: segundos }
  for (const flotaId of region.flotas) {
    const logs = await fetchRangoCompleto(
      '/fleetIntegration/v1/getFleetStateLogs', { company_id: flotaId },
      'state_logs', startTs, endTs, 1000, `${tag}-hist-${flotaId}`
    );
    await sleep(1000);

    const porDriver = {};
    logs.forEach(l => { const k = l.driver_uuid || 'u'; (porDriver[k] = porDriver[k] || []).push(l); });
    for (const arr of Object.values(porDriver)) {
      arr.sort((a, b) => a.created - b.created);
      for (let i = 0; i < arr.length; i++) {
        if (!STATE_VIAJE.includes(arr[i].state)) continue;
        const ini = arr[i].created;
        let fin = (i + 1 < arr.length) ? arr[i + 1].created : endTs;
        if (fin - ini > MAX_TRAMO_SEG) fin = ini + MAX_TRAMO_SEG;
        if (fin <= ini) continue;
        repartirPorDias(ini, fin, (dia, s, m, a) => {
          const key = claveFecha(a, m, dia);
          if (!quiero.has(key)) return;
          if (!seg[key]) seg[key] = {};
          seg[key][flotaId] = (seg[key][flotaId] || 0) + s;
        });
      }
    }
  }

  // Segundos → horas. Se registran TODAS las fechas pedidas (aunque den 0) para no
  // volver a pedirlas a la API en cada pasada.
  const out = {};
  for (const key of quiero) {
    const porFlota = {}; let total = 0;
    region.flotas.forEach(f => { const h = ((seg[key] && seg[key][f]) || 0) / 3600; porFlota[f] = h; total += h; });
    out[key] = { porFlota, total };
  }
  return out;
}

module.exports = { actualizarTodo };
