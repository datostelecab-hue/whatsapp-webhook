// ============================================================
// NÓMINAS · SERVICIO — la compensación variable del mes
// ============================================================
// Replica el cálculo que RRHH hacía en Excel + AppScript. Las FÓRMULAS son las
// mismas que llevaban meses cuadrando; lo que ha cambiado es de dónde salen los
// datos: antes de Google Sheets y de la API de BOLT, ahora de PostgreSQL.
//
// ── LAS DOS REGLAS QUE HAY QUE SABER ────────────────────────────────────────
//
// 1. A MES VENCIDO. La nómina de un mes se calcula con los datos del mes
//    ANTERIOR: la de julio paga el trabajo de junio; la de enero, el de
//    diciembre del año pasado. El mes que se elige en la pantalla es el del
//    PAGO.
//
// 2. EL PRORRATEO ARRANCA EN LA FECHA DE ALTA, no en el primer día con horas:
//      · alta ANTES del mes de trabajo  → mes completo, sin prorratear. Un
//        veterano que libró la primera quincena ya no ve su objetivo partido por
//        la mitad (con el criterio viejo le bastaba media jornada para "hacer
//        extras").
//      · alta DENTRO del mes            → se prorratea desde su día de alta.
//      · alta DESPUÉS del mes           → no entra en esa nómina.
//      · sin fecha                      → se conserva el criterio viejo (primer
//        día con horas) y se marca en el panel, para que nadie se quede sin
//        cobrar por un dato vacío.
//    En las hojas la fecha venía de la columna G de AGENDA_V2 y faltaba a
//    menudo; en PostgreSQL la tiene el 100 % de la plantilla, así que el cuarto
//    caso ya casi no se da.
//
// ── LO QUE SE GUARDA ────────────────────────────────────────────────────────
// Solo el resultado CONGELADO. No hay "snapshot de datos crudos" como en las
// hojas: allí hacía falta porque volver a bajar de BOLT tardaba minutos, aquí
// recalcular es una consulta. Una nómina congelada ya no se recalcula nunca:
// guarda sus números y la config con la que se hicieron.

const repo = require('./nominas.repo');

// Parámetros de nómina EDITABLES (las celdas B2:B8 del Excel de RRHH). Estos son
// los valores verificados contra junio; se cambian desde el panel y lo que se
// guarde en `nomina_config` manda sobre ellos.
const DEFAULTS = {
  // Sueldo base y umbral FAS son DISTINTOS por jornada (40h vs 32h). Los de 32h
  // arrancan igual que los de 40h para no cambiar nada hasta poner los reales.
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
  factorNoc: 0.1,       // multiplicador de nocturnas (€hora × horas × 0.1)
};

// Orden y etiquetas para el panel. `usado` = si afecta al total (el resto son informativos).
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
  { key: 'factorNoc', label: 'Factor nocturnas', usado: true },
];

const MESES_NOM = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const r2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, '0');

/** El mes de TRABAJO de una nómina: el anterior al del pago. */
const mesVencido = (mes, ano) => (mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano });

// ── Config ──────────────────────────────────────────────────────────────────

/** Los defaults con lo guardado encima. Sin caché: es una consulta. */
async function leerConfig() {
  return { ...DEFAULTS, ...(await repo.leerConfig()) };
}

/** Guarda solo las claves conocidas y numéricas. Devuelve la config final. */
async function guardarConfig(nuevos = {}, usuarioId) {
  const limpios = {};
  Object.keys(nuevos).forEach(k => {
    if (!(k in DEFAULTS)) return;
    const v = parseFloat(String(nuevos[k]).replace(',', '.'));
    if (!isNaN(v)) limpios[k] = v;
  });
  await repo.guardarConfig(limpios, usuarioId);
  return leerConfig();
}

// ── El arranque del prorrateo ───────────────────────────────────────────────

/**
 * Sitúa el alta respecto al mes de TRABAJO:
 *   'antes'    ya estaba de alta → mes completo
 *   'dentro'   entró ese mes     → prorratea desde su día
 *   'despues'  entró más tarde   → fuera de esta nómina
 *   null       sin fecha usable  → se decide con el criterio viejo
 */
function situarAlta(altaIso, mesTrabajo, anoTrabajo) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(altaIso || ''));
  if (!m) return { donde: null, dia: 0 };
  const a = Number(m[1]), mes = Number(m[2]), d = Number(m[3]);
  if (a < anoTrabajo || (a === anoTrabajo && mes < mesTrabajo)) return { donde: 'antes', dia: d };
  if (a === anoTrabajo && mes === mesTrabajo) return { donde: 'dentro', dia: d };
  return { donde: 'despues', dia: d };
}

