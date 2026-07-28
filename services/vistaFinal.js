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
const { readSheet, writeSheet, getSheetIds, setRowVisibility } = require('./sheets');

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
  function celdaAgenda(c, f, idx, viejo) {
    const esMesActual = f.getUTCFullYear() === hoyY && (f.getUTCMonth() + 1) === hoyM;
    // Se conserva lo que ya hubiera cuando NO es el mes en curso (junio y antes,
    // o meses futuros) o cuando Datos_API no trae el mes en curso (desfasado /
    // cambio de mes): así nada reescribe el mes con ceros por accidente.
    if (!esMesActual || !horasVigentes) {
      return viejo ? (viejo.fila[3 + idx] ?? '') : '';
    }
    // Mes en curso con horas vigentes:
    if (f >= lunes && f <= domingo) {            // libranza solo de la semana viva
      const wd = (f.getUTCDay() + 6) % 7;
      if (c.libra && c.libra[wd]) return 'L';
    }
    const porDia = datos.horas.get(clave(c.idBolt || c.nombre));
    const h = porDia ? porDia[f.getUTCDate()] : null;
    if (h != null && h > 0) return h;
    if (f <= hoy) return 0;                       // pasado/hoy sin horas → 0
    return '';                                    // futuro del mes → en blanco
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
  roster.forEach(c => {
    const k = clave(c.idBolt || c.nombre);
    escritas.add(k);
    const viejo = viejoPorClave.get(k);
    const nombre = (c.idBolt || '').trim() || c.nombre || '(sin ID_BOLT)';
    const fila = [
      EST[c.estadoCalculado] || c.estadoCalculado || '',
      nombre,
      TUR[c.turno] || c.turno || ''
    ];
    fechas.forEach((f, idx) => fila.push(celdaAgenda(c, f, idx, viejo)));
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

  // 9) Ocultar las filas "Sin mapear" (y el relleno) y asegurar visibles el
  //    resto. Se hace determinista en cada corrida: no depende de cómo quedaron
  //    antes. Si falla (p. ej. protección), no se rompe la reconstrucción.
  let ocultadas = 0;
  try {
    const sheetId = (await getSheetIds(ID_GESTION))[HOJA];
    if (sheetId !== undefined) {
      ocultadas = grid.length - inicioOcultas;
      await setRowVisibility(ID_GESTION, sheetId, [
        { startIndex: 0, endIndex: inicioOcultas, hidden: false },
        { startIndex: inicioOcultas, endIndex: grid.length, hidden: true }
      ]);
    }
  } catch (e) {
    console.warn(`⚠️ [VISTA_FINAL] No se pudieron ocultar filas: ${e.message}`);
  }

  return {
    conductoresAgenda: roster.length,
    out: filasOut.length,
    sinMapear: filasSinMapear.length,
    ocultadas,
    filasEscritas: grid.length,
    dias: nDias,
    mesHoras: datos.mes ? `${datos.mes}/${datos.ano}` : null,
    horasVigentes,
    semana: `${isoFecha(lunes)} → ${isoFecha(domingo)}`
  };
}

module.exports = { reconstruirVistaFinal };
