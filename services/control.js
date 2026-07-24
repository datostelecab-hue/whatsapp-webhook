// ============================================================
// CONTROL DE TRÁFICO: tablero en vivo de conductores
// ============================================================
// Junta dos fuentes, sin llamar a la API de Bolt (para que cargue rápido):
//   · AGENDA_V2 / PLANIFICADOR_V2 (leerTablero): quién es, turno, libranza y a
//     qué matrícula está asignado cada día → de aquí sale "quién DEBÍA salir".
//   · Datos_API (hoja GestionConductores, se refresca cada hora): horas por
//     conductor y día → de aquí sale "cuántas horas lleva".
// El cruce es por el nombre de Bolt (columna ID_BOLT de la agenda == nombre de
// Datos_API), normalizado.

const { leerTablero } = require('./planificadorV2');
const { normClave } = require('./conductores');
const { readSheet } = require('./sheets');

const ID_GESTION = '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const HOJA_DATOS = 'Datos_API';
const TZ = 'Europe/Madrid';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function hoyMadrid() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function numero(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
}

/**
 * Lee Datos_API y devuelve:
 *   { mes, ano, horas: Map(claveNombre -> { diaDelMes: horas }) }
 * Replica la disposición que usa el Apps Script: fila 0 cabecera con "Mes AAAA"
 * en A1, datos desde la fila 4, col B = nombre, col D (índice 3) = día 1.
 */
async function leerHorasDatosApi() {
  const filas = await readSheet(ID_GESTION, `${HOJA_DATOS}!A:AZ`);
  const horas = new Map();
  let mes = null, ano = null;

  if (filas.length && filas[0][0]) {
    const m = String(filas[0][0]).match(
      /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(\d{4})/i);
    if (m) { mes = MESES.indexOf(m[1].toLowerCase()) + 1; ano = parseInt(m[2]); }
  }

  for (let i = 3; i < filas.length; i++) {
    const nombre = (filas[i][1] || '').toString().trim();
    if (!nombre || nombre.toUpperCase().includes('TOTAL')) continue;
    const clave = normClave(nombre);
    if (!clave) continue;

    const porDia = {};
    for (let d = 0; d < 31; d++) {
      const v = numero(filas[i][3 + d]);
      if (v != null) porDia[d + 1] = v;
    }
    if (!horas.has(clave)) horas.set(clave, porDia);
  }

  return { mes, ano, horas };
}

function estadoControl({ libraHoy, debiaSalir, horasHoy }) {
  if (libraHoy) return 'libranza';
  if (!debiaSalir) return 'no_tocaba';
  if (horasHoy != null && horasHoy > 0) return 'trabajando';
  return 'no_salido';                       // asignado, no libra y 0 h
}

/**
 * Tablero para tráfico: una fila por conductor de la agenda, con turno,
 * matrícula de hoy, horas de hoy y de ayer, y el estado calculado.
 */
async function tableroControl() {
  const [Y, M, D] = hoyMadrid().split('-').map(Number);
  const base = new Date(Date.UTC(Y, M - 1, D, 12));
  const diaIdx = (base.getUTCDay() + 6) % 7;   // Lun=0 … Dom=6, como libra/asignacion

  const tablero = await leerTablero();
  const conductores = (tablero && tablero.conductores) || [];
  const datos = await leerHorasDatosApi();

  // ¿Datos_API es del mes actual? Si no, las horas están obsoletas.
  const horasVigentes = datos.mes === M && datos.ano === Y;
  const diaAyer = D - 1;                        // solo válido dentro del mes en curso

  const filas = conductores.map(c => {
    const clave = normClave(c.idBolt);           // ID_BOLT == nombre de Bolt
    const porDia = (clave && datos.horas.get(clave)) || null;

    const horasHoy = (horasVigentes && porDia) ? (porDia[D] ?? 0) : null;
    const horasAyer = (horasVigentes && diaAyer >= 1 && porDia) ? (porDia[diaAyer] ?? 0) : null;

    const libraHoy = !!(c.libra && c.libra[diaIdx]);
    const matriculaHoy = c.asignacion ? c.asignacion[diaIdx] : '';
    const debiaSalir = !!matriculaHoy && matriculaHoy !== 'L';

    return {
      nombre: c.nombre,
      idBolt: c.idBolt || '',
      turno: c.turno || '',
      estado: c.estadoCalculado || c.estado || '',
      telefono: c.telefono || '',
      matriculaHoy: debiaSalir ? matriculaHoy : '',
      libraHoy,
      debiaSalir,
      enDatos: !!porDia,
      horasHoy,
      horasAyer,
      estadoControl: estadoControl({ libraHoy, debiaSalir, horasHoy })
    };
  });

  // Resumen por turno (solo cuenta a quien debía salir hoy)
  const resumen = {};
  ['Día', 'Noche'].forEach(t => {
    const delTurno = filas.filter(f => f.turno === t);
    const esperados = delTurno.filter(f => f.debiaSalir);
    resumen[t] = {
      total: delTurno.length,
      esperados: esperados.length,
      trabajando: esperados.filter(f => f.estadoControl === 'trabajando').length,
      noSalido: esperados.filter(f => f.estadoControl === 'no_salido').length,
      libranza: delTurno.filter(f => f.libraHoy).length
    };
  });

  return {
    fecha: hoyMadrid(),
    diaSemana: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][diaIdx],
    horasVigentes,
    mesDatos: datos.mes ? `${MESES[datos.mes - 1]} ${datos.ano}` : null,
    resumen,
    conductores: filas
  };
}

module.exports = { tableroControl };