/**
 * Jornada en horas para elegir umbral FAS y sueldo base. 40 si no consta: es la
 * jornada de la inmensa mayoría y dejar el umbral bajo por un dato vacío
 * regalaría MBO FAS que no toca.
 */
const jornadaDe = h => (Number(h) === 32 ? 32 : 40);

// ── El cálculo de UNA persona ───────────────────────────────────────────────
// Es la cadena del .gs, intacta. Si algo de aquí cambia, cambia lo que cobra
// la gente: no se toca sin rehacer la comprobación contra un mes ya pagado.
function calcularFila(c, diasDelMes, cfg, mesTrabajo, anoTrabajo) {
  const util = (c.utilPct != null ? c.utilPct : 0) / 100;          // 0..1

  // Día desde el que cuenta el mes para esta persona.
  const { donde, dia } = situarAlta(c.alta, mesTrabajo, anoTrabajo);
  let arranque, origen;
  if (donde === 'antes')       { arranque = 1;   origen = 'alta-anterior'; }
  else if (donde === 'dentro') { arranque = dia; origen = 'alta-en-mes'; }
  else                         { arranque = c.primerDia || 1; origen = 'primer-log'; }

  const primerDia = Math.min(Math.max(arranque, 1), diasDelMes);
  const diasDesde = diasDelMes - primerDia + 1;                    // del arranque a fin de mes
  const diasOperTgt = r2((diasDesde / diasDelMes) * cfg.diasObjetivo);
  const hsTgt = diasOperTgt * cfg.horasMetaDia;
  const delta = c.horas - hsTgt;

  const jornada = jornadaDe(c.jornada);
  const umbral = jornada === 32 ? cfg.umbralFAS32 : cfg.umbralFAS40;
  const mboHsExt = delta > 0 ? (delta * cfg.eurHoraExtra) * util : 0;   // € extra × utilización
  const eurNoc = cfg.eurHoraNoc * c.nocturnasH * cfg.factorNoc;
  const mboFAS = c.neto > umbral ? (c.neto - umbral) * cfg.pctMBOFAS : 0;
  const totalMBO = Math.max(mboHsExt, mboFAS);                     // gana el mayor de los dos MBO
  const compensacion = mboHsExt > mboFAS ? mboHsExt : 0;          // informativo: cuánto puso el MBO de horas
  const diasExtra = delta > cfg.horasMetaDia ? delta / cfg.horasMetaDia : 0;
  const total = eurNoc + c.peajes + c.propinas + totalMBO;

  return {
    conductorId: c.conductorId,
    nombre: c.nombre,
    dni: c.dni || '',
    ett: !!c.ett,
    jornada,
    primerDia,
    alta: c.alta || '',
    origenArranque: origen,      // alta-anterior | alta-en-mes | primer-log
    horas: r2(c.horas),
    horasObjetivo: r2(hsTgt),
    deltaHoras: r2(delta),
    utilPct: c.utilPct != null ? r2(c.utilPct) : null,
    propinas: r2(c.propinas),
    peajes: r2(c.peajes),
    nocturnas: r2(eurNoc),
    mboFAS: r2(mboFAS),
    mboHsExt: r2(mboHsExt),
    compensacion: r2(compensacion),
    diasExtra: r2(diasExtra),
    total: r2(total),
  };
}

// ── El mes entero ───────────────────────────────────────────────────────────

/**
 * Calcula la nómina de un mes (el de PAGO) sin escribir nada.
 *
 * Las cuatro consultas van en paralelo: son independientes y la de las horas es
 * la que manda en el tiempo total.
 */
