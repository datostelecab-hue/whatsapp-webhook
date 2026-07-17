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
    const diasDelMes = new Date(ano, mes, 0).getDate();

    // 1. Leer caché del Sheet
    const cache = await leerCacheHorasPorDia();
    const diasCalculados = Object.keys(cache).map(Number);

    const diasFaltantes = [];
    for (let d = 1; d <= diaActual; d++) {
        if (!diasCalculados.includes(d)) diasFaltantes.push(d);
    }

    console.log(`📊 Días en caché: ${diasCalculados.length} | Días a consultar: ${diasFaltantes.length}`);

    let facturacionNueva = 0;
    let viajesCompletadosNuevos = 0;

    if (diasFaltantes.length > 0) {
        const primerDia = Math.min(...diasFaltantes);
        const ultimoDia = Math.max(...diasFaltantes);

        const startTs = Math.floor(new Date(ano, mes - 1, primerDia, 0, 0, 0).getTime() / 1000);
        const endTs = Math.floor(new Date(ano, mes - 1, ultimoDia, 23, 59, 59).getTime() / 1000);

        console.log(`🔍 Consultando Bolt: días ${primerDia} → ${ultimoDia}`);

        const flotas = [
            { id: 63530, nombre: 'Flota 63530' },
            { id: 143626, nombre: 'Flota 143626' }
        ];

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
                    const inicio = logs[i].created;
                    const fin = logs[i + 1].created;
                    const duracion = fin - inicio;
                    if (duracion <= 0) continue;

                    if (!diasFaltantes.includes(dia)) continue;

                    if (!cache[dia]) cache[dia] = { flota63530: 0, flota143626: 0, waiting: 0, hasOrder: 0 };
                    if (flota.id === 63530) cache[dia].flota63530 += duracion;
                    else cache[dia].flota143626 += duracion;

                    if (estado === 'waiting_orders') cache[dia].waiting += duracion;
                    else cache[dia].hasOrder += duracion;
                }
            }
        }

        for (const flotaId of [63530, 143626]) {
            const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders', {
                company_ids: [flotaId], start_ts: startTs, end_ts: endTs,
                time_range_filter_type: 'created'
            }, 'orders', 500);
            ordenes.forEach(o => {
                if (o.order_price?.net_earnings) facturacionNueva += o.order_price.net_earnings;
                if (o.status === 'completed') viajesCompletadosNuevos++;
            });
        }
    }

    // Calcular totales desde caché
    let horasWaitingTotal = 0;
    let horasHasOrderTotal = 0;
    const viajesAnteriores = await leerViajesAcumulados();
    const viajesTotales = viajesAnteriores + viajesCompletadosNuevos;
    for (const datos of Object.values(cache)) {
        horasWaitingTotal += (datos.waiting || 0);
        horasHasOrderTotal += (datos.hasOrder || 0);
    }
    const facturacionAnterior = await leerFacturacionAcumulada();
    const facturacionTotal = facturacionAnterior + facturacionNueva;
  

    console.log(`💰 Fact: anterior=${facturacionAnterior.toFixed(2)} + nueva=${facturacionNueva.toFixed(2)} = ${facturacionTotal.toFixed(2)}`);

    // 3. Escribir HORAS_POR_DIA
    const ultimoDiaMostrar = Math.min(diaActual + DIAS_VENTANA_FUTURA, diasDelMes);
    await ensureSheet(SPREADSHEET_ID, 'HORAS_POR_DIA');

    const valuesPorDia = [['DÍA', 'FLOTA 63530', 'FLOTA 143626', 'TOTAL', 'WAITING', 'HAS_ORDER', 'ACUMULADO POR DÍA']];
    let acumulado = 0;

    for (let d = 0; d <= ultimoDiaMostrar; d++) {
        const datos = cache[d] || { flota63530: 0, flota143626: 0, waiting: 0, hasOrder: 0 };
        const esFuturo = d > diaActual;
        const esHoy = d === diaActual;

        if (esFuturo) {
            valuesPorDia.push([d.toString(), '', '', '', '', '', '']);
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
                esHoy ? '' : acumulado.toFixed(1)
            ]);
        }
    }

    await clearSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:Z');
    await writeSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A1', valuesPorDia);
    console.log(`✅ HORAS_POR_DIA: ${ultimoDiaMostrar + 1} días`);

    // 4. Escribir HORAS_15_DIAS
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
        const datos = esMesActual ? (cache[dia] || { flota63530: 0, flota143626: 0 }) : { flota63530: 0, flota143626: 0 };

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
    console.log(`✅ HORAS_15_DIAS: ${values15dias.length - 1} días`);

    // 5. Escribir FLOTAS UNIFICADAS
    await ensureSheet(SPREADSHEET_ID, 'Flotas Unificadas');
    const viajesPorHora = ((horasWaitingTotal + horasHasOrderTotal) / 3600) > 0
        ? (viajesTotales / ((horasWaitingTotal + horasHasOrderTotal) / 3600)).toFixed(2)
        : '0.00';

    const valuesUnificadas = [
        ['Horas Waiting Orders', 'Horas Has Order', 'Viajes Completados', 'Viajes/Hora', 'Facturación (net_earnings)'],
        [
            (horasWaitingTotal / 3600).toFixed(2),
            (horasHasOrderTotal / 3600).toFixed(2),
            viajesTotales,
            viajesPorHora,
            facturacionTotal.toFixed(2)
        ]
    ];

    await clearSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:F');
    await writeSheet(SPREADSHEET_ID, 'Flotas Unificadas!A1', valuesUnificadas);
    console.log(`✅ Flotas Unificadas: W=${(horasWaitingTotal / 3600).toFixed(2)}h | HO=${(horasHasOrderTotal / 3600).toFixed(2)}h | Fact=${facturacionTotal.toFixed(2)}€`);

    return { diasCache: diasCalculados.length, diasNuevos: diasFaltantes.length };
}

// ============================================================
// LEER CACHÉ
// ============================================================
async function leerCacheHorasPorDia() {
    try {
        const data = await readSheet(SPREADSHEET_ID, 'HORAS_POR_DIA!A:G');
        const cache = {};

        for (let i = 1; i < data.length; i++) {
            const dia = parseInt(data[i][0]);
            if (isNaN(dia)) continue;

            const h63530 = parseFloat(data[i][1]) || 0;
            const h143626 = parseFloat(data[i][2]) || 0;
            const waiting = parseFloat(data[i][4]) || 0;
            const hasOrder = parseFloat(data[i][5]) || 0;

            if (h63530 > 0 || h143626 > 0 || waiting > 0 || hasOrder > 0) {
                cache[dia] = {
                    flota63530: h63530 * 3600,
                    flota143626: h143626 * 3600,
                    waiting: waiting * 3600,
                    hasOrder: hasOrder * 3600
                };
            }
        }

        console.log(`📋 Caché: ${Object.keys(cache).length} días con datos`);
        return cache;
    } catch (e) {
        return {};
    }
}

async function leerFacturacionAcumulada() {
  try {
    const data = await readSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:E');
    if (data.length >= 2 && data[1][4]) {  // ← Columna E (índice 4)
      return parseFloat(data[1][4]) || 0;
    }
  } catch (e) { }
  return 0;
}

async function leerViajesAcumulados() {
    try {
        const data = await readSheet(SPREADSHEET_ID, 'Flotas Unificadas!A:E');
        if (data.length >= 2 && data[1][2]) {
            return parseInt(data[1][2]) || 0;
        }
    } catch (e) { }
    return 0;
}


module.exports = { actualizarTodo };