const { CONFIG_BOLT, fetchAllPaginated } = require('./bolt');
const { readSheet, writeSheet, clearSheet } = require('./sheets');
const { SPREADSHEET_ID, normalizarNombre, leerTurnos, leerPostMortem, buscarEnDiccionario } = require('./turnos');

const MAPEO_ESTADOS_BOLT = {
  'active': 'activo',
  'suspended': 'inactivo',
  'deactivated': 'despedido'
};
const STATE_VIAJE = ['has_order', 'waiting_orders'];
const META_SEGUNDOS = CONFIG_BOLT.metaDiariaHoras * 3600;

// ============================================================
// PROCESAR Y UNIFICAR
// ============================================================
async function procesarYUnificar(mes, ano) {
  const turnosDB = await leerTurnos();
  const postMortem = await leerPostMortem();

  const todosConductores = {};

  for (const flota of CONFIG_BOLT.flotas) {
    const datos = await calcularHorasFlota(flota.id, mes, ano, turnosDB, postMortem);

    Object.entries(datos.horas).forEach(([nombre, diasObj]) => {
      if (!todosConductores[nombre]) {
        todosConductores[nombre] = {
          turno: datos.infoConductores[nombre]?.turno || '?',
          estado: datos.infoConductores[nombre]?.estado || 'activo',
          horasNocturnas: 0
        };
        for (let d = 1; d <= datos.diasDelMes; d++) {
          todosConductores[nombre][d] = 0;
        }
      }

      Object.entries(diasObj).forEach(([dia, segundos]) => {
        const diaNum = parseInt(dia);
        if (todosConductores[nombre][diaNum] !== undefined) {
          todosConductores[nombre][diaNum] += segundos;
        }
      });
    });

    if (datos.horasNocturnas) {
      Object.entries(datos.horasNocturnas).forEach(([nombre, segundos]) => {
        if (todosConductores[nombre]) {
          todosConductores[nombre].horasNocturnas += segundos;
        }
      });
    }
  }

  await escribirHojaUnificada(todosConductores, mes, ano);
  console.log(`✅ Mes ${mes}/${ano} procesado`);
  return { status: 'ok', mes, ano, conductores: Object.keys(todosConductores).length };
}

