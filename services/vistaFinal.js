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

const { leerTablero } = require('./planificadorV2');
const { normClave } = require('./conductores');
const { leerHorasDatosApi } = require('./control');
const { readSheet, writeSheet } = require('./sheets');

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

  // 5) Filas de conductores de la agenda.
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
    salida.push(fila);
  });

  // 6) Conductores que ya no están en la agenda: se conserva su fila completa
  //    (histórico intacto), no se recalcula nada.
  let conservados = 0;
  viejoPorClave.forEach((v, k) => {
    if (escritas.has(k)) return;
    conservados++;
    const fila = [v.estado, v.nombre, v.turno];
    for (let idx = 0; idx < nDias; idx++) fila.push(v.fila[3 + idx] ?? '');
    salida.push(fila);
  });

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

  return {
    conductoresAgenda: roster.length,
    conservados,
    filasEscritas: grid.length,
    dias: nDias,
    mesHoras: datos.mes ? `${datos.mes}/${datos.ano}` : null,
    horasVigentes,
    semana: `${isoFecha(lunes)} → ${isoFecha(domingo)}`
  };
}

module.exports = { reconstruirVistaFinal };
