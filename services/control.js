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
  const nombres = new Map();   // clave → nombre original (para poder mostrar los NN)
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
    if (!horas.has(clave)) { horas.set(clave, porDia); nombres.set(clave, nombre); }
  }
  return { mes, ano, horas, nombres };
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
  const pad = n => String(n).padStart(2, '0');

  const tablero = await leerTablero();
  const conductores = (tablero && tablero.conductores) || [];
  const datos = await leerHorasDatosApi();
  const telefonos = await leerTelefonosDB();

  const horasVigentes = datos.mes === M && datos.ano === Y;

  // Días a mostrar: hoy + los 3 anteriores (key 0..3).
  const ETIQ = ['Hoy', 'Ayer', 'Hace 2 días', 'Hace 3 días'];
  const dias = [];
  for (let k = 0; k < 4; k++) {
    const f = new Date(Date.UTC(Y, M - 1, D - k, 12));
    const idx = (f.getUTCDay() + 6) % 7;                              // Lun=0 … Dom=6
    const mismoMes = f.getUTCMonth() === M - 1 && f.getUTCFullYear() === Y;
    dias.push({
      key: k, etiqueta: ETIQ[k], idx,
      diaMes: f.getUTCDate(), diaSemana: DIAS[idx],
      fechaTxt: `${pad(f.getUTCDate())}/${pad(f.getUTCMonth() + 1)}`,
      disponible: mismoMes && horasVigentes   // solo hay horas de Datos_API para el mes en curso
    });
  }

  const infoDia = (c, dia, porDia) => {
    const libra = !!(c.libra && c.libra[dia.idx]);
    const mat = c.asignacion ? c.asignacion[dia.idx] : '';
    const debiaSalir = !!mat && mat !== 'L';
    const horas = (dia.disponible && porDia) ? (porDia[dia.diaMes] ?? 0) : null;
    const info = { libra, matricula: debiaSalir ? mat : '', debiaSalir, horas };
    if (dia.key === 0) info.estadoControl = estadoControl(info);
    return info;
  };

  const clavesUsadas = new Set();
  const filas = conductores.map(c => {
    const clave = normClave(c.idBolt);
    const porDia = (clave && datos.horas.get(clave)) || null;
    if (porDia) clavesUsadas.add(clave);
    const diasC = {};
    dias.forEach(dia => { diasC[dia.key] = infoDia(c, dia, porDia); });
    return {
      // Se muestra el NOMBRE DE BOLT (ID_BOLT). La seguridad social queda de apoyo.
      nombre: (c.idBolt || '').trim() || c.nombre || '(sin ID_BOLT)',
      nombreSS: c.nombre || '',
      tieneIdBolt: !!(c.idBolt && c.idBolt.trim()),
      esNN: false,
      ett: /ETT/i.test(c.contrato || ''),   // ETT vs Tibus (nuestro)
      contrato: c.contrato || '',
      turno: c.turno || '',
      estado: c.estadoCalculado || c.estado || '',
      telefono: (c.telefono && c.telefono.trim()) || (clave && telefonos.get(clave)) || '',
      enDatos: !!porDia,
      dias: diasC
    };
  });

  // NN: están en Datos_API pero NO casan con la agenda (otro nombre o no están).
  // Se traen con sus horas para que el total cuadre con Datos_API.
  const filasNN = [];
  for (const [clave, porDia] of datos.horas.entries()) {
    if (clavesUsadas.has(clave)) continue;
    const diasC = {};
    dias.forEach(dia => {
      const horas = dia.disponible ? (porDia[dia.diaMes] ?? 0) : null;
      const info = { libra: false, matricula: '', debiaSalir: false, horas };
      if (dia.key === 0) info.estadoControl = (horas != null && horas > 0) ? 'trabajando' : 'no_tocaba';
      diasC[dia.key] = info;
    });
    filasNN.push({
      nombre: datos.nombres.get(clave) || '(desconocido)',
      nombreSS: '', tieneIdBolt: false, esNN: true,
      ett: false, contrato: '', turno: '',
      estado: 'No está en planificador ni agenda',
      telefono: telefonos.get(clave) || '',
      enDatos: true, dias: diasC
    });
  }
  const todas = filas.concat(filasNN);

  const r1 = n => Math.round(n * 10) / 10;
  // Capa de verificación (fase BETA): se cuenta a TODA la gente que hizo horas en Datos_API
  // —aunque librara o no la esperáramos—, no solo a los que "debían salir"; por eso el
  // numerador puede superar al denominador (p. ej. 60/54). Los NN (sin turno) se suman a
  // NOCHE, donde suele haber conductores montados a última hora sin meter aún al sistema.
  // Umbral de "trabajó": en HOY basta con haberse CONECTADO (>0 h, para ver quién entró al
  // actualizarse Datos_API); en los días ya cerrados se exige >1 h (filtra logins de minutos).
  const resumenDia = dia => {
    const umbral = dia.key === 0 ? 0 : 1;
    const trabajoReal = info => (info.horas ?? 0) > umbral;
    const r = {};
    ['Día', 'Noche', 'TodoTurno'].forEach(t => {
      let del = todas.filter(f => !f.esNN && f.turno === t);
      if (t === 'Noche') del = del.concat(filasNN);
      const esperados = del.filter(f => f.dias[dia.key].debiaSalir);
      r[t] = {
        esperados: esperados.length,
        trabajaron: del.filter(f => trabajoReal(f.dias[dia.key])).length,        // TODOS los que hicieron >1h
        noTrabajaron: esperados.filter(f => !trabajoReal(f.dias[dia.key])).length, // esperados que NO llegaron a >1h
        libranza: del.filter(f => f.dias[dia.key].libra).length,
        horas: r1(del.reduce((s, f) => s + (f.dias[dia.key].horas ?? 0), 0))
      };
    });
    r.horasTotal = r1(todas.reduce((s, f) => s + (f.dias[dia.key].horas ?? 0), 0));
    r.horasNN = r1(filasNN.reduce((s, f) => s + (f.dias[dia.key].horas ?? 0), 0));
    return r;
  };
  const resumen = {};
  dias.forEach(dia => { resumen[dia.key] = resumenDia(dia); });

  return {
    fecha: `${pad(D)}/${pad(M)}/${Y}`,
    dias,
    horasVigentes,
    mesDatos: datos.mes ? `${MESES[datos.mes - 1]} ${datos.ano}` : null,
    resumen,
    conductores: todas
  };
}

module.exports = { tableroControl, leerHorasDatosApi };