// ============================================================
// CALCULAR HORAS FLOTA
// ============================================================
async function calcularHorasFlota(companyId, mes, ano, turnosDB, postMortem) {
  const ahora = new Date();
  const diasDelMes = new Date(ano, mes, 0).getDate();
  const diaLimite = (mes === ahora.getMonth() + 1 && ano === ahora.getFullYear())
    ? ahora.getDate() : diasDelMes;

  const startTs = Math.floor(new Date(ano, mes - 1, 1, 0, 0, 0).getTime() / 1000);
  let endTs = Math.floor(new Date(ano, mes - 1, diasDelMes, 23, 59, 59).getTime() / 1000);

  if (mes === ahora.getMonth() + 1 && ano === ahora.getFullYear()) {
    endTs = Math.floor(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59).getTime() / 1000);
  }

  try {
    const drivers = await fetchAllPaginated('/fleetIntegration/v1/getDrivers', {
      company_id: companyId, start_ts: startTs, end_ts: endTs
    }, 'drivers', 1000);

    const driverInfo = {};

    drivers.forEach(d => {
      if (!d.driver_uuid) return;
      const nombreReal = (d.first_name + ' ' + d.last_name).trim();
      const estadoBolt = d.state || 'active';
      const infoTurno = buscarEnDiccionario(nombreReal, turnosDB);

      driverInfo[d.driver_uuid] = {
        nombre: nombreReal,
        estado: MAPEO_ESTADOS_BOLT[estadoBolt] || 'activo',
        turno: infoTurno ? infoTurno.turno : '?'
      };
    });

    const dictPostMortem = {};
    postMortem.forEach(({ nombre, turno }) => {
      dictPostMortem[nombre.toLowerCase()] = { turno, estado: 'despedido' };
    });

    Object.entries(driverInfo).forEach(([uuid, info]) => {
      const pmInfo = buscarEnDiccionario(info.nombre, dictPostMortem);
      if (pmInfo) {
        info.estado = 'despedido';
        if (info.turno === '?') info.turno = pmInfo.turno;
      }
    });

    postMortem.forEach(({ nombre, turno }) => {
      const existeEnAPI = Object.values(driverInfo).some(d =>
        d.nombre.toLowerCase() === nombre.toLowerCase()
      );
      if (!existeEnAPI) {
        const uuidFicticio = 'pm_' + nombre.toLowerCase().replace(/[^a-z0-9]/g, '_');
        driverInfo[uuidFicticio] = {
          nombre: nombre,
          estado: 'despedido',
          turno: turno || '?'
        };
      }
    });

    const stateLogs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs', {
      company_id: companyId, start_ts: startTs, end_ts: endTs
    }, 'state_logs', 1000);

    const logsByDriver = {};
    stateLogs.forEach(log => {
      const duuid = log.driver_uuid || 'unknown';
      if (!logsByDriver[duuid]) logsByDriver[duuid] = [];
      logsByDriver[duuid].push(log);
    });

    const horasPorConductor = {};
    const horasNocturnasPorConductor = {};
    const infoConductores = {};

    Object.entries(logsByDriver).forEach(([duuid, logs]) => {
      const info = driverInfo[duuid];
      if (!info) return;

      const nombreReal = info.nombre;
      const turno = info.turno;
      const estado = info.estado;

      infoConductores[nombreReal] = { turno, estado };

      if (!horasPorConductor[nombreReal]) {
        horasPorConductor[nombreReal] = {};
        for (let d = 1; d <= diasDelMes; d++) {
          horasPorConductor[nombreReal][d] = 0;
        }
      }

      if (!horasNocturnasPorConductor[nombreReal]) {
        horasNocturnasPorConductor[nombreReal] = 0;
      }

      logs.sort((a, b) => a.created - b.created);

      for (let i = 0; i < logs.length; i++) {
        const logActual = logs[i];
        if (!STATE_VIAJE.includes(logActual.state)) continue;

        let siguienteLog = logs[i + 1];
        if (!siguienteLog) continue;

        const inicioIntervalo = logActual.created;
        const finIntervalo = siguienteLog.created;
        const duracion = finIntervalo - inicioIntervalo;
        if (duracion <= 0) continue;

        if (turno === 'noche') {
          distribuirHorasTurnoNoche(horasPorConductor[nombreReal], inicioIntervalo, finIntervalo);
        } else {
          distribuirHorasTurnoDia(horasPorConductor[nombreReal], inicioIntervalo, finIntervalo);
        }

        if (estado !== 'despedido') {
          const segNocturnos = calcularSegundosNocturnosEnIntervalo(inicioIntervalo, finIntervalo);
          horasNocturnasPorConductor[nombreReal] += segNocturnos;
        }
      }
    });

    Object.entries(driverInfo).forEach(([duuid, info]) => {
      if (!horasPorConductor[info.nombre]) {
        infoConductores[info.nombre] = { turno: info.turno, estado: info.estado };
        horasPorConductor[info.nombre] = {};
        for (let d = 1; d <= diasDelMes; d++) {
          horasPorConductor[info.nombre][d] = 0;
        }
        horasNocturnasPorConductor[info.nombre] = 0;
      }
    });

    return {
      horas: horasPorConductor,
      horasNocturnas: horasNocturnasPorConductor,
      diasDelMes,
      diaLimite,
      infoConductores
    };

  } catch (error) {
    console.error('Error en flota ' + companyId + ':', error.message);
    return { horas: {}, horasNocturnas: {}, diasDelMes, diaLimite, infoConductores: {} };
  }
}

