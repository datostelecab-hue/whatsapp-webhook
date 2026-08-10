// ============================================================
// NÓMINAS EXTRAS (RRHH): compensación mensual variable
// ============================================================
// Replica el cálculo que RRHH hacía en Excel + AppScript, pero automático:
//   · Horas, nocturnas y facturación (Neto/FAS, propinas, peajes) → salen de la
//     hoja mensual "mes-año" (p. ej. julio-2026) que genera boltHorasCore en modo
//     histórico. Es tu "Junio 2026" + "RESUMEN_JUNIO" juntas.
//   · Utilización (has_order / horas efectivas) → ahora la calcula boltHorasCore
//     por conductor (columna "% Efec"); antes se pegaba a mano de Bolt.
//   · DNI/NIE → AGENDA_V2 (+ archivo CONDUCTORES_OUT).
// El resultado se puede CONGELAR en una hoja "NOMINA_mes-año" inmutable.
//
// NOVEDAD respecto al Excel: el arranque para prorratear el objetivo del mes NO es
// la fecha de alta, sino el PRIMER DÍA CON HORAS de ese conductor ese mes (se ve en
// la columna "Desde día"). La fecha de alta se deja intacta en la agenda.

const { procesarYUnificar } = require('./boltHorasCore');
const { SPREADSHEET_ID } = require('./turnos');                    // libro de horas mensuales
const { SPREADSHEET_PLANIFICADOR } = require('./planificadorV2');   // AGENDA_V2 (DNI)
const { readSheet, writeSheet, ensureSheet, clearSheet } = require('./sheets');
const { normClave } = require('./conductores');

// Parámetros de nómina EDITABLES (como las celdas B2:B8 de tu Excel). Los valores por
// defecto son los verificados contra junio; se pueden cambiar desde el panel y quedan
// guardados en la hoja NOMINA_CONFIG, que manda sobre estos defaults.
const DEFAULTS = {
  sueldoBase: 1445,     // informativo (no entra en el total de extras, como en el Excel)
  horasMetaDia: 8,      // horas objetivo por día operativo
  diasObjetivo: 22,     // días operativos de un mes completo
  eurHoraExtra: 7,      // € por hora extra × utilización.
                        // OJO: el .gs traía 9, pero la celda de config real (mayo y junio)
                        // tiene 7 y las fórmulas leían la celda → el valor REAL usado fue 7.
                        // Verificado reproduciendo junio: con 7 cuadra 164/164 al céntimo.
  lUtilizacion: 0.75,   // informativo (no entra en el cálculo, como en el Excel)
  umbralFAS: 4750,      // € de facturación neta desde los que hay MBO FAS
  pctMBOFAS: 0.4,       // fracción del exceso de facturación sobre el umbral
  eurHoraNoc: 8.16,     // € hora nocturna
  factorNoc: 0.1        // multiplicador de nocturnas (€hora × horas × 0.1)
};

// Orden y etiquetas para el panel. `usado` = si afecta al total (los demás son informativos).
const CONFIG_CAMPOS = [
  { key: 'sueldoBase', label: 'Sueldo base (€)', usado: false, dec: 2 },
  { key: 'horasMetaDia', label: 'Horas meta por día', usado: true, dec: 2 },
  { key: 'diasObjetivo', label: 'Días operativos objetivo (mes completo)', usado: true, dec: 2 },
  { key: 'eurHoraExtra', label: '€ por hora extra', usado: true, dec: 2 },
  { key: 'lUtilizacion', label: 'L utilización (informativo)', usado: false, dec: 2 },
  { key: 'umbralFAS', label: 'Umbral FAS (€)', usado: true, dec: 2 },
  { key: 'pctMBOFAS', label: '% MBO FAS (fracción, 0.4 = 40%)', usado: true, dec: 2 },
  { key: 'eurHoraNoc', label: '€ hora nocturna', usado: true, dec: 2 },
  { key: 'factorNoc', label: 'Factor nocturnas', usado: true, dec: 2 }
];

const HOJA_CONFIG = 'NOMINA_CONFIG';

// Lee la config (hoja NOMINA_CONFIG) sobre los defaults. Sin caché: es una sola
// llamada y así refleja al momento cualquier cambio manual en la hoja.
async function leerConfig() {
  const cfg = { ...DEFAULTS };
  const filas = await readSheet(SPREADSHEET_ID, `'${HOJA_CONFIG}'!A:B`).catch(() => []);
  (filas || []).forEach(f => {
    const k = (f[0] || '').toString().trim();
    if (k in cfg) { const v = parseFloat(String(f[1]).replace(',', '.')); if (!isNaN(v)) cfg[k] = v; }
  });
  return cfg;
}

// Guarda la config (solo claves conocidas y numéricas) y devuelve la config final.
async function guardarConfig(nuevos = {}) {
  const cfg = { ...(await leerConfig()) };
  Object.keys(nuevos).forEach(k => {
    if (k in DEFAULTS) { const v = parseFloat(String(nuevos[k]).replace(',', '.')); if (!isNaN(v)) cfg[k] = v; }
  });
  const values = CONFIG_CAMPOS.map(c => [c.key, cfg[c.key], c.label]);
  await ensureSheet(SPREADSHEET_ID, HOJA_CONFIG);
  await clearSheet(SPREADSHEET_ID, `'${HOJA_CONFIG}'!A:C`);
  await writeSheet(SPREADSHEET_ID, `'${HOJA_CONFIG}'!A1`, values);
  return cfg;
}

const MESES_SLUG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_NOM = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const hojaMes = (mes, ano) => `${MESES_SLUG[mes - 1]}-${ano}`;
const hojaNomina = (mes, ano) => `NOMINA_${MESES_SLUG[mes - 1]}-${ano}`;
const r2 = n => Math.round(n * 100) / 100;

const num = v => {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

// ---- DNI/NIE por nombre (AGENDA_V2 actual + CONDUCTORES_OUT archivados) ----
async function leerDnis() {
  const dni = new Map();
  const cargar = async rango => {
    const filas = await readSheet(SPREADSHEET_PLANIFICADOR, rango).catch(() => []);
    for (let i = 1; i < filas.length; i++) {
      const nombre = (filas[i][3] || '').toString().trim();   // col D = ID_BOLT (nombre Bolt)
      const d = (filas[i][4] || '').toString().trim();        // col E = DNI/NIE
      const k = normClave(nombre);
      if (k && d && !dni.has(k)) dni.set(k, d);
    }
  };
  await cargar('AGENDA_V2!A:E');
  await cargar('CONDUCTORES_OUT!A:E');
  return dni;
}

// ---- Lee la hoja mensual por CABECERA (tolerante a la posición de las columnas) ----
async function leerHojaMensual(mes, ano) {
  const hoja = hojaMes(mes, ano);
  const filas = await readSheet(SPREADSHEET_ID, `'${hoja}'!A1:BB2000`).catch(() => []);
  if (!filas || filas.length < 3) {
    throw new Error(`La hoja mensual "${hoja}" no existe o está vacía. Genera primero los datos del mes.`);
  }
  const cab = filas[1] || [];   // fila 0 = título, fila 1 = cabeceras
  const col = nombre => cab.findIndex(c => (c || '').toString().trim() === nombre);
  const iCond = col('Conductor'), iTotal = col('TOTAL'), iNoc = col('🌙 Noc'),
    iNeto = col('Neto €'), iProp = col('Propinas €'), iPeaje = col('Peajes €'), iEfec = col('% Efec');
  if (iCond < 0 || iTotal < 0) {
    throw new Error(`La hoja "${hoja}" no tiene el formato esperado (falta la columna Conductor o TOTAL).`);
  }

  // Columnas de día operativo (cabecera = "1".."31").
  const diaCol = {};
  cab.forEach((c, i) => {
    const t = (c || '').toString().trim();
    const n = parseInt(t, 10);
    if (String(n) === t && n >= 1 && n <= 31) diaCol[n] = i;
  });

  const conductores = [];
  for (let i = 2; i < filas.length; i++) {
    const nombre = (filas[i][iCond] || '').toString().trim();
    if (!nombre || nombre.includes('TOTAL')) continue;
    // Primer día con horas del mes (punto de arranque del prorrateo).
    let primerDia = 0;
    for (let d = 1; d <= 31; d++) {
      if (diaCol[d] != null && num(filas[i][diaCol[d]]) > 0) { primerDia = d; break; }
    }
    conductores.push({
      nombre,
      total: num(filas[i][iTotal]),
      noc: iNoc >= 0 ? num(filas[i][iNoc]) : 0,
      neto: iNeto >= 0 ? num(filas[i][iNeto]) : 0,
      propinas: iProp >= 0 ? num(filas[i][iProp]) : 0,
      peajes: iPeaje >= 0 ? num(filas[i][iPeaje]) : 0,
      efec: iEfec >= 0 ? num(filas[i][iEfec]) : null,   // null = hoja vieja sin la columna
      primerDia
    });
  }
  return { conductores, tieneEfec: iEfec >= 0, tieneDinero: iNeto >= 0 };
}

// ---- Cálculo de la nómina de UN conductor (tu cadena del .gs), según el config ----
function calcularFila(c, dnis, diasDelMes, cfg) {
  const util = (c.efec != null ? c.efec : 0) / 100;               // 0..1
  const primerDia = c.primerDia || 1;
  const diasDesde = diasDelMes - primerDia + 1;                   // del 1er día con horas a fin de mes
  const diasOperTgt = r2((diasDesde / diasDelMes) * cfg.diasObjetivo);
  const hsTgt = diasOperTgt * cfg.horasMetaDia;
  const delta = c.total - hsTgt;

  const mboHsExt = delta > 0 ? (delta * cfg.eurHoraExtra) * util : 0;   // € extra × utilización
  const eurNoc = cfg.eurHoraNoc * c.noc * cfg.factorNoc;
  const mboFAS = c.neto > cfg.umbralFAS ? (c.neto - cfg.umbralFAS) * cfg.pctMBOFAS : 0;
  const totalMBO = Math.max(mboHsExt, mboFAS);                    // gana el mayor de los dos MBO
  const compensacion = mboHsExt > mboFAS ? mboHsExt : 0;         // informativo: cuánto puso el MBO de horas
  const diasExtra = delta > cfg.horasMetaDia ? delta / cfg.horasMetaDia : 0;
  const total = eurNoc + c.peajes + c.propinas + totalMBO;

  return {
    nombre: c.nombre,
    dni: dnis.get(normClave(c.nombre)) || '',
    primerDia,
    horas: r2(c.total),
    horasObjetivo: r2(hsTgt),
    deltaHoras: r2(delta),
    utilPct: c.efec != null ? c.efec : null,      // % (0..100) o null si no hay dato
    propinas: r2(c.propinas),
    peajes: r2(c.peajes),
    nocturnas: r2(eurNoc),
    mboFAS: r2(mboFAS),
    mboHsExt: r2(mboHsExt),
    compensacion: r2(compensacion),
    diasExtra: r2(diasExtra),
    total: r2(total)
  };
}

// ---- Genera la nómina completa de un mes (sin escribir nada) ----
async function generar(mes, ano, opciones = {}) {
  const cfg = opciones.config || await leerConfig();

  // 1. (Re)generar la hoja mensual con datos frescos de Bolt + utilización, salvo
  //    que se pida saltar (recálculo solo por cambio de config = actualizar:false).
  if (opciones.actualizar !== false) {
    await procesarYUnificar(mes, ano, { hojaDestino: hojaMes(mes, ano), incluirTodos: true, modoHistorico: true });
  }

  const [mensual, dnis] = await Promise.all([leerHojaMensual(mes, ano), leerDnis()]);
  const diasDelMes = new Date(ano, mes, 0).getDate();

  // Solo entra quien trabajó ese mes (tiene horas). Es "por mes", como pediste.
  const filas = mensual.conductores
    .filter(c => c.total > 0)
    .map(c => calcularFila(c, dnis, diasDelMes, cfg))
    .sort((a, b) => b.total - a.total);

  const totales = filas.reduce((t, f) => {
    t.propinas += f.propinas; t.peajes += f.peajes; t.nocturnas += f.nocturnas;
    t.mboFAS += f.mboFAS; t.compensacion += f.compensacion;
    t.diasExtra += f.diasExtra; t.total += f.total;
    return t;
  }, { propinas: 0, peajes: 0, nocturnas: 0, mboFAS: 0, compensacion: 0, diasExtra: 0, total: 0 });
  Object.keys(totales).forEach(k => totales[k] = r2(totales[k]));

  return {
    mes, ano, mesNombre: MESES_NOM[mes - 1], diasDelMes,
    filas, totales, config: cfg,
    congelada: await existeCongelada(mes, ano),
    avisos: {
      sinEfec: !mensual.tieneEfec,       // hoja vieja sin utilización (regenera para tenerla)
      sinDinero: !mensual.tieneDinero,   // hoja sin facturación
      sinDni: filas.filter(f => !f.dni).length
    }
  };
}

// ---- Generación en segundo plano (procesarYUnificar tarda minutos) ----
let _estado = { generando: false, mes: null, ano: null, fase: '', resultado: null, error: null };

function estado() { return _estado; }

function generarEnFondo(mes, ano, opciones = {}) {
  if (_estado.generando) throw new Error('Ya hay una nómina generándose');
  _estado = {
    generando: true, mes, ano, error: null, resultado: null,
    fase: opciones.actualizar === false
      ? 'Leyendo los datos ya calculados del mes…'
      : 'Descargando y recalculando datos de Bolt (horas, nocturnas, facturación, utilización)… puede tardar unos minutos.'
  };
  (async () => {
    try {
      _estado.resultado = await generar(mes, ano, opciones);
      _estado.fase = 'Listo';
    } catch (e) {
      _estado.error = e.message; _estado.fase = 'Error';
      console.error('❌ [NOMINA] ', e.stack || e.message);
    } finally {
      _estado.generando = false;
    }
  })();
  return { iniciado: true, mes, ano };
}

// ---- Congelar: escribe el resultado en una hoja NOMINA_mes-año inmutable ----
async function congelar(mes, ano) {
  const enMemoria = _estado.resultado && _estado.resultado.mes === mes && _estado.resultado.ano === ano
    ? _estado.resultado : null;
  const r = enMemoria || await generar(mes, ano, { actualizar: false });

  const hoja = hojaNomina(mes, ano);
  const cab = ['Nombre del conductor', 'DNI/NIE', 'Desde día', 'Horas', 'Propinas (€)', 'Peajes (€)',
    'Nocturnas (€)', 'MBO FAS (€)', 'Compensación (€)', 'Días extra', '%Utilización', 'TOTAL (€)'];
  const values = [[`💶 NÓMINA EXTRAS · ${MESES_NOM[mes - 1]} ${ano} · congelada`], cab];
  r.filas.forEach(f => values.push([
    f.nombre, f.dni, f.primerDia, f.horas, f.propinas, f.peajes,
    f.nocturnas, f.mboFAS, f.compensacion, f.diasExtra,
    f.utilPct == null ? '' : f.utilPct, f.total
  ]));
  values.push(['📌 TOTAL', '', '', '', r.totales.propinas, r.totales.peajes, r.totales.nocturnas,
    r.totales.mboFAS, r.totales.compensacion, r.totales.diasExtra, '', r.totales.total]);

  // Config usada (para que el mes quede reproducible: quién cambió qué tarifa y cuándo).
  const cfg = r.config || await leerConfig();
  values.push([]);
  values.push(['⚙️ Config usada al congelar']);
  CONFIG_CAMPOS.forEach(c => values.push([c.label, cfg[c.key]]));

  const ref = `'${hoja}'`;
  await ensureSheet(SPREADSHEET_ID, hoja);
  await clearSheet(SPREADSHEET_ID, `${ref}!A:Z`);
  await writeSheet(SPREADSHEET_ID, `${ref}!A1`, values);
  return { hoja, conductores: r.filas.length, total: r.totales.total };
}

// Recalcula un mes YA generado con (opcionalmente) un config nuevo, sin volver a
// descargar de Bolt. Rápido: solo relee la hoja mensual y reaplica las fórmulas.
async function recalcular(mes, ano, config) {
  if (config) await guardarConfig(config);
  const r = await generar(mes, ano, { actualizar: false });
  _estado = { generando: false, mes, ano, fase: 'Recalculado', error: null, resultado: r };
  return r;
}

async function existeCongelada(mes, ano) {
  const filas = await readSheet(SPREADSHEET_ID, `'${hojaNomina(mes, ano)}'!A1:A3`).catch(() => []);
  return !!(filas && filas.length);
}

// ---- Lee una nómina ya congelada (para revisarla sin recalcular) ----
async function leerCongelada(mes, ano) {
  const filas = await readSheet(SPREADSHEET_ID, `'${hojaNomina(mes, ano)}'!A1:L2000`).catch(() => []);
  if (!filas || filas.length < 3) return null;
  const datos = [];
  for (let i = 2; i < filas.length; i++) {
    const f = filas[i] || [];
    if (!f[0] || f[0].toString().includes('TOTAL')) continue;
    datos.push({
      nombre: f[0], dni: f[1], primerDia: num(f[2]), horas: num(f[3]),
      propinas: num(f[4]), peajes: num(f[5]), nocturnas: num(f[6]), mboFAS: num(f[7]),
      compensacion: num(f[8]), diasExtra: num(f[9]),
      utilPct: f[10] === '' || f[10] == null ? null : num(f[10]), total: num(f[11])
    });
  }
  return { mes, ano, mesNombre: MESES_NOM[mes - 1], filas: datos, congelada: true };
}

module.exports = {
  DEFAULTS, CONFIG_CAMPOS, MESES_NOM, hojaMes, hojaNomina,
  leerConfig, guardarConfig, recalcular,
  generar, generarEnFondo, estado, congelar, leerCongelada, existeCongelada, leerDnis
};