async function calcular(mesNom, anoNom, opciones = {}) {
  const cfg = opciones.config || await leerConfig();
  const { mes: mesD, ano: anoD } = mesVencido(mesNom, anoNom);
  const diasDelMes = new Date(anoD, mesD, 0).getDate();          // días del mes de TRABAJO
  const desde = `${anoD}-${pad(mesD)}-01`;
  const hasta = `${anoD}-${pad(mesD)}-${pad(diasDelMes)}`;

  const [horas, dinero, fichas] = await Promise.all([
    repo.horasDelMes(desde, hasta),
    repo.dineroDelMes(desde, hasta),
    repo.fichasDelMes(hasta),
  ]);

  // Entra quien TRABAJÓ ese mes. El dinero sin horas no hace nómina variable:
  // son pedidos de alguien que ya no aparece en los tramos (una cuenta sin
  // enlazar), y meterlo daría un objetivo de horas contra cero horas hechas.
  const gente = [];
  horas.forEach((h, cid) => {
    const f = fichas.get(cid) || {};
    const d = dinero.get(cid) || { neto: 0, propinas: 0, peajes: 0 };
    const efectivos = h.viajeSeg + h.esperaSeg;
    gente.push({
      conductorId: cid,
      nombre: f.nombre || `#${cid}`,
      dni: f.dni || '',
      ett: !!f.ett,
      jornada: f.jornada,
      alta: f.alta || '',
      primerDia: h.primerDia,
      horas: h.horasSeg / 3600,
      nocturnasH: h.nocSeg / 3600,
      utilPct: efectivos > 0 ? (h.viajeSeg / efectivos) * 100 : null,
      neto: d.neto, propinas: d.propinas, peajes: d.peajes,
    });
  });

  // Quien entró DESPUÉS del mes de trabajo (p. ej. alta en julio para la nómina
  // que paga junio) no pinta nada aquí; si tiene horas es que la fecha está mal
  // puesta, así que se lista aparte en vez de callarlo.
  const fuera = [];
  const dentro = gente.filter(c => {
    if (situarAlta(c.alta, mesD, anoD).donde !== 'despues') return true;
    fuera.push({ nombre: c.nombre, alta: c.alta, horas: r2(c.horas) });
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
  Object.keys(totales).forEach(k => { totales[k] = r2(totales[k]); });

  // ¿El mes de trabajo aún no terminó? → datos incompletos (aún no toca esa nómina).
  const hoy = new Date();
  const trabajoIncompleto = anoD > hoy.getFullYear() ||
    (anoD === hoy.getFullYear() && mesD >= hoy.getMonth() + 1);

  // Quién trabajó pero no está sellado en la bitácora: ahí los dos números se
  // separan y conviene decirlo antes de que alguien compare las pantallas.
  const sinSellar = await repo.sinSellarEnBitacora(desde, hasta, filas.map(f => f.conductorId).filter(Boolean));

  return {
    mes: mesNom, ano: anoNom, mesNombre: MESES_NOM[mesNom - 1], diasDelMes,
    mesDatos: mesD, anoDatos: anoD, mesDatosNombre: MESES_NOM[mesD - 1],
    desde, hasta,
    filas, totales, config: cfg,
    congelada: false,
    avisos: {
      sinDni: filas.filter(f => !f.dni).length,
      sinDinero: filas.length > 0 && filas.every(f => !f.propinas && !f.peajes && !f.mboFAS),
      trabajoIncompleto,
      // Sin fecha de alta: cobran con el criterio viejo, pero conviene rellenarla.
      sinAlta: filas.filter(f => f.origenArranque === 'primer-log').length,
      // Altas dentro del mes de trabajo: son los únicos con el objetivo prorrateado.
      altaEnMes: filas.filter(f => f.origenArranque === 'alta-en-mes').length,
      // Con horas pero alta POSTERIOR al mes: fuera de esta nómina (revisar la fecha).
      excluidos: fuera,
      sinSellar,
    },
  };
}

/**
 * Lo que la pantalla enseña al abrir un mes: la congelada si existe, y si no el
 * cálculo en vivo. Es una sola puerta para que la vista no tenga que decidir.
 */
async function cargar(mes, ano) {
  const cong = await repo.leerCongelada(mes, ano);
  if (cong) {
    cong.mesNombre = MESES_NOM[cong.mes - 1];
    cong.mesDatosNombre = MESES_NOM[cong.mesDatos - 1];
    return { fuente: 'congelada', resultado: cong };
  }
  return { fuente: 'calculada', resultado: await calcular(mes, ano) };
}

/** Congela el mes con la config actual. Una nómina congelada ya no se recalcula. */
async function congelar(mes, ano, usuarioId) {
  const r = await calcular(mes, ano);
  if (!r.filas.length) throw new Error('No hay nadie con horas en el mes de trabajo: no hay nada que congelar');
  return repo.congelar(r, usuarioId);
}

const descongelar = (mes, ano) => repo.descongelar(mes, ano);
const mesesCongelados = () => repo.mesesCongelados();

module.exports = {
  DEFAULTS, CONFIG_CAMPOS, MESES_NOM,
  leerConfig, guardarConfig,
  calcular, cargar, congelar, descongelar, mesesCongelados,
  leerCongelada: (mes, ano) => repo.leerCongelada(mes, ano),
  // Expuestos para poder probar el prorrateo y el cálculo sin base de datos.
  _situarAlta: situarAlta, _calcularFila: calcularFila, _mesVencido: mesVencido,
};
