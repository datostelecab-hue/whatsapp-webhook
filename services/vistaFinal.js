// ============================================================
// VISTA_FINAL: reconstrucción en Node (sustituye al Apps Script)
// ============================================================
// Hoja histórica de horas por conductor y día (1 jun 2026 → 31 may 2027).
// Filas = conductores de AGENDA_V2, identificados SIEMPRE por su ID_BOLT
// (nombre de la plataforma Bolt). Cada celda de un día:
//   · 'L'      si ese día es libranza de la SEMANA EN CURSO (patrón de AGENDA_V2)
//   · horas    si Datos_API tiene horas ese día (cruce por nombre de Bolt)
//   · 0        si ya pasó/es hoy y no hubo horas
//   · (vacío)  si es un día futuro del mes en curso
//
// CONGELADO:
//   · Meses anteriores al actual (junio y antes) → se CONSERVAN tal cual están
//     en la hoja. No se recalculan ni se tocan.
//   · Mes en curso → se REESCRIBE cada corrida (Datos_API tiene sus horas).
//   · Meses futuros → en blanco (se conservan como estén).
// Datos_API solo trae el mes en curso, por eso los meses pasados salen de la
// propia hoja congelada.
//
// La hoja está protegida y solo la edita el dueño a mano; la cuenta de servicio
// tiene permiso de escritura. No se borra la hoja: se sobrescribe el rectángulo
// completo (incluidas filas sobrantes viejas → en blanco) en una sola escritura,
// así nunca queda un hueco si algo falla a mitad.

const { leerTablero, leerOut, cambiarEstados } = require('./planificadorV2');
const { normClave } = require('./conductores');
const { leerHorasDatosApi } = require('./control');
const { readSheet, writeSheet, writeMany, getSheetIds, batchUpdate } = require('./sheets');

const ID_GESTION = '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const HOJA = 'VISTA_FINAL';
const TZ = 'Europe/Madrid';

// Rango del histórico (mismo que el Apps Script). Mes 0-based: 5 = junio.
const INICIO = { y: 2026, m: 5, d: 1 };   // 1 jun 2026
const FIN = { y: 2027, m: 4, d: 31 };     // 31 may 2027

const ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];  // por getUTCDay

const EST = {
  'Activo': '✅ Activo',
  'Pendiente Asignar': '🏷️ Pendiente Asignar',
  'Vacaciones': '🏖️ Vacaciones',
  'Baja Médica': '🩹 Baja Médica',
  'Permiso Retribuido': '🎫 Permiso Retribuido',
  'Baja Empresa': '⚰️ Baja Empresa',
  'Suspendido': '⛔ Suspendido'
};
const TUR = { 'Día': '☀️ Día', 'Noche': '🌙 Noche', 'TodoTurno': '🔄 TodoTurno' };
const EST_SIN_MAPEAR = '🚫 Sin mapear';

// Paleta para repintar las columnas ESTADO y TURNO cada corrida (si no, la
// celda hereda el fondo del valor anterior: un Activo en negro de despedido).
const BLANCO = { bg: '#ffffff', fg: '#000000' };
const COLOR_ESTADO = [
  { has: 'Sin mapear',  bg: '#d1d5db', fg: '#374151' },
  { has: 'Out',         bg: '#111827', fg: '#ffffff' },
  { has: 'Activo',      bg: '#1e7e34', fg: '#ffffff' },
  { has: 'Pendiente',   bg: '#e8b84b', fg: '#1a1a1a' },
  { has: 'Vacaciones',  bg: '#3b82f6', fg: '#ffffff' },
  { has: 'Médica',      bg: '#f59e0b', fg: '#1a1a1a' },
  { has: 'Permiso',     bg: '#a855f7', fg: '#ffffff' },
  { has: 'Empresa',     bg: '#dc2626', fg: '#ffffff' },
  { has: 'Suspendido',  bg: '#6b7280', fg: '#ffffff' }
];
const COLOR_TURNO = [
  { has: 'TodoTurno',   bg: '#7c5cbf', fg: '#ffffff' },
  { has: 'Noche',       bg: '#1f2a44', fg: '#ffffff' },
  { has: 'Día',         bg: '#ffe08a', fg: '#1a1a1a' }
];
// Azul de la 'J' (justificante). DISTINTO del azul de "Vacaciones" (#3b82f6) para que
// no se confundan; además la letra J ya la diferencia de la V.
const AZUL_JUST = '#1d4ed8';

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
function colorDe(valor, tabla) {
  const s = (valor || '').toString();
  return tabla.find(c => s.includes(c.has)) || BLANCO;
}
/** CellData con solo fondo + color de texto (no toca el valor ya escrito). */
function celdaColor(c) {
  return {
    userEnteredFormat: { backgroundColor: rgb(c.bg), textFormat: { foregroundColor: rgb(c.fg) } }
  };
}
/** Request updateCells que repinta una columna entera de datos. */
function reqColumna(sheetId, colIndex, startRow, colores) {
  if (!colores.length) return null;
  return {
    updateCells: {
      range: {
        sheetId, startRowIndex: startRow, endRowIndex: startRow + colores.length,
        startColumnIndex: colIndex, endColumnIndex: colIndex + 1
      },
      rows: colores.map(c => ({ values: [celdaColor(c)] })),
      fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor'
    }
  };
}

