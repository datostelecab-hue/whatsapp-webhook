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

const { leerTablero, leerOut } = require('./planificadorV2');
const { normClave } = require('./conductores');
const { leerHorasDatosApi } = require('./control');
const { readSheet, writeSheet, getSheetIds, batchUpdate } = require('./sheets');

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
  { has: 'Empresa',     bg: '#dc2626', fg: '#ffffff' },
  { has: 'Suspendido',  bg: '#6b7280', fg: '#ffffff' }
];
const COLOR_TURNO = [
  { has: 'TodoTurno',   bg: '#7c5cbf', fg: '#ffffff' },
  { has: 'Noche',       bg: '#1f2a44', fg: '#ffffff' },
  { has: 'Día',         bg: '#ffe08a', fg: '#1a1a1a' }
];

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
  const marcas = [];   // celdas (fila/col 0-based) con horas en día de libranza
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

module.exports = { reconstruirVistaFinal };