// ============================================================
// CÁLCULOS DE HORAS
// ============================================================
function calcularSegundosNocturnosEnIntervalo(inicio, fin) {
  let totalNocturno = 0;
  let cts = inicio;

  while (cts < fin) {
    const fecha = new Date(cts * 1000);
    const hora = fecha.getHours();
    const dia = fecha.getDate();
    const mes = fecha.getMonth();
    const ano = fecha.getFullYear();

    let finBloque;
    if (hora >= 22) {
      finBloque = new Date(ano, mes, dia + 1, 6, 0, 0).getTime() / 1000;
    } else if (hora < 6) {
      finBloque = new Date(ano, mes, dia, 6, 0, 0).getTime() / 1000;
    } else {
      finBloque = new Date(ano, mes, dia, 22, 0, 0).getTime() / 1000;
    }

    const endSegment = Math.min(finBloque, fin);
    if (hora >= 22 || hora < 6) {
      const seg = endSegment - cts;
      if (seg > 0) totalNocturno += seg;
    }
    cts = endSegment;
  }

  return totalNocturno;
}

function distribuirHorasTurnoDia(horasConductor, inicio, fin) {
  let cts = inicio;
  while (cts < fin) {
    const fecha = new Date(cts * 1000);
    const dia = fecha.getDate();
    const midnight = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 1).getTime() / 1000;
    const endSegment = Math.min(midnight, fin);
    const seg = endSegment - cts;
    if (horasConductor[dia] !== undefined && seg > 0) {
      horasConductor[dia] += seg;
    }
    cts = endSegment;
  }
}

function distribuirHorasTurnoNoche(horasConductor, inicio, fin) {
  let cts = inicio;
  while (cts < fin) {
    const fecha = new Date(cts * 1000);
    const dia = fecha.getDate();
    const mes = fecha.getMonth();
    const ano = fecha.getFullYear();
    const mediodiaHoy = new Date(ano, mes, dia, 12, 0, 0).getTime() / 1000;
    const mediodiaManana = new Date(ano, mes, dia + 1, 12, 0, 0).getTime() / 1000;

    let diaAsignar, endSegment;
    if (cts >= mediodiaHoy && cts < mediodiaManana) {
      diaAsignar = dia;
      endSegment = Math.min(mediodiaManana, fin);
    } else if (cts < mediodiaHoy) {
      diaAsignar = dia - 1;
      endSegment = Math.min(mediodiaHoy, fin);
    } else {
      diaAsignar = dia + 1;
      const mediodiaPasado = new Date(ano, mes, dia + 2, 12, 0, 0).getTime() / 1000;
      endSegment = Math.min(mediodiaPasado, fin);
    }

    const seg = endSegment - cts;
    if (horasConductor[diaAsignar] !== undefined && seg > 0) {
      horasConductor[diaAsignar] += seg;
    }
    cts = endSegment;
  }
}

