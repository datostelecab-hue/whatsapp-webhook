// ============================================================
// CONTROL DE TRÁFICO: tablero en vivo de conductores
// ============================================================
// Junta, sin llamar a la API de Bolt (para que cargue rápido):
//   · AGENDA_V2 / PLANIFICADOR_V2 (leerTablero): turno, libranza y matrícula
//     asignada cada día → "quién DEBÍA salir".
//   · Datos_API (hoja GestionConductores, se refresca cada hora): horas por
//     conductor y día → "cuántas horas hizo".
//   · DB_CONDUCTORES (misma hoja): teléfonos que faltan en la agenda.
// Todo se cruza por el NOMBRE DE BOLT (columna ID_BOLT de la agenda), normalizado.

const { leerTablero } = require('./planificadorV2');
const { normClave } = require('./conductores');
const { readSheet } = require('./sheets');

const ID_GESTION = '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const HOJA_DATOS = 'Datos_API';
const HOJA_DB = 'DB_CONDUCTORES';
const TZ = 'Europe/Madrid';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

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

/** Datos_API → { mes, ano, horas: Map(clave -> { diaDelMes: horas }) }. */
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

/** DB_CONDUCTORES → Map(clave -> teléfono). Col G (7) nombre Bolt, col I (9) teléfono. */
async function leerTelefonosDB() {
  const filas = await readSheet(ID_GESTION, `${HOJA_DB}!A:I`);
  const tel = new Map();
  for (let i = 1; i < filas.length; i++) {
    const nombre = (filas[i][6] || '').toString().trim();     // col G
    const telefono = (filas[i][8] || '').toString().trim();   // col I
    if (!nombre || !telefono) continue;
    const clave = normClave(nombre);
    if (clave && !tel.has(clave)) tel.set(clave, telefono);
  }
  return tel;
}

function estadoControl({ libra, debiaSalir, horas }) {
  if (libra) return 'libranza';
  if (!debiaSalir) return 'no_tocaba';
  if (horas != null && horas > 0) return 'trabajando';
  return 'no_salido';
}

/**
 * Tablero para tráfico. Cada conductor trae su situación de HOY y de AYER
 * (calculadas con la libranza/asignación del día correspondiente, no solo la de
 * hoy), más las horas de cada día.
 */
async function tableroControl() {
  const [Y, M, D] = hoyMadrid().split('-').map(Number);
  const base = new Date(Date.UTC(Y, M - 1, D, 12));
  const idxHoy = (base.getUTCDay() + 6) % 7;      // Lun=0 … Dom=6
  const idxAyer = (idxHoy + 6) % 7;
  const Dayer = D - 1;

  const tablero = await leerTablero();
  const conductores = (tablero && tablero.conductores) || [];
  const datos = await leerHorasDatosApi();
  const telefonos = await leerTelefonosDB();

  const horasVigentes = datos.mes === M && datos.ano === Y;

  function diaInfo(c, idx, diaMes, porDia) {
    const libra = !!(c.libra && c.libra[idx]);
    const mat = c.asignacion ? c.asignacion[idx] : '';
    const debiaSalir = !!mat && mat !== 'L';
    const horas = (horasVigentes && diaMes >= 1 && porDia) ? (porDia[diaMes] ?? 0) : null;
    return { libra, matricula: debiaSalir ? mat : '', debiaSalir, horas };
  }

  const filas = conductores.map(c => {
    const clave = normClave(c.idBolt);
    const porDia = (clave && datos.horas.get(clave)) || null;

    const hoy = diaInfo(c, idxHoy, D, porDia);
    hoy.estadoControl = estadoControl(hoy);
    const ayer = diaInfo(c, idxAyer, Dayer, porDia);

    const telefono = (c.telefono && c.telefono.trim())
      || (clave && telefonos.get(clave)) || '';

    return {
      // Se muestra el NOMBRE DE BOLT (ID_BOLT). La seguridad social queda de apoyo.
      nombre: (c.idBolt || '').trim() || c.nombre || '(sin ID_BOLT)',
      nombreSS: c.nombre || '',
      tieneIdBolt: !!(c.idBolt && c.idBolt.trim()),
      turno: c.turno || '',
      estado: c.estadoCalculado || c.estado || '',
      telefono,
      enDatos: !!porDia,
      hoy, ayer
    };
  });

  const r1 = n => Math.round(n * 10) / 10;
  const resumenDe = sel => {
    const r = {};
    let horasTotal = 0;
    ['Día', 'Noche'].forEach(t => {
      const del = filas.filter(f => f.turno === t);
      const esperados = del.filter(f => sel(f).debiaSalir);
      const trabajaron = esperados.filter(f => (sel(f).horas ?? 0) > 0).length;
      const horas = del.reduce((s, f) => s + (sel(f).horas ?? 0), 0);
      horasTotal += horas;
      r[t] = {
        esperados: esperados.length,
        trabajaron,
        noTrabajaron: esperados.length - trabajaron,
        libranza: del.filter(f => sel(f).libra).length,
        horas: r1(horas)
      };
    });
    r.horasTotal = r1(horasTotal);
    return r;
  };

  return {
    fecha: `${String(D).padStart(2, '0')}/${String(M).padStart(2, '0')}/${Y}`,
    diaSemana: DIAS[idxHoy],
    diaSemanaAyer: DIAS[idxAyer],
    ayerDisponible: Dayer >= 1 && horasVigentes,
    horasVigentes,
    mesDatos: datos.mes ? `${MESES[datos.mes - 1]} ${datos.ano}` : null,
    resumen: { hoy: resumenDe(f => f.hoy), ayer: resumenDe(f => f.ayer) },
    conductores: filas
  };
}

module.exports = { tableroControl };