/** Request para ocultar/mostrar un tramo de filas (null si está vacío). */
function reqVisibilidad(sheetId, startIndex, endIndex, hidden) {
  if (endIndex <= startIndex) return null;
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex, endIndex },
      properties: { hiddenByUser: hidden },
      fields: 'hiddenByUser'
    }
  };
}

// Borde para marcar "hizo horas en día de libranza": grueso y rosa. El borde es
// lo único que el formato condicional de la hoja NO puede tapar.
const BORDE_LIBRANZA = { style: 'SOLID_THICK', color: rgb('#ff2d95') };

function hoyMadrid() {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [Y, M, D] = s.split('-').map(Number);
  return new Date(Date.UTC(Y, M - 1, D, 12));
}
function isoFecha(d) {
  const M = String(d.getUTCMonth() + 1).padStart(2, '0');
  const D = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${M}-${D}`;
}
const clave = n => normClave(n || '');
// Índice de columna 0-based → letra(s) de Sheets (para escribir celdas sueltas).
function colLetra0(n) {
  let s = '';
  for (n = Number(n); n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/**
 * Reconstruye VISTA_FINAL. Devuelve un resumen de lo escrito.
 */
async function reconstruirVistaFinal() {
  const hoy = hoyMadrid();
  const hoyY = hoy.getUTCFullYear();
  const hoyM = hoy.getUTCMonth() + 1;

  // Semana en curso (lun→dom) en la que caen las libranzas de AGENDA_V2.
  const offLun = (hoy.getUTCDay() + 6) % 7;      // Lun=0 … Dom=6
  const lunes = new Date(hoy);   lunes.setUTCDate(hoy.getUTCDate() - offLun);
  const domingo = new Date(lunes); domingo.setUTCDate(lunes.getUTCDate() + 6);

  // Lista de fechas del rango completo (una por columna de día).
  const fechas = [];
  const fin = new Date(Date.UTC(FIN.y, FIN.m, FIN.d, 12));
  for (let c = new Date(Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12)); c <= fin;
       c.setUTCDate(c.getUTCDate() + 1)) {
    fechas.push(new Date(c));
  }
  const nDias = fechas.length;
  const nCols = 3 + nDias;

  // 1) VISTA_FINAL actual → conservar meses pasados y el histórico de quien ya
  //    no está en la agenda. Se indexa por nombre de Bolt (col B), saltando las
  //    filas de cabecera sueltas (col B vacía).
  const filasViejas = await readSheet(ID_GESTION, `${HOJA}!A:ZZ`,
    { valueRenderOption: 'UNFORMATTED_VALUE' });
  const viejoPorClave = new Map();   // clave -> { fila, estado, turno, nombre }
  filasViejas.forEach(row => {
    const nombre = (row[1] || '').toString().trim();
    if (!nombre) return;
    // Filas de cabecera sueltas (el desorden que había): 'CONDUCTOR' en col B o
    // 'ESTADO' en col A. No son conductores; se ignoran para no duplicarlas.
    const nomUp = nombre.toUpperCase();
    if (nomUp === 'CONDUCTOR' || nomUp === 'CONDUCTORES') return;
    if ((row[0] || '').toString().trim().toUpperCase() === 'ESTADO') return;
    const k = clave(nombre);
    if (!k || viejoPorClave.has(k)) return;
    viejoPorClave.set(k, {
      fila: row, estado: row[0] || '', turno: row[2] || '', nombre
    });
  });

  // 2) Roster de AGENDA_V2 (turno, estado, patrón de libranza).
  const tablero = await leerTablero();
  const roster = ((tablero && tablero.conductores) || [])
    .filter(c => (c.idBolt || c.nombre));

  // 3) Horas del mes en curso.
  const datos = await leerHorasDatosApi();
  const horasVigentes = datos.mes === hoyM && datos.ano === hoyY;

  // 3b) Registro de bajas (CONDUCTORES_OUT) para clasificar a quien ya no está
  //     en la agenda: si está en el registro es "out"; si no, "Sin mapear".
  let outPorClave = new Map();
  try {
    const out = await leerOut();
    (out.fichas || []).forEach(f => {
      const k = clave(f.id || f.nombre);
      if (k && !outPorClave.has(k)) outPorClave.set(k, f);
    });
  } catch (e) {
    console.warn(`⚠️ [VISTA_FINAL] No se pudo leer CONDUCTORES_OUT: ${e.message}`);
  }

  // Valor de una celda (día `idx`, fecha `f`) para un conductor de la agenda.
  // Devuelve { valor, especial } — especial = hizo horas un día que libraba.
  function celdaAgenda(c, f, idx, viejo) {
    const esMesActual = f.getUTCFullYear() === hoyY && (f.getUTCMonth() + 1) === hoyM;
    // Se conserva lo que ya hubiera cuando NO es el mes en curso (junio y antes,
    // o meses futuros) o cuando Datos_API no trae el mes en curso (desfasado /
    // cambio de mes): así nada reescribe el mes con ceros por accidente.
    if (!esMesActual || !horasVigentes) {
      return { valor: viejo ? (viejo.fila[3 + idx] ?? '') : '' };
    }
    // Preservar marcas manuales V (vacaciones) / B (baja médica) / P (permiso
    // retribuido) / J (justificante de tráfico) aunque sea el mes en curso: se ponen
    // a mano y alimentan las alertas / el auto-estado / los reportes. Nunca se pisan
    // con las horas del cron.
    const marca = viejo ? String(viejo.fila[3 + idx] ?? '').trim().toUpperCase() : '';
    if (marca === 'V' || marca === 'B' || marca === 'P') return { valor: viejo.fila[3 + idx] };
    if (marca === 'J') return { valor: viejo.fila[3 + idx], justif: true };   // justificante: se re-colorea azul abajo
    // Mes en curso con horas vigentes:
    const wd = (f.getUTCDay() + 6) % 7;
    const esLibranza = !!(c.libra && c.libra[wd]);
    const porDia = datos.horas.get(clave(c.idBolt || c.nombre));
    const h = porDia ? porDia[f.getUTCDate()] : null;
    const trabajo = h != null && h > 0;
    const enSemanaViva = f >= lunes && f <= domingo;

    // Trabajó un día que libraba → salen las HORAS, marcadas (borde especial).
    if (esLibranza && trabajo) return { valor: h, especial: true };
    // Libró de verdad: 'L' solo en la semana viva; en el resto del mes → 0.
    if (esLibranza) return { valor: enSemanaViva ? 'L' : (f <= hoy ? 0 : '') };
    if (trabajo) return { valor: h };
    if (f <= hoy) return { valor: 0 };            // pasado/hoy sin horas → 0
    return { valor: '' };                          // futuro del mes → en blanco
  }

  // 4) Cabeceras.
  const filaNum = ['ESTADO', 'CONDUCTOR', 'TURNO', ...fechas.map(f => f.getUTCDate())];
  const filaSem = ['', '', '', ...fechas.map(f => ABBR[f.getUTCDay()])];
  const filaFec = ['', '', '', ...fechas.map(isoFecha)];
  const salida = [filaNum, filaSem, filaFec];

  // Conserva los días del histórico de una fila vieja (junio y anteriores, o lo
  // que ya hubiera). No recalcula nada: es histórico congelado.
  const diasViejos = v => {
    const dias = [];
    for (let idx = 0; idx < nDias; idx++) dias.push((v && v.fila[3 + idx]) ?? '');
    return dias;
  };

  // 5) Conductores de la AGENDA (arriba). El estado SIEMPRE sale de la agenda.
  const filasAgenda = [];
  const escritas = new Set();
  const marcas = [];    // celdas (fila/col 0-based) con horas en día de libranza
  const justCells = [];  // celdas con 'J' (justificante) → se pintan de azul
  roster.forEach((c, i) => {
    const filaIdx = 3 + i;   // fila 0-based en el grid (tras las 3 cabeceras)
    const k = clave(c.idBolt || c.nombre);
    escritas.add(k);
    const viejo = viejoPorClave.get(k);
    const nombre = (c.idBolt || '').trim() || c.nombre || '(sin ID_BOLT)';
    const fila = [
      EST[c.estadoCalculado] || c.estadoCalculado || '',
      nombre,
      TUR[c.turno] || c.turno || ''
    ];
    fechas.forEach((f, idx) => {
      const r = celdaAgenda(c, f, idx, viejo);
      fila.push(r.valor);
      if (r.especial) marcas.push({ row: filaIdx, col: 3 + idx });
      if (r.justif) justCells.push({ row: filaIdx, col: 3 + idx });
    });
    filasAgenda.push(fila);
  });

  // 6) Quien ya no está en la agenda se clasifica por el registro:
  //    · en CONDUCTORES_OUT → "out": se queda ABAJO, visible, con su fecha de baja.
  //    · en ninguno         → "Sin mapear": va al final y se OCULTA.
  //    En ambos casos el histórico de días se conserva intacto.
  const filasOut = [];
  const filasSinMapear = [];
  viejoPorClave.forEach((v, k) => {
    if (escritas.has(k)) return;
    const ficha = outPorClave.get(k);
    if (ficha) {
      const estado = `📦 Out${ficha.fechaBaja ? ' ' + ficha.fechaBaja : ''}`;
      const nombre = (ficha.id || '').trim() || v.nombre;
      filasOut.push([estado, nombre, TUR[ficha.turno] || ficha.turno || v.turno, ...diasViejos(v)]);
    } else {
      filasSinMapear.push([EST_SIN_MAPEAR, v.nombre, v.turno, ...diasViejos(v)]);
    }
  });

  // Orden final: cabeceras → agenda → out (abajo, visibles) → sin mapear (ocultos).
  salida.push(...filasAgenda, ...filasOut, ...filasSinMapear);

  // Fila (0-based) donde empiezan las que hay que ocultar (sin mapear + relleno).
  const inicioOcultas = salida.length - filasSinMapear.length;

  // 7) Rellenar con filas en blanco hasta cubrir todas las filas viejas, para
  //    que la escritura sobrescriba cualquier fila sobrante (sin borrar la hoja).
  while (salida.length < filasViejas.length) salida.push(new Array(nCols).fill(''));

  // Normalizar el ancho de cada fila (evita filas cortas que dejen basura).
  const anchoMax = Math.max(nCols, ...filasViejas.map(r => r.length));
  const grid = salida.map(r => {
    const fila = r.slice(0, anchoMax);
    while (fila.length < anchoMax) fila.push('');
    return fila;
  });

  // 8) Una sola escritura (USER_ENTERED: '5.5' vuelve a número, ISO vuelve a
  //    fecha, 'L'/'0' quedan como están). No se limpia la hoja antes.
  await writeSheet(ID_GESTION, `${HOJA}!A1`, grid);

  // 9) Formato en una sola tanda (todo determinista en cada corrida):
  //    · Ocultar "Sin mapear" (+ relleno) y asegurar visible el resto.
  //    · Repintar ESTADO (col A) y TURNO (col C) según el valor.
  //    · Marcar con borde rosa las horas hechas en día de libranza (y limpiar
  //      antes el bloque del mes en curso para no dejar marcas viejas).
  //    Si falla (p. ej. protección), no se rompe la reconstrucción.
  let ocultadas = 0;
  const marcadas = marcas.length;
  try {
    const sheetId = (await getSheetIds(ID_GESTION))[HOJA];
    if (sheetId !== undefined) {
      // Rango de columnas del mes en curso (para limpiar/marcar las libranzas).
      let mesMin = -1, mesMax = -1;
      fechas.forEach((f, idx) => {
        if (f.getUTCFullYear() === hoyY && (f.getUTCMonth() + 1) === hoyM) {
          if (mesMin < 0) mesMin = idx;
          mesMax = idx;
        }
      });

      // Colores de ESTADO y TURNO fila a fila (datos, sin cabeceras).
      const estCols = [], turCols = [];
      for (let r = 3; r < grid.length; r++) {
        estCols.push(colorDe(grid[r][0], COLOR_ESTADO));
        turCols.push(colorDe(grid[r][2], COLOR_TURNO));
      }

      const reqs = [
        reqVisibilidad(sheetId, 0, inicioOcultas, false),
        reqVisibilidad(sheetId, inicioOcultas, grid.length, true),
        reqColumna(sheetId, 0, 3, estCols),
        reqColumna(sheetId, 2, 3, turCols)
      ];

      // Limpieza del bloque del mes en curso (TODAS las filas de datos): quita
      // bordes y negrita para que no queden marcas de libranza de corridas
      // anteriores, aunque una fila haya cambiado de dueño. No toca el fondo (lo
      // gobierna tu formato condicional). Los meses pasados no se tocan: sus
      // marcas quedan congeladas como el resto del histórico.
      if (grid.length > 3 && mesMin >= 0) {
        reqs.push({
          repeatCell: {
            range: {
              sheetId, startRowIndex: 3, endRowIndex: grid.length,
              startColumnIndex: 3 + mesMin, endColumnIndex: 3 + mesMax + 1
            },
            cell: { userEnteredFormat: { textFormat: { bold: false } } },
            fields: 'userEnteredFormat.borders,userEnteredFormat.textFormat.bold'
          }
        });
      }

      // Marca cada celda de "horas en día de libranza".
      marcas.forEach(m => reqs.push({
        repeatCell: {
          range: {
            sheetId, startRowIndex: m.row, endRowIndex: m.row + 1,
            startColumnIndex: m.col, endColumnIndex: m.col + 1
          },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              borders: {
                top: BORDE_LIBRANZA, bottom: BORDE_LIBRANZA,
                left: BORDE_LIBRANZA, right: BORDE_LIBRANZA
              }
            }
          },
          fields: 'userEnteredFormat.borders,userEnteredFormat.textFormat.bold'
        }
      }));

      // Pinta de AZUL cada celda con 'J' (justificante), sobre la fila correcta de ESTA
      // corrida (así el color sigue al conductor aunque se reordenen las filas).
      justCells.forEach(m => reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: m.row, endRowIndex: m.row + 1, startColumnIndex: m.col, endColumnIndex: m.col + 1 },
          cell: celdaColor({ bg: AZUL_JUST, fg: '#ffffff' }),
          fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor'
        }
      }));

      await batchUpdate(ID_GESTION, reqs);
      ocultadas = grid.length - inicioOcultas;
    }
  } catch (e) {
    console.warn(`⚠️ [VISTA_FINAL] No se pudo aplicar formato/ocultado: ${e.message}`);
  }

  return {
    conductoresAgenda: roster.length,
    out: filasOut.length,
    sinMapear: filasSinMapear.length,
    marcadasLibranza: marcadas,
    ocultadas,
    filasEscritas: grid.length,
    dias: nDias,
    mesHoras: datos.mes ? `${datos.mes}/${datos.ano}` : null,
    horasVigentes,
    semana: `${isoFecha(lunes)} → ${isoFecha(domingo)}`
  };
}

/**
 * Alertas de VISTA_FINAL: conductores marcados a mano con 'V' (vacaciones) o 'B'
 * (baja) en los próximos `horizonte` días → "toca reemplazarlo". Solo lectura.
 * Las columnas de día van desde col D (índice 3) = INICIO, correlativas por día.
 */
async function alertasVistaFinal(horizonte = 4) {
  const hoy = hoyMadrid();
  const inicioMs = Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12);
  const objetivos = [];
  for (let n = 1; n <= horizonte; n++) {
    const f = new Date(hoy); f.setUTCDate(hoy.getUTCDate() + n);
    const col = 3 + Math.round((f.getTime() - inicioMs) / 86400000);
    if (col >= 3) objetivos.push({ n, fecha: f, col });
  }

  const filas = await readSheet(ID_GESTION, `${HOJA}!A:ZZ`,
    { valueRenderOption: 'UNFORMATTED_VALUE' });

  const TIPO = { V: 'Vacaciones', B: 'Baja médica', P: 'Permiso retribuido' };
  // Si el conductor YA está fuera (col A = estado), no se alerta: ya está gestionado.
  const YA_FUERA = ['Vacaciones', 'Baja', 'Permiso', 'Suspendido', 'Out', 'mapear'];
  const alertas = [];
  for (let i = 3; i < filas.length; i++) {            // datos desde la fila 4 (3 cabeceras)
    const nombre = (filas[i][1] || '').toString().trim();
    if (!nombre || nombre.toUpperCase() === 'CONDUCTOR') continue;
    const estadoCol = (filas[i][0] || '').toString();
    if (YA_FUERA.some(s => estadoCol.includes(s))) continue;
    // UNA sola alerta por conductor: la primera V/B/P más próxima (no una por día).
    let hit = null;
    for (const o of objetivos) {
      const v = String(filas[i][o.col] ?? '').trim().toUpperCase();
      if (v === 'V' || v === 'B' || v === 'P') { hit = { o, v }; break; }
    }
    if (hit) {
      alertas.push({
        conductor: nombre, tipo: hit.v, motivo: TIPO[hit.v],
        dias: hit.o.n, fecha: isoFecha(hit.o.fecha)
      });
    }
  }
  return alertas.sort((a, b) => a.dias - b.dias);
}

// Letra de la bitácora (VISTA_FINAL) → estado del conductor en la agenda.
const LETRA_ESTADO = { V: 'Vacaciones', B: 'Baja Médica', P: 'Permiso Retribuido' };

/**
 * Cuando un conductor tiene 'V'/'B'/'P' en la celda de HOY en VISTA_FINAL y aún no
 * tiene ese estado en la agenda, se le pone automáticamente: V→Vacaciones,
 * B→Baja Médica, P→Permiso Retribuido. (En vacaciones se libera su plaza; en baja
 * médica / permiso conserva la matrícula pero esos días el coche no sale.)
 * La reincorporación NO es automática: se hace a mano cuando el conductor vuelve.
 */
async function aplicarAusenciasAutomaticas() {
  const hoy = hoyMadrid();
  const inicioMs = Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12);
  const colHoy = 3 + Math.round((hoy.getTime() - inicioMs) / 86400000);
  if (colHoy < 3) return { aplicados: 0, conductores: [] };

  const [filas, tablero] = await Promise.all([
    readSheet(ID_GESTION, `${HOJA}!A:ZZ`, { valueRenderOption: 'UNFORMATTED_VALUE' }),
    leerTablero()
  ]);
  const porId = new Map();
  ((tablero && tablero.conductores) || []).forEach(c => {
    const id = (c.idBolt || '').toString().trim();
    if (id) porId.set(clave(id), c);
  });

  const cambios = [];
  for (let i = 3; i < filas.length; i++) {
    const idBolt = (filas[i][1] || '').toString().trim();
    if (!idBolt || idBolt.toUpperCase() === 'CONDUCTOR') continue;
    const estado = LETRA_ESTADO[String(filas[i][colHoy] ?? '').trim().toUpperCase()];
    if (!estado) continue;                          // hoy no tiene V/B/P
    const c = porId.get(clave(idBolt));
    if (!c || c.estado === estado) continue;        // no está en la agenda, o ya marcado
    cambios.push({ id: idBolt, estado });
  }

  if (!cambios.length) return { aplicados: 0, conductores: [] };
  await cambiarEstados(cambios);
  return { aplicados: cambios.length, conductores: cambios.map(c => `${c.id} → ${c.estado}`) };
}

/**
 * Reincorporación AUTOMÁTICA desde la bitácora. Para cada conductor con ausencia
 * (V/B/P) en la celda de HOY, avanza hasta la ÚLTIMA V/B/P consecutiva y devuelve el
 * día siguiente (primer día ya operativo) como fecha de reincorporación. Así el
 * planificador ya no depende de la columna REINCORPORACION a mano: RRHH mete el
 * desde/hasta (peticiones), las letras caen en VISTA_FINAL y aquí se lee hasta la
 * última V. Solo lectura.
 * @returns Map(clave(nombreBolt) -> Date UTC del primer día sin ausencia)
 */
async function leerFinAusencias() {
  const hoy = hoyMadrid();
  const inicioMs = Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12);
  const colHoy = 3 + Math.round((hoy.getTime() - inicioMs) / 86400000);
  const out = new Map();
  if (colHoy < 3) return out;

  const filas = await readSheet(ID_GESTION, `${HOJA}!A:ZZ`, { valueRenderOption: 'UNFORMATTED_VALUE' });
  const esAusencia = v => { const s = String(v ?? '').trim().toUpperCase(); return s === 'V' || s === 'B' || s === 'P'; };

  for (let i = 3; i < filas.length; i++) {                 // datos desde la fila 4 (3 cabeceras)
    const nombre = (filas[i][1] || '').toString().trim();
    if (!nombre || nombre.toUpperCase() === 'CONDUCTOR') continue;
    if (!esAusencia(filas[i][colHoy])) continue;           // hoy no está ausente en la bitácora
    let col = colHoy;
    while (esAusencia(filas[i][col])) col++;                // avanza hasta la primera celda sin ausencia
    out.set(clave(nombre), new Date(inicioMs + (col - 3) * 86400000));
  }
  return out;
}

// Estado de ausencia → letra de la bitácora (inverso de LETRA_ESTADO).
const ESTADO_LETRA = Object.fromEntries(Object.entries(LETRA_ESTADO).map(([l, e]) => [e, l]));

const AUSENCIA_LETRAS = ['V', 'B', 'P'];

/**
 * REINCORPORACIÓN AUTOMÁTICA (la inversa de aplicarAusenciasAutomaticas): para cada
 * conductor cuyo estado es Vacaciones / Baja Médica / Permiso Retribuido pero cuya
 * celda de HOY en la bitácora YA NO tiene letra (sus V/B/P terminaron), se le
 * reincorpora solo:
 *   · Activo             si su semana queda cubierta (lo decide el propio motor), o
 *   · Pendiente Asignar  si está sin planificar o le faltan días.
 * Además limpia su fecha de REINCORPORACION manual (ya cumplida; si se quedara,
 * taparía a la automática en su PRÓXIMA ausencia). Quien no tiene fila en la
 * bitácora no se toca (se gestiona a mano). "Suspendido" también queda manual.
 */
async function aplicarReincorporaciones() {
  const hoy = hoyMadrid();
  const inicioMs = Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12);
  const colHoy = 3 + Math.round((hoy.getTime() - inicioMs) / 86400000);
  if (colHoy < 3) return { reincorporados: 0, conductores: [] };

  const [filas, tablero] = await Promise.all([
    readSheet(ID_GESTION, `${HOJA}!A:ZZ`, { valueRenderOption: 'UNFORMATTED_VALUE' }),
    leerTablero()
  ]);

  // Letra de HOY por conductor de la bitácora.
  const letraHoy = new Map();
  for (let i = 3; i < filas.length; i++) {
    const nombre = (filas[i][1] || '').toString().trim();
    if (!nombre || nombre.toUpperCase() === 'CONDUCTOR') continue;
    const k = clave(nombre);
    if (k && !letraHoy.has(k)) letraHoy.set(k, String(filas[i][colHoy] ?? '').trim().toUpperCase());
  }

  // Ausentes (V/B/P) cuya bitácora ya no marca ausencia hoy → han vuelto.
  const vueltos = ((tablero && tablero.conductores) || []).filter(c => {
    if (!ESTADO_LETRA[c.estado]) return false;              // su estado no es V/B/P
    const k = clave(c.idBolt || '');
    if (!k || !letraHoy.has(k)) return false;               // sin fila en la bitácora: manual
    return !AUSENCIA_LETRAS.includes(letraHoy.get(k));      // hoy ya no hay letra → volvió
  });
  if (!vueltos.length) return { reincorporados: 0, conductores: [] };

  // 1) A Activo provisional, para que el motor los cuente al recalcular.
  await cambiarEstados(vueltos.map(c => ({ id: c.idBolt, estado: 'Activo' })));

  // 2) El criterio del MOTOR decide el estado final: si tras recalcular queda como
  //    "Pendiente Asignar" (le faltan días o no tiene plaza), se le pone; si su
  //    semana está cubierta se queda en Activo. Cero lógica duplicada.
  const t2 = await leerTablero();
  const porId2 = new Map(((t2 && t2.conductores) || []).map(c => [clave(c.idBolt || ''), c]));
  const ajustes = [];
  const resultado = [];
  vueltos.forEach(c => {
    const n = porId2.get(clave(c.idBolt));
    const nuevo = n && n.estadoCalculado === 'Pendiente Asignar' ? 'Pendiente Asignar' : 'Activo';
    if (nuevo !== 'Activo') ajustes.push({ id: c.idBolt, estado: nuevo });
    resultado.push(`${c.idBolt}: ${c.estado} → ${nuevo}`);
  });
  if (ajustes.length) await cambiarEstados(ajustes);

  // 3) Limpiar la fecha de REINCORPORACION manual (col AH de AGENDA_V2), ya cumplida.
  try {
    const { SPREADSHEET_PLANIFICADOR } = require('./planificadorV2');
    const limpiezas = vueltos
      .filter(c => c.fila)
      .map(c => ({ range: `AGENDA_V2!AH${c.fila}`, values: [['']] }));
    if (limpiezas.length) await writeMany(SPREADSHEET_PLANIFICADOR, limpiezas);
  } catch (e) { console.warn(`⚠️ [VISTA_FINAL] No pude limpiar reincorporaciones: ${e.message}`); }

  return { reincorporados: resultado.length, conductores: resultado };
}

/**
 * Alertas de reincorporación de HOY (sin estado, recomputable todo el día): filas de
 * la bitácora con V/B/P AYER y sin letra HOY → "X volvió hoy de vacaciones/baja/permiso".
 * Las consume el panel de alertas del planificador junto a las de ausencias próximas.
 */
async function alertasReincorporados() {
  const hoy = hoyMadrid();
  const inicioMs = Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12);
  const colHoy = 3 + Math.round((hoy.getTime() - inicioMs) / 86400000);
  if (colHoy < 4) return [];   // hace falta que exista la columna de ayer

  const filas = await readSheet(ID_GESTION, `${HOJA}!A:ZZ`, { valueRenderOption: 'UNFORMATTED_VALUE' });
  const TIPO = { V: 'vacaciones', B: 'baja médica', P: 'permiso retribuido' };
  const out = [];
  for (let i = 3; i < filas.length; i++) {
    const nombre = (filas[i][1] || '').toString().trim();
    if (!nombre || nombre.toUpperCase() === 'CONDUCTOR') continue;
    const estadoCol = (filas[i][0] || '').toString();
    if (['Out', 'mapear'].some(s => estadoCol.includes(s))) continue;   // bajas/ocultos: no
    const ayer = String(filas[i][colHoy - 1] ?? '').trim().toUpperCase();
    const hoyL = String(filas[i][colHoy] ?? '').trim().toUpperCase();
    if (AUSENCIA_LETRAS.includes(ayer) && !AUSENCIA_LETRAS.includes(hoyL)) {
      out.push({ conductor: nombre, tipo: ayer, motivo: TIPO[ayer], fecha: isoFecha(hoy) });
    }
  }
  return out;
}

/**
 * Al haber una fecha de reincorporación en un conductor ausente (Vacaciones / Baja
 * Médica / Permiso Retribuido), rellena su letra (V/B/P) en la bitácora desde HOY
 * hasta la víspera de esa fecha, solo en celdas vacías o ya marcadas (nunca pisa
 * horas). Así la bitácora refleja todo el periodo de ausencia sin teclearlo día a
 * día, y las alertas / la cobertura quedan coherentes.
 */
async function escribirLetrasAusencia() {
  const hoy = hoyMadrid();
  const inicioMs = Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12);
  const finMs = Date.UTC(FIN.y, FIN.m, FIN.d, 12);
  const hoyMs = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 12);

  const [filas, tablero] = await Promise.all([
    readSheet(ID_GESTION, `${HOJA}!A:ZZ`, { valueRenderOption: 'UNFORMATTED_VALUE' }),
    leerTablero()
  ]);

  const filaPorId = new Map();   // clave(ID_BOLT) → fila 0-based en VISTA_FINAL
  for (let i = 3; i < filas.length; i++) {
    const id = (filas[i][1] || '').toString().trim();
    if (id && !filaPorId.has(clave(id))) filaPorId.set(clave(id), i);
  }

  const writes = [];
  const tocados = [];
  ((tablero && tablero.conductores) || []).forEach(c => {
    const letra = ESTADO_LETRA[c.estado];
    if (!letra || !c.reincorporacionD) return;
    const fila = filaPorId.get(clave(c.idBolt || ''));
    if (fila === undefined) return;
    const reincorpMs = c.reincorporacionD.getTime();
    let n = 0;
    for (let t = hoyMs; t < reincorpMs && t <= finMs; t += 86400000) {
      if (t < inicioMs) continue;
      const col = 3 + Math.round((t - inicioMs) / 86400000);
      const actual = String(filas[fila][col] ?? '').trim().toUpperCase();
      // Solo celdas vacías o ya marcadas (V/B/P): nunca se pisan horas.
      if ((actual === '' || actual === 'V' || actual === 'B' || actual === 'P') && actual !== letra) {
        writes.push({ range: `${HOJA}!${colLetra0(col)}${fila + 1}`, values: [[letra]] });
        n++;
      }
    }
    if (n) tocados.push(`${c.idBolt} ${letra}×${n}`);
  });

  if (writes.length) await writeMany(ID_GESTION, writes);
  return { celdas: writes.length, conductores: tocados };
}

/**
 * Escribe una letra (V/B/P) en la bitácora de un conductor (por ID_BOLT) para el
 * rango [desde, hasta] (dd/mm/aaaa), solo en celdas vacías o ya marcadas. Lo usa
 * la aprobación de peticiones en RRHH: al confirmar una ausencia, botcito rellena
 * el periodo aprobado.
 */
async function escribirLetrasRango(idBolt, letra, desdeStr, hastaStr) {
  const parse = s => {
    const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], 12) : null;
  };
  const desde = parse(desdeStr), hasta = parse(hastaStr);
  const L = String(letra || '').trim().toUpperCase();
  if (desde == null || hasta == null || hasta < desde || !['V', 'B', 'P'].includes(L)) return { celdas: 0 };

  const inicioMs = Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12);
  const finMs = Date.UTC(FIN.y, FIN.m, FIN.d, 12);
  const filas = await readSheet(ID_GESTION, `${HOJA}!A:ZZ`, { valueRenderOption: 'UNFORMATTED_VALUE' });

  let fila = -1;
  for (let i = 3; i < filas.length; i++) {
    if (clave((filas[i][1] || '').toString().trim()) === clave(idBolt)) { fila = i; break; }
  }
  if (fila === -1) return { celdas: 0 };

  const writes = [];
  for (let t = desde; t <= hasta && t <= finMs; t += 86400000) {
    if (t < inicioMs) continue;
    const col = 3 + Math.round((t - inicioMs) / 86400000);
    const actual = String(filas[fila][col] ?? '').trim().toUpperCase();
    if ((actual === '' || actual === 'V' || actual === 'B' || actual === 'P') && actual !== L) {
      writes.push({ range: `${HOJA}!${colLetra0(col)}${fila + 1}`, values: [[L]] });
    }
  }
  if (writes.length) await writeMany(ID_GESTION, writes);
  return { celdas: writes.length };
}

/**
 * Marca una 'J' (justificante de tráfico) en la bitácora para un conductor (por ID_BOLT)
 * en una fecha (dd/mm/aaaa), con FONDO AZUL. Sustituye lo que hubiera ese día (las horas),
 * y el cron la conserva (ver preservación de marcas). Si el conductor NO tiene fila en
 * VISTA_FINAL (un NN), no escribe nada y devuelve { escrito:false } — el justificante
 * queda solo en la hoja JUSTIFICANTES.
 */
async function marcarJustificante(idBolt, fechaStr) {
  const m = String(fechaStr || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  const t = m ? Date.UTC(+m[3], +m[2] - 1, +m[1], 12) : null;
  if (t == null) return { escrito: false, motivo: 'fecha inválida' };
  const inicioMs = Date.UTC(INICIO.y, INICIO.m, INICIO.d, 12);
  const finMs = Date.UTC(FIN.y, FIN.m, FIN.d, 12);
  if (t < inicioMs || t > finMs) return { escrito: false, motivo: 'fuera de rango' };
  const col = 3 + Math.round((t - inicioMs) / 86400000);

  const filas = await readSheet(ID_GESTION, `${HOJA}!A:ZZ`, { valueRenderOption: 'UNFORMATTED_VALUE' });
  let fila = -1;
  for (let i = 3; i < filas.length; i++) {
    if (clave((filas[i][1] || '').toString().trim()) === clave(idBolt)) { fila = i; break; }
  }
  if (fila === -1) return { escrito: false, motivo: 'NN (sin fila en VISTA_FINAL)' };

  await writeSheet(ID_GESTION, `${HOJA}!${colLetra0(col)}${fila + 1}`, [['J']]);
  // Fondo azul explícito (Node no colorea letras normalmente; lo hace el formato
  // condicional de la hoja, que no cubre la J, así que se lo ponemos nosotros).
  try {
    const sheetId = (await getSheetIds(ID_GESTION))[HOJA];
    if (sheetId !== undefined) {
      await batchUpdate(ID_GESTION, [{
        repeatCell: {
          range: { sheetId, startRowIndex: fila, endRowIndex: fila + 1, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: celdaColor({ bg: AZUL_JUST, fg: '#ffffff' }),
          fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor'
        }
      }]);
    }
  } catch (e) { console.warn(`⚠️ [VISTA_FINAL] color J: ${e.message}`); }

  return { escrito: true, fila: fila + 1, col };
}

module.exports = { reconstruirVistaFinal, alertasVistaFinal, aplicarAusenciasAutomaticas, aplicarReincorporaciones, alertasReincorporados, escribirLetrasAusencia, escribirLetrasRango, leerFinAusencias, marcarJustificante };