// ============================================================
// ESCRIBIR HOJA UNIFICADA
// ============================================================
async function escribirHojaUnificada(todosConductores, mes, ano) {
  const ahora = new Date();
  const diasDelMes = new Date(ano, mes, 0).getDate();
  const diaLimite = (mes === ahora.getMonth() + 1 && ano === ahora.getFullYear())
    ? ahora.getDate() : diasDelMes;

  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const nombreMes = mesesNombres[mes - 1];

  const values = [];
  values.push([`🚗 BOLT FLEET - ${nombreMes} ${ano} | Meta: ${CONFIG_BOLT.metaDiariaHoras}h/día | Procesado desde Render`]);

  const headers = ['Estado', 'Conductor', 'Turno'];
  for (let d = 1; d <= diasDelMes; d++) headers.push(d.toString());
  headers.push('TOTAL', '🌙 Noc', 'Días', 'Meta', 'Debe');
  values.push(headers);

  const activos = [], inactivos = [], despedidos = [];
  Object.entries(todosConductores).forEach(([nombre, data]) => {
    if (data.estado === 'despedido') despedidos.push([nombre, data]);
    else if (data.estado === 'inactivo') inactivos.push([nombre, data]);
    else activos.push([nombre, data]);
  });
  activos.sort((a, b) => a[0].localeCompare(b[0]));
  inactivos.sort((a, b) => a[0].localeCompare(b[0]));
  despedidos.sort((a, b) => a[0].localeCompare(b[0]));
  const todosOrdenados = [...activos, ...inactivos, ...despedidos];

  let granTotalSeg = 0, granTotalNocturno = 0, granDiasTrab = 0;
  const totalesPorDia = new Array(diasDelMes + 1).fill(0);

  todosOrdenados.forEach(([nombre, data]) => {
    const turno = data.turno || '?';
    const estado = data.estado || 'activo';

    let estadoEmoji, estadoTexto;
    switch (estado) {
      case 'activo': estadoEmoji = '✅'; estadoTexto = 'Activo'; break;
      case 'inactivo': estadoEmoji = '💤'; estadoTexto = 'Suspendido'; break;
      case 'despedido': estadoEmoji = '⚰️'; estadoTexto = 'Despedido'; break;
      default: estadoEmoji = '❓'; estadoTexto = estado;
    }

    const emojiTurno = turno === 'noche' ? '🌙' : turno === 'dia' ? '☀️' : '❓';
    const textoTurno = turno === 'noche' ? 'Noche' : turno === 'dia' ? 'Día' : '?';

    const row = [estadoEmoji + ' ' + estadoTexto, nombre, emojiTurno + ' ' + textoTurno];
    let totalSeg = 0, diasTrabajados = 0;

    for (let d = 1; d <= diasDelMes; d++) {
      const segundosDia = data[d] || 0;
      if (d <= diaLimite) {
        totalSeg += segundosDia;
        totalesPorDia[d] += segundosDia;
        if (segundosDia > 3600) diasTrabajados++;
        row.push((segundosDia / 3600).toFixed(1));
      } else {
        row.push('');
      }
    }

    const horasNocturnas = data.horasNocturnas || 0;
    const metaMesSeg = diasTrabajados * META_SEGUNDOS;
    const diferenciaSeg = totalSeg - metaMesSeg;

    row.push((totalSeg / 3600).toFixed(1));
    row.push(estado === 'despedido' ? 'N/A' : (horasNocturnas / 3600).toFixed(1));
    row.push(diasTrabajados.toString());
    row.push((metaMesSeg / 3600).toFixed(1));
    row.push(diferenciaSeg === 0 ? '✓' : (diferenciaSeg / 3600).toFixed(1));

    values.push(row);

    granTotalSeg += totalSeg;
    if (estado !== 'despedido') granTotalNocturno += horasNocturnas;
    granDiasTrab += diasTrabajados;
  });

  const metaTotal = granDiasTrab * META_SEGUNDOS;
  const debeTotal = Math.max(0, metaTotal - granTotalSeg);

  const totalRow = ['📊 TOTAL', '', ''];
  for (let d = 1; d <= diasDelMes; d++) {
    totalRow.push(d <= diaLimite ? (totalesPorDia[d] / 3600).toFixed(1) : '');
  }
  totalRow.push((granTotalSeg / 3600).toFixed(1));
  totalRow.push((granTotalNocturno / 3600).toFixed(1));
  totalRow.push(granDiasTrab.toString());
  totalRow.push((metaTotal / 3600).toFixed(1));
  totalRow.push(debeTotal > 0 ? '-' + (debeTotal / 3600).toFixed(1) : '✓');
  values.push(totalRow);

  await clearSheet(SPREADSHEET_ID, 'TODAS_LAS_FLOTAS!A:Z');
  await writeSheet(SPREADSHEET_ID, 'TODAS_LAS_FLOTAS!A1', values);

  console.log(`✅ Hoja TODAS_LAS_FLOTAS actualizada: ${values.length} filas`);
}

module.exports = { procesarYUnificar };