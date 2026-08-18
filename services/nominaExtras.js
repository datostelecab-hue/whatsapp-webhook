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
// ARRANQUE DEL PRORRATEO: la FECHA DE ALTA (AGENDA_V2 / CONDUCTORES_OUT, col G,
// formato dd/mm/aaaa). Manda ella, no el primer día con horas:
//   · alta ANTES del mes de trabajo  → mes completo, sin prorratear. Un veterano que
//     libró la primera quincena ya no ve su objetivo partido por la mitad (con el
//     criterio viejo le bastaba media jornada para "hacer extras").
//   · alta DENTRO del mes            → se prorratea desde su día de alta.
//   · alta DESPUÉS del mes           → no entra en esa nómina (aún no trabajaba).
//   · sin fecha                      → se conserva el criterio viejo (primer día con
//     horas) y se marca en el panel, para que nadie se quede sin cobrar por un dato
//     vacío que a alguien se le olvidó rellenar.

const { procesarYUnificar } = require('./boltHorasCore');
const { SPREADSHEET_ID } = require('./turnos');                    // libro de horas mensuales
const { SPREADSHEET_PLANIFICADOR } = require('./planificadorV2');   // AGENDA_V2 (DNI)
const { readSheet, writeSheet, ensureSheet, clearSheet } = require('./sheets');
const { normClave } = require('./conductores');

// Parámetros de nómina EDITABLES (como las celdas B2:B8 de tu Excel). Los valores por
// defecto son los verificados contra junio; se pueden cambiar desde el panel y quedan
// guardados en la hoja NOMINA_CONFIG, que manda sobre estos defaults.
const DEFAULTS = {
  // Sueldo base y umbral FAS son DISTINTOS por jornada (40h vs 32h). Los de 32h
  // arrancan igual que los de 40h para no cambiar nada hasta que pongas los reales.
  sueldoBase40: 1445, sueldoBase32: 1445,   // informativos (no entran en el total, como en el Excel)
  horasMetaDia: 8,      // horas objetivo por día operativo
  diasObjetivo: 22,     // días operativos de un mes completo
  eurHoraExtra: 7,      // € por hora extra × utilización.
                        // OJO: el .gs traía 9, pero la celda de config real (mayo y junio)
                        // tiene 7 y las fórmulas leían la celda → el valor REAL usado fue 7.
                        // Verificado reproduciendo junio: con 7 cuadra 164/164 al céntimo.
  lUtilizacion: 0.75,   // informativo (no entra en el cálculo, como en el Excel)
  umbralFAS40: 4750, umbralFAS32: 4750,     // USADO — a partir de este neto hay MBO FAS, según jornada
  pctMBOFAS: 0.4,       // fracción del exceso de facturación sobre el umbral
  eurHoraNoc: 8.16,     // € hora nocturna
  factorNoc: 0.1        // multiplicador de nocturnas (€hora × horas × 0.1)
};

// Orden y etiquetas para el panel. `usado` = si afecta al total (los demás son informativos).
const CONFIG_CAMPOS = [
  { key: 'sueldoBase40', label: 'Sueldo base 40h (€)', usado: false },
  { key: 'sueldoBase32', label: 'Sueldo base 32h (€)', usado: false },
  { key: 'horasMetaDia', label: 'Horas meta por día', usado: true },
  { key: 'diasObjetivo', label: 'Días operativos objetivo (mes completo)', usado: true },
  { key: 'eurHoraExtra', label: '€ por hora extra', usado: true },
  { key: 'lUtilizacion', label: 'L utilización (informativo)', usado: false },
  { key: 'umbralFAS40', label: 'Umbral FAS 40h (€)', usado: true },
  { key: 'umbralFAS32', label: 'Umbral FAS 32h (€)', usado: true },
  { key: 'pctMBOFAS', label: '% MBO FAS (fracción, 0.4 = 40%)', usado: true },
  { key: 'eurHoraNoc', label: '€ hora nocturna', usado: true },
  { key: 'factorNoc', label: 'Factor nocturnas', usado: true }
];

const HOJA_CONFIG = 'NOMINA_CONFIG';

// Lee la config (hoja NOMINA_CONFIG) sobre los defaults. Sin caché: es una sola
// llamada y así refleja al momento cualquier cambio manual en la hoja.
async function leerConfig() {
  const cfg = { ...DEFAULTS };
  const filas = await readSheet(LIBRO_NOMINA, `'${HOJA_CONFIG}'!A:B`).catch(() => []);
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
  await ensureSheet(LIBRO_NOMINA, HOJA_CONFIG);
  await clearSheet(LIBRO_NOMINA, `'${HOJA_CONFIG}'!A:C`);
  await writeSheet(LIBRO_NOMINA, `'${HOJA_CONFIG}'!A1`, values);
  return cfg;
}

const MESES_SLUG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_NOM = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const hojaMes = (mes, ano) => `${MESES_SLUG[mes - 1]}-${ano}`;       // hoja de horas (fuente)
const hojaNomina = (mes, ano) => `NOMINA_${MESES_SLUG[mes - 1]}-${ano}`;       // congelado final
const hojaDatos = (mes, ano) => `NOMINA_DATOS_${MESES_SLUG[mes - 1]}-${ano}`;  // snapshot de datos crudos
const r2 = n => Math.round(n * 100) / 100;

// Libro donde viven las hojas PROPIAS de nómina (config, snapshot de datos, congelados).
// Es la "base de datos de nóminas": una vez generado el mes, recalcular/congelar/leer
// salen de aquí, sin volver a Bolt ni a la agenda. Por defecto el mismo libro de horas;
// para tenerla en un libro APARTE (con otro ID y acceso solo RRHH), crea el libro,
// compártelo con la cuenta de servicio y cambia solo esta línea.
const LIBRO_NOMINA = SPREADSHEET_ID;

// Nóminas a MES VENCIDO: la nómina de un mes se calcula con los datos del mes ANTERIOR
// (la de julio usa junio; la de enero, diciembre del año pasado). El mes seleccionado
// es el de PAGO; el prorrateo y los datos salen del mes de trabajo.
const mesVencido = (mes, ano) => (mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano });

const num = v => {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

const esEtt = contrato => /ETT/i.test(contrato || '');

/**
 * 'dd/mm/aaaa' (lo que hay en la col G de la agenda) → { d, m, a }, o null si está
 * vacía o no se entiende. Acepta también guiones y años de dos cifras.
 */
function parseAlta(txt) {
  const s = String(txt == null ? '' : txt).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  const d = +m[1], mes = +m[2];
  let a = +m[3];
  if (a < 100) a += 2000;
  if (d < 1 || d > 31 || mes < 1 || mes > 12 || a < 1990 || a > 2100) return null;
  return { d, m: mes, a };
}

/**
 * Sitúa el alta respecto al mes de TRABAJO:
 *   'antes'    ya estaba de alta → mes completo
 *   'dentro'   entró ese mes     → prorratea desde alta.d
 *   'despues'  entró más tarde   → fuera de esta nómina
 *   null       sin fecha usable  → se decide con el criterio viejo
 */
function situarAlta(alta, mesTrabajo, anoTrabajo) {
  if (!alta) return null;
  if (alta.a < anoTrabajo || (alta.a === anoTrabajo && alta.m < mesTrabajo)) return 'antes';
  if (alta.a === anoTrabajo && alta.m === mesTrabajo) return 'dentro';
  return 'despues';
}

// Jornada del contrato en horas (40 o 32) para elegir umbral FAS / sueldo base.
// "40h", "ETT 40h", "40 horas"… → 40. "32h" → 32. Si no se reconoce, 40 por defecto.
const horasContrato = contrato => {
  const s = String(contrato || '');
  const m = s.match(/(\d{2})\s*h/i) || s.match(/\b(32|40)\b/);
  return m && m[1] === '32' ? 32 : 40;
};

// ---- Ficha (DNI + contrato) por nombre (AGENDA_V2 actual + CONDUCTORES_OUT archivados).
//      El contrato distingue ETT de Tibus (los nuestros). ----
async function leerFichas() {
  const fichas = new Map();
  const cargar = async rango => {
    const filas = await readSheet(SPREADSHEET_PLANIFICADOR, rango).catch(() => []);
    for (let i = 1; i < filas.length; i++) {
      const nombre = (filas[i][3] || '').toString().trim();    // col D = ID_BOLT (nombre Bolt)
      const k = normClave(nombre);
      if (!k || fichas.has(k)) continue;
      fichas.set(k, {
        dni: (filas[i][4] || '').toString().trim(),            // col E = DNI/NIE
        contrato: (filas[i][11] || '').toString().trim(),      // col L = CONTRATO
        alta: (filas[i][6] || '').toString().trim()            // col G = FECHA_ALTA (dd/mm/aaaa)
      });
    }
  };
  await cargar('AGENDA_V2!A:L');
  await cargar('CONDUCTORES_OUT!A:L');
  return fichas;
}

// Enriquece los conductores leídos de la hoja de horas con su DNI/contrato/ETT.
function enriquecer(conductores, fichas) {
  return conductores.map(c => {
    const fi = fichas.get(normClave(c.nombre)) || {};
    return { ...c, dni: fi.dni || '', contrato: fi.contrato || '', ett: esEtt(fi.contrato), alta: fi.alta || '' };
  });
}

// ---- Snapshot: la "base de datos" de datos crudos del mes, para recalcular sin Bolt ----
async function escribirSnapshot(mes, ano, conductores) {
  const hoja = hojaDatos(mes, ano);
  const { mes: mesD, ano: anoD } = mesVencido(mes, ano);
  const cab = ['Conductor', 'DNI/NIE', 'Contrato', 'Tipo', 'Desde día', 'Horas',
    'Nocturnas (h)', 'Neto € (FAS)', 'Propinas €', 'Peajes €', '% Efec', 'Fecha alta'];
  const values = [[`📦 DATOS NÓMINA · ${MESES_NOM[mes - 1]} ${ano} (mes vencido: trabajo de ${MESES_NOM[mesD - 1]} ${anoD}) — base para recalcular sin Bolt`], cab];
  conductores.forEach(c => values.push([
    c.nombre, c.dni || '', c.contrato || '', c.ett ? 'ETT' : 'Tibus', c.primerDia,
    c.total, c.noc, c.neto, c.propinas, c.peajes, c.efec == null ? '' : c.efec,
    c.alta || ''
  ]));
  const ref = `'${hoja}'`;
  await ensureSheet(LIBRO_NOMINA, hoja);
  await clearSheet(LIBRO_NOMINA, `${ref}!A:Z`);
  await writeSheet(LIBRO_NOMINA, `${ref}!A1`, values);
}

async function leerSnapshot(mes, ano) {
  const filas = await readSheet(LIBRO_NOMINA, `'${hojaDatos(mes, ano)}'!A1:Z5000`).catch(() => []);
  if (!filas || filas.length < 3) return null;
  const out = [];
  for (let i = 2; i < filas.length; i++) {
    const f = filas[i] || [];
    const nombre = (f[0] || '').toString().trim();
    if (!nombre || nombre.includes('TOTAL')) continue;
    out.push({
      nombre, dni: (f[1] || '').toString().trim(), contrato: (f[2] || '').toString().trim(),
      ett: (f[3] || '').toString().trim().toUpperCase() === 'ETT',
      primerDia: num(f[4]), total: num(f[5]), noc: num(f[6]), neto: num(f[7]),
      propinas: num(f[8]), peajes: num(f[9]),
      efec: f[10] === '' || f[10] == null ? null : num(f[10]),
      // Los snapshots anteriores a este cambio no traen la columna: quedan como antes.
      alta: (f[11] || '').toString().trim()
    });
  }
  return out;
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
function calcularFila(c, diasDelMes, cfg, mesTrabajo, anoTrabajo) {
  const util = (c.efec != null ? c.efec : 0) / 100;               // 0..1

  // Día desde el que cuenta el mes para este conductor:
  //   alta anterior al mes  → 1 (mes completo)
  //   alta dentro del mes   → el día del alta
  //   sin fecha             → criterio viejo (primer día con horas)
  const alta = parseAlta(c.alta);
  const donde = situarAlta(alta, mesTrabajo, anoTrabajo);
  let arranque, origen;
  if (donde === 'antes')       { arranque = 1;       origen = 'alta-anterior'; }
  else if (donde === 'dentro') { arranque = alta.d;  origen = 'alta-en-mes'; }
  else                         { arranque = c.primerDia || 1; origen = 'primer-log'; }

  const primerDia = Math.min(Math.max(arranque, 1), diasDelMes);
  const diasDesde = diasDelMes - primerDia + 1;                   // del arranque a fin de mes
  const diasOperTgt = r2((diasDesde / diasDelMes) * cfg.diasObjetivo);
  const hsTgt = diasOperTgt * cfg.horasMetaDia;
  const delta = c.total - hsTgt;

  const jornada = horasContrato(c.contrato);                            // 40 | 32
  const umbral = jornada === 32 ? cfg.umbralFAS32 : cfg.umbralFAS40;     // umbral FAS según jornada
  const mboHsExt = delta > 0 ? (delta * cfg.eurHoraExtra) * util : 0;   // € extra × utilización
  const eurNoc = cfg.eurHoraNoc * c.noc * cfg.factorNoc;
  const mboFAS = c.neto > umbral ? (c.neto - umbral) * cfg.pctMBOFAS : 0;
  const totalMBO = Math.max(mboHsExt, mboFAS);                    // gana el mayor de los dos MBO
  const compensacion = mboHsExt > mboFAS ? mboHsExt : 0;         // informativo: cuánto puso el MBO de horas
  const diasExtra = delta > cfg.horasMetaDia ? delta / cfg.horasMetaDia : 0;
  const total = eurNoc + c.peajes + c.propinas + totalMBO;

  return {
    nombre: c.nombre,
    dni: c.dni || '',
    ett: !!c.ett,
    contrato: c.contrato || '',
    jornada,
    primerDia,
    alta: c.alta || '',
    origenArranque: origen,      // alta-anterior | alta-en-mes | primer-log
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
async function generar(mesNom, anoNom, opciones = {}) {
  const cfg = opciones.config || await leerConfig();
  // MES VENCIDO: los datos son los del mes ANTERIOR (la nómina de julio usa junio).
  const { mes: mesD, ano: anoD } = mesVencido(mesNom, anoNom);
  const diasDelMes = new Date(anoD, mesD, 0).getDate();   // días del mes de TRABAJO (para prorratear)

  let conductores, sinEfec, sinDinero;

  if (opciones.actualizar !== false) {
    // GENERAR (pesado): baja de Bolt el mes de TRABAJO, regenera su hoja de horas +
    // utilización y guarda el SNAPSHOT con el nombre de la NÓMINA (mes de pago).
    await procesarYUnificar(mesD, anoD, { hojaDestino: hojaMes(mesD, anoD), incluirTodos: true, modoHistorico: true });
    const [mensual, fichas] = await Promise.all([leerHojaMensual(mesD, anoD), leerFichas()]);
    conductores = enriquecer(mensual.conductores, fichas);
    sinEfec = !mensual.tieneEfec; sinDinero = !mensual.tieneDinero;
    await escribirSnapshot(mesNom, anoNom, conductores);
  } else {
    // RECALCULAR (rápido): del snapshot, SIN tocar Bolt ni la agenda. Si aún no hay
    // snapshot, cae a la hoja de horas del mes de trabajo + agenda.
    conductores = await leerSnapshot(mesNom, anoNom);
    if (conductores) {
      sinEfec = conductores.length > 0 && conductores.every(c => c.efec == null);
      sinDinero = conductores.length > 0 && conductores.every(c => !c.neto && !c.propinas && !c.peajes);
    } else {
      const [mensual, fichas] = await Promise.all([leerHojaMensual(mesD, anoD), leerFichas()]);
      conductores = enriquecer(mensual.conductores, fichas);
      sinEfec = !mensual.tieneEfec; sinDinero = !mensual.tieneDinero;
    }
  }

  // Solo entra quien trabajó ese mes (tiene horas)…
  const conHoras = conductores.filter(c => c.total > 0);

  // …y que ya estuviera de alta. Quien entró DESPUÉS del mes de trabajo (p. ej. alta
  // en julio para la nómina que paga el trabajo de junio) no pinta nada aquí; si tiene
  // horas es que la fecha está mal puesta, así que se lista aparte en vez de callarlo.
  const fuera = [];
  const dentro = conHoras.filter(c => {
    if (situarAlta(parseAlta(c.alta), mesD, anoD) !== 'despues') return true;
    fuera.push({ nombre: c.nombre, alta: c.alta, horas: r2(c.total) });
    return false;
  });

  const filas = dentro
    .map(c => calcularFila(c, diasDelMes, cfg, mesD, anoD))
    .sort((a, b) => b.total - a.total);

  const totales = filas.reduce((t, f) => {
    t.propinas += f.propinas; t.peajes += f.peajes; t.nocturnas += f.nocturnas;
    t.mboFAS += f.mboFAS; t.compensacion += f.compensacion;
    t.diasExtra += f.diasExtra; t.total += f.total;
    return t;
  }, { propinas: 0, peajes: 0, nocturnas: 0, mboFAS: 0, compensacion: 0, diasExtra: 0, total: 0 });
  Object.keys(totales).forEach(k => totales[k] = r2(totales[k]));

  // ¿El mes de trabajo aún no terminó? → datos incompletos (aún no toca esa nómina).
  const hoy = new Date();
  const trabajoIncompleto = anoD > hoy.getFullYear() ||
    (anoD === hoy.getFullYear() && mesD >= hoy.getMonth() + 1);

  return {
    mes: mesNom, ano: anoNom, mesNombre: MESES_NOM[mesNom - 1], diasDelMes,
    mesDatos: mesD, anoDatos: anoD, mesDatosNombre: MESES_NOM[mesD - 1],
    filas, totales, config: cfg,
    congelada: await existeCongelada(mesNom, anoNom),
    avisos: {
      sinEfec, sinDinero, sinDni: filas.filter(f => !f.dni).length, trabajoIncompleto,
      // Sin fecha de alta: cobran con el criterio viejo, pero conviene rellenarles la col G.
      sinAlta: filas.filter(f => f.origenArranque === 'primer-log').length,
      // Altas dentro del mes de trabajo: son los únicos con el objetivo prorrateado.
      altaEnMes: filas.filter(f => f.origenArranque === 'alta-en-mes').length,
      // Con horas pero alta POSTERIOR al mes: fuera de esta nómina (revisar la fecha).
      excluidos: fuera
    }
  };
}

// ---- Generación en segundo plano (procesarYUnificar tarda minutos) ----
let _estado = { generando: false, mes: null, ano: null, fase: '', resultado: null, error: null };

function estado() { return _estado; }

function generarEnFondo(mes, ano, opciones = {}) {
  if (_estado.generando) throw new Error('Ya hay una nómina generándose');
  const { mes: mesD, ano: anoD } = mesVencido(mes, ano);
  _estado = {
    generando: true, mes, ano, error: null, resultado: null,
    fase: opciones.actualizar === false
      ? `Leyendo los datos guardados (trabajo de ${MESES_NOM[mesD - 1]} ${anoD})…`
      : `Descargando de Bolt los datos de ${MESES_NOM[mesD - 1]} ${anoD} para la nómina de ${MESES_NOM[mes - 1]} ${ano}… puede tardar unos minutos.`
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
  // 'Fecha alta' va al final: leerCongelada busca por nombre de cabecera, así que
  // los meses congelados antes de este cambio se siguen leyendo igual.
  const cab = ['Nombre del conductor', 'DNI/NIE', 'Tipo', 'Jornada', 'Desde día', 'Horas', 'Propinas (€)', 'Peajes (€)',
    'Nocturnas (€)', 'MBO FAS (€)', 'Compensación (€)', 'Días extra', '%Utilización', 'TOTAL (€)', 'Fecha alta'];
  const values = [[`💶 NÓMINA EXTRAS · ${MESES_NOM[mes - 1]} ${ano} · congelada` +
    (r.mesDatosNombre ? ` (mes vencido: trabajo de ${r.mesDatosNombre} ${r.anoDatos})` : '')], cab];
  r.filas.forEach(f => values.push([
    f.nombre, f.dni, f.ett ? 'ETT' : 'Tibus', f.jornada ? f.jornada + ' horas' : '',
    f.primerDia, f.horas, f.propinas, f.peajes,
    f.nocturnas, f.mboFAS, f.compensacion, f.diasExtra,
    f.utilPct == null ? '' : f.utilPct, f.total, f.alta || ''
  ]));
  values.push(['📌 TOTAL', '', '', '', '', '', r.totales.propinas, r.totales.peajes, r.totales.nocturnas,
    r.totales.mboFAS, r.totales.compensacion, r.totales.diasExtra, '', r.totales.total]);

  // Config usada (para que el mes quede reproducible: quién cambió qué tarifa y cuándo).
  const cfg = r.config || await leerConfig();
  values.push([]);
  values.push(['⚙️ Config usada al congelar']);
  CONFIG_CAMPOS.forEach(c => values.push([c.label, cfg[c.key]]));

  const ref = `'${hoja}'`;
  await ensureSheet(LIBRO_NOMINA, hoja);
  await clearSheet(LIBRO_NOMINA, `${ref}!A:Z`);
  await writeSheet(LIBRO_NOMINA, `${ref}!A1`, values);
  return { hoja, conductores: r.filas.length, total: r.totales.total };
}

// Recalcula un mes YA generado con (opcionalmente) un config nuevo, SIN volver a Bolt:
// lee el snapshot de datos crudos y reaplica las fórmulas. En vivo y barato.
async function recalcular(mes, ano, config) {
  if (config) await guardarConfig(config);
  const r = await generar(mes, ano, { actualizar: false });
  _estado = { generando: false, mes, ano, fase: 'Recalculado', error: null, resultado: r };
  return r;
}

async function existeCongelada(mes, ano) {
  const filas = await readSheet(LIBRO_NOMINA, `'${hojaNomina(mes, ano)}'!A1:A3`).catch(() => []);
  return !!(filas && filas.length);
}

// ---- Lee una nómina ya congelada (sin recalcular ni tocar Bolt).
//      Lee POR CABECERA, no por posición: así funciona aunque la hoja tenga un formato
//      distinto (p. ej. una congelada antes de existir la columna "Tipo"). ----
async function leerCongelada(mes, ano) {
  const filas = await readSheet(LIBRO_NOMINA, `'${hojaNomina(mes, ano)}'!A1:Z2000`).catch(() => []);
  if (!filas || filas.length < 3) return null;

  const cab = filas[1] || [];   // fila 0 = título, fila 1 = cabeceras
  const col = (...nombres) => {
    for (const n of nombres) {
      const i = cab.findIndex(c => (c || '').toString().trim().toLowerCase() === n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const iN = col('Nombre del conductor', 'Nombre', 'Conductor'), iDni = col('DNI/NIE', 'DNI'),
    iTipo = col('Tipo'), iJorn = col('Jornada'), iDesde = col('Desde día', 'Desde'), iHoras = col('Horas'),
    iProp = col('Propinas (€)', 'Propinas'), iPeaje = col('Peajes (€)', 'Peajes'),
    iNoc = col('Nocturnas (€)', 'Nocturnas'), iFas = col('MBO FAS (€)', 'MBO FAS'),
    iComp = col('Compensación (€)', 'Compensación'), iDias = col('Días extra', 'Días ext.'),
    iUtil = col('%Utilización', '%Util'), iTot = col('TOTAL (€)', 'TOTAL');
  if (iN < 0 || iTot < 0) return null;   // no parece una hoja de nómina
  const g = (f, i) => (i >= 0 ? f[i] : undefined);

  const labelKey = {}; CONFIG_CAMPOS.forEach(c => { labelKey[c.label] = c.key; });
  const cfg = {};
  const datos = [];
  let enDatos = true;
  for (let i = 2; i < filas.length; i++) {
    const f = filas[i] || [];
    const primera = (f[0] || '').toString().trim();
    if (enDatos) {
      if (!primera) continue;
      if (primera.includes('TOTAL') || primera.includes('⚙️') || primera.includes('Config')) { enDatos = false; continue; }
      datos.push({
        nombre: g(f, iN), dni: g(f, iDni) || '',
        ett: (g(f, iTipo) || '').toString().trim().toUpperCase() === 'ETT', contrato: '',
        jornada: num(g(f, iJorn)) || null,
        primerDia: num(g(f, iDesde)), horas: num(g(f, iHoras)),
        propinas: num(g(f, iProp)), peajes: num(g(f, iPeaje)), nocturnas: num(g(f, iNoc)), mboFAS: num(g(f, iFas)),
        compensacion: num(g(f, iComp)), diasExtra: num(g(f, iDias)),
        utilPct: g(f, iUtil) === '' || g(f, iUtil) == null ? null : num(g(f, iUtil)), total: num(g(f, iTot))
      });
    } else if (labelKey[primera] !== undefined) {   // pie: "Config usada al congelar"
      const v = parseFloat(String(f[1]).replace(',', '.'));
      if (!isNaN(v)) cfg[labelKey[primera]] = v;
    }
  }
  const totales = datos.reduce((t, f) => {
    ['propinas', 'peajes', 'nocturnas', 'mboFAS', 'compensacion', 'diasExtra', 'total'].forEach(k => t[k] += f[k] || 0);
    return t;
  }, { propinas: 0, peajes: 0, nocturnas: 0, mboFAS: 0, compensacion: 0, diasExtra: 0, total: 0 });
  Object.keys(totales).forEach(k => totales[k] = r2(totales[k]));
  const config = Object.keys(cfg).length ? { ...DEFAULTS, ...cfg } : await leerConfig();
  const { mes: mesD, ano: anoD } = mesVencido(mes, ano);
  return {
    mes, ano, mesNombre: MESES_NOM[mes - 1],
    mesDatos: mesD, anoDatos: anoD, mesDatosNombre: MESES_NOM[mesD - 1],
    filas: datos, totales, config, congelada: true, avisos: {}
  };
}

// ---- Carga para la vista SIN Bolt: congelada > snapshot recalculado > nada ----
async function cargar(mes, ano) {
  const cong = await leerCongelada(mes, ano);
  if (cong) return { fuente: 'congelada', resultado: cong };
  const snap = await leerSnapshot(mes, ano);
  if (snap) return { fuente: 'datos', resultado: await generar(mes, ano, { actualizar: false }) };
  return { fuente: 'nada', resultado: null };
}

module.exports = {
  DEFAULTS, CONFIG_CAMPOS, MESES_NOM, hojaMes, hojaNomina, hojaDatos, LIBRO_NOMINA,
  leerConfig, guardarConfig, recalcular, cargar,
  generar, generarEnFondo, estado, congelar, leerCongelada, existeCongelada, leerSnapshot,
  // Expuestos para poder probar el parseo de fechas y la ubicación del alta.
  _parseAlta: parseAlta, _situarAlta: situarAlta
};
