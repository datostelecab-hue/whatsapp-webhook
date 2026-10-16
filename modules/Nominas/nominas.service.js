// ============================================================
// NÓMINAS · SERVICIO — la compensación variable del mes
// ============================================================
// Replica el cálculo que RRHH hacía en Excel + AppScript. Las FÓRMULAS son las
// mismas que llevaban meses cuadrando; lo que ha cambiado es de dónde salen los
// datos: antes de Google Sheets y de la API de BOLT, ahora de PostgreSQL.
//
// ── LAS SEIS REGLAS QUE HAY QUE SABER ────────────────────────────────────────
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
// 3. LAS J CUENTAN, CADA UNA CON SUS HORAS. Un dia con justificante aprobado
//    (coche en taller, cuenta suspendida, medico) no es un dia sin trabajar:
//    es un dia que alguien dio por bueno. La nomina lo separa en dos cifras
//    que es justo lo que RRHH pregunta —cuanto de lo que falta esta explicado
//    y cuanto no—:
//
//      HORAS JUSTIFICADAS     lo que cubren las J aprobadas
//      HORAS NO JUSTIFICADAS  lo que sigue faltando para el objetivo despues
//                             de sumar las horas de BOLT y las justificadas
//
//    Una J vale LAS HORAS QUE SE LE PUSIERON al justificarla, y se SUMAN a las
//    de BOLT de ese dia: es el estandar de la bitacora, de la letra y del
//    reporte de horas, y la nomina cuenta igual que ellos. Una J aprobada sin
//    horas no suma nada (se avisa en el panel).
//
//    Hasta el 16/10/2026 toda J valia la jornada entera (8 h) topada por lo
//    que faltara de ese dia, porque las horas de la tabla eran un "8" puesto a
//    ojo: de las 182 J aprobadas de agosto, 114 traian 8. Camilo: «las J ya
//    tienen valor propio, no todas valen 8, eso era antes cuando el sistema
//    apenas estaba naciendo». En septiembre la media ya es de 5,2 h y en
//    octubre de 3,8.
//
//    LAS J CUENTAN TAMBIEN PARA EL EXCESO. La diferencia contra el objetivo se
//    mide con las justificadas dentro: un dia justificado no le resta a nadie
//    sus horas extra.
//
// 4. LA HORA EXTRA SE PAGA POR CONDUCIR, NO POR ESTAR CONECTADO. Las horas
//    efectivas son viaje + espera, asi que quien pasa el mes con la app abierta
//    y poca carrera acumula horas igual que quien no para. El caso que lo
//    destapo: 211,4 h en el mes y 35,4 de exceso sobre el objetivo... con un
//    52,7 % de utilizacion. De sus 211 horas, 100 fueron espera.
//
//    DOS LISTONES (16/10/2026, «mucho más estricto»):
//      · quien llega al 75 % de utilizacion (`utilUmbral`) no pierde nada;
//      · a quien NO llega se le exige el 85 % (`utilExigida`): se le quitan
//        horas DE ESPERA —nunca de viaje— hasta dejarlo exactamente en el 85.
//    Hasta entonces habia un solo liston del 65 %, y quien no llegaba se
//    quedaba en el 65. Ahora quedarse corto sale mas caro a proposito: el
//    74 % no se lleva al 75, se lleva al 85.
//
//      utilizacion = viaje / (viaje + espera)
//      X = (viaje + espera) - viaje / exigida          (solo si utilizacion < umbral)
//
//    Dos propiedades que la hacen segura:
//      · X nunca pasa de la espera que esa persona tiene, porque X <= espera
//        equivale a viaje <= viaje / exigida, cierto siempre que la exigida
//        sea menor que 1. No se le puede quitar viaje a nadie.
//      · Despues del recorte quedan EXACTAMENTE en la exigida.
//
//    La cifra retirada se ensena en su columna: a quien le baja la nomina por
//    esto merece ver cuantas horas se le han quitado, no un "sale asi".
//
// 5. EL MES ES EL MES: DEL DIA 1 A LAS 00:00 AL ULTIMO A LAS 23:59. Sin
//    cortes raros y sin la jornada operativa 05->05 del resto del ERP.
//
//    La bitacora y el reporte de horas miden por JORNADA (05:00 a 05:00), que
//    es lo correcto para control de TURNOS: quieren ver la noche entera junta.
//    Una nomina no es eso: paga lo que paso EN EL MES. Quien rueda la madrugada
//    del 1 de septiembre cobra esas horas en septiembre, aunque para la bitacora
//    sean del turno del 31 de agosto.
//
//    Igual con las J: una J del 1 de septiembre cubre ese dia natural entero,
//    de 00:00 a 23:59.
//
//    Y asi horas, dinero y J miran la MISMA ventana. Cuando las horas se
//    cortaban a las 05:00 y el dinero a medianoche (que es como agrupa
//    v_ordenes_conductor) las dos mitades del calculo no cuadraban en el borde
//    del mes, y a dos personas eso les cambiaba si pasaban o no el umbral FAS.
//
//    CONSECUENCIA ESPERADA: las horas de la nomina no coinciden con las de la
//    bitacora para quien trabaja de noche. No es un fallo: son dos preguntas
//    distintas y cada una tiene su ventana.
//
// 6. EL MBO ES SOLO DE PLANTILLA PROPIA. A quien viene por ETT lo contrata la
//    agencia y es ella quien le paga: nosotros no le debemos horas extra ni
//    participacion en la facturacion. Asi que a las filas de ETT se les pone a
//    CERO todo el MBO —el de horas extra y el FAS— y con el los dias extra,
//    que es la misma idea contada en dias.
//
//    Pero SI entran en la nomina, y con sus variables: nocturnidad, propinas y
//    peajes son suyas se las pague quien se las pague, y la ETT necesita el
//    numero para pagarselas. De ahi el Excel aparte (`/nominas/ett.xlsx`), que
//    lleva justo eso: horas trabajadas (rodadas + justificadas), nocturnidad EN
//    HORAS, propinas y peajes.
//
//    OJO CON EL MES DE ESE EXCEL: va por mes TRABAJADO, no a mes vencido. Se
//    elige agosto y salen los datos de agosto. La nomina va a mes vencido
//    porque es un pago; el fichero de la ETT es un parte de trabajo.
//
//    Las horas, el objetivo y la diferencia SI se calculan para la ETT: son
//    una medida, no un pago. Lo que se pone a cero es todo lo que se cobra.
//
//    Y NO SALEN EN LA NOMINA (16/10/2026, Camilo: «No necesito ver en ese
//    listado a los de la ETT ya que lo descargo por el excel»). `calcular`
//    los calcula con todos los demas —el parte sale de esas mismas filas— pero
//    los devuelve aparte, en `filasETT`: la lista, los totales, el Excel de la
//    nomina y lo que se congela son solo de plantilla propia, que es lo que
//    se paga por nomina.
//
// 7. LAS VACACIONES Y LOS PERMISOS CUENTAN PARA EL OBJETIVO (16/10/2026).
//    Camilo: «las vacaciones cuentan, pero como día natural porque coge también
//    días de libranza y así está bien, entonces cada día de vacaciones se
//    calculan como el 73 % de 8 horas para hacer la regla de 3 y así les suba
//    las horas para alcanzar el target». Cada día de vacaciones suma
//    8 × 0,73 = 5,84 h, y cada día de PERMISO RETRIBUIDO 8 h enteras. Entran en
//    la diferencia igual que las J. Salen de los tramos de estado del conductor
//    (los de Vacaciones); la suspensión, el permiso sin sueldo y la baja médica
//    no suman.
//
// 8. LA NÓMINA BASE (16/10/2026). La nómina de un mes = SALARIO BASE BRUTO +
//    las variables de este fichero. La base va A MES CORRIENTE y con CORTE EL 26:
//    la de octubre, del 26 de septiembre al 25 de octubre; las variables siguen
//    a mes vencido (la de octubre, septiembre del 1 al 30). Mientras el periodo
//    no ha cerrado, va hasta AYER.
//
//      horas base = viaje + espera − espera quitada (el mismo recorte 75/85)
//                   + horas de las J + vacaciones × 5,84 + permisos × 8
//      importe    = horas base × € hora base (8,16)
//      BASE BRUTA = el importe, con TOPE en el salario base de su jornada
//                   (40 h → 1.443 €, 32 h → 1.154 €; otra, por regla de tres),
//                   prorrateado por los días de contrato del periodo
//
//    Camilo: «si se pasa de ahí significa que tiene su salario base asegurado,
//    lo que se pasó se paga en las variables de MBO o FAS o de horas. Si no
//    llegan significa que, a parte de que se va a descontar de una vez, solo
//    tendrán variables de propinas, peajes, etc.». Por eso el tope: la base
//    nunca paga horas de más, eso es cosa del MBO.
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
  // LA NÓMINA BASE (regla 8, 16/10/2026). El sueldo base era informativo; desde
  // ese día es el TOPE de la base de cada jornada.
  eurHoraBase: 8.16,    // € por hora de la base
  sueldoBase40: 1443, sueldoBase32: 1154,   // tope de la base con 40 h y con 32 h (otra jornada, por regla de tres)
  horasMetaDia: 8,      // lo que vale un día de PERMISO retribuido, la base del de vacaciones
                        // y cuántas horas hacen un "día extra". Hasta el 16/10/2026 era
                        // también lo que valía una J; ya no: cada J vale sus horas (regla 3).
  pctDiaVacaciones: 0.73,  // un día de vacaciones vale este tanto de un día (8 × 0,73 = 5,84 h):
                           // cuentan por día NATURAL, libranzas incluidas (regla 7)
  horasMetaMes40: 172,  // EL OBJETIVO DEL MES para una jornada de 40 h. El de
                        // cualquier otra jornada sale de aquí por regla de tres
                        // (32 h → 172 × 32/40 = 137,6), y se prorratea por los
                        // días que esa persona estuvo de alta.
  eurHoraExtra: 7,      // € por hora extra × utilización.
                        // OJO: el .gs traía 9, pero la celda de config real (mayo y junio)
                        // tiene 7 y las fórmulas leían la celda → el valor REAL usado fue 7.
                        // Verificado reproduciendo junio: con 7 cuadra 164/164 al céntimo.
  // Los dos listones de utilización (regla 4, 16/10/2026). Sustituyen a
  // `utilMinima` (0,65) y a `lUtilizacion` (0,75, que era informativo).
  utilUmbral: 0.75,     // USADO — quien llega a esta utilización no pierde ninguna hora
  utilExigida: 0.85,    // USADO — a quien no llega se le exige esta: se le retiran horas
                        // de ESPERA hasta dejarlo exactamente aquí
  umbralFAS40: 4750, umbralFAS32: 4750,     // USADO — a partir de este neto hay MBO FAS, según jornada
  pctMBOFAS: 0.4,       // fracción del exceso de facturación sobre el umbral
  eurHoraNoc: 9.9,      // € hora nocturna (9,9 desde el 16/10/2026; antes 8,16)
  factorNoc: 0.1,       // multiplicador de nocturnas (€hora × horas × 0.1 = 0,99 € la hora)

  // ── LO QUE SE LE FACTURA A LA ETT ──────────────────────────────────────
  // Nada de esto entra en la nómina: son los dos precios del PARTE que se le
  // manda a la agencia, y por eso viven aquí y no en el código. Los de arriba
  // dicen lo que cobra un conductor nuestro; estos, lo que cuesta uno suyo.
  ettEurHora: 15.2,       // € por hora trabajada
  ettPlusNocturno: 1.31,  // € POR HORA nocturna (no es un porcentaje)
};

// Orden y etiquetas para el panel. `usado` = si afecta al total (el resto son informativos).
const CONFIG_CAMPOS = [
  { key: 'eurHoraBase', label: '€ hora base (nómina base)', usado: true },
  { key: 'sueldoBase40', label: 'Tope del salario base, 40 h (€)', usado: true },
  { key: 'sueldoBase32', label: 'Tope del salario base, 32 h (€)', usado: true },
  { key: 'horasMetaDia', label: 'Horas de un día de permiso retribuido', usado: true },
  { key: 'pctDiaVacaciones', label: 'Día de vacaciones: lo que vale de un día (0.73 = 73 %)', usado: true },
  { key: 'horasMetaMes40', label: 'Objetivo del mes con jornada de 40 h', usado: true },
  { key: 'eurHoraExtra', label: '€ por hora extra', usado: true },
  { key: 'utilUmbral', label: 'Utilización con la que no se quitan horas (0.75 = 75 %)', usado: true },
  { key: 'utilExigida', label: 'Utilización exigida a quien no llega (0.85 = 85 %)', usado: true },
  { key: 'umbralFAS40', label: 'Umbral FAS 40h (€)', usado: true },
  { key: 'umbralFAS32', label: 'Umbral FAS 32h (€)', usado: true },
  { key: 'pctMBOFAS', label: '% MBO FAS (fracción, 0.4 = 40%)', usado: true },
  { key: 'eurHoraNoc', label: '€ hora nocturna', usado: true },
  { key: 'factorNoc', label: 'Factor nocturnas', usado: true },
  { key: 'ettEurHora', label: 'ETT · € por hora trabajada', usado: false },
  { key: 'ettPlusNocturno', label: 'ETT · € por hora nocturna (plus)', usado: false },
];

const MESES_NOM = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const r2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, '0');

/** El mes de TRABAJO de una nómina: el anterior al del pago. */
const mesVencido = (mes, ano) => (mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano });

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * Los defaults con lo guardado encima. Sin caché: es una consulta.
 *
 * Solo las claves que existen hoy: en `nomina_config` siguen guardadas algunas
 * retiradas (`diasObjetivo`, `utilMinima`, `lUtilizacion`), y colarlas en la
 * config haría que una nómina congelada dijera que se calculó con ellas.
 */
async function leerConfig() {
  const guardado = await repo.leerConfig();
  const vivas = Object.fromEntries(Object.entries(guardado).filter(([k]) => k in DEFAULTS));
  return { ...DEFAULTS, ...vivas };
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
 * Jornada en horas. Manda en tres sitios: el objetivo del mes, el umbral FAS y
 * el sueldo base.
 *
 * 40 si no consta, y no es pereza: es la jornada de la inmensa mayoría, y
 * suponer menos le bajaría el objetivo a alguien por un dato vacío —le
 * regalaría horas extra— además de dejarle el umbral FAS bajo.
 */
// La jornada del contrato, si la sabemos. Antes esto aplastaba TODO a 32 o 40
// porque era lo unico que habia en la base; desde que la relacion de contratos
// de la ETT trajo jornadas de 18, 21, 24, 27 y 29 horas, aplastarlas le pondria
// a un contrato de 20 h el objetivo de uno de 40 —172 h— y su "diferencia de
// horas" seria mentira.
//
// Sin jornada escrita se sigue suponiendo 40: es lo que se hacia y lo que
// llevan casi todos.
const jornadaDe = h => {
  const n = Number(h);
  return Number.isFinite(n) && n >= 1 && n <= 40 ? n : 40;
};

/**
 * El objetivo del mes de esa jornada, por regla de tres sobre el de 40 h.
 *   40 h → 172      32 h → 172 × 32/40 = 137,6
 */
const objetivoDe = (jornada, cfg) => cfg.horasMetaMes40 * (jornada / 40);

/**
 * LAS HORAS DE ESPERA QUE SE QUITAN por utilización (regla 4). Quien llega al
 * umbral (75 %) no pierde nada; a quien no llega se le retiran horas de ESPERA
 * hasta dejarlo en la exigida (85 %). El viaje no se toca nunca, y la propia
 * fórmula lo garantiza: X no puede pasar de la espera que tuvo. La usan las
 * variables (el mes de trabajo) y la base (del 26 al 25), cada una con su
 * periodo.
 */
function esperaQuitada(viajeH, esperaH, horasH, cfg) {
  const viaje = viajeH || 0, espera = esperaH || 0;
  const efectivas = viaje + espera;
  if (!(cfg.utilExigida > 0 && cfg.utilExigida < 1 && efectivas > 0 && viaje < cfg.utilUmbral * efectivas)) return 0;
  // Con el umbral por encima de la exigida (una config al reves) la cuenta
  // saldria negativa: entonces no se quita nada.
  const x = Math.max(0, efectivas - viaje / cfg.utilExigida);
  // Cinturon: `horasH` es el total con los solapes FUNDIDOS y `efectivas` es
  // la suma de los dos por separado, asi que si alguien tiene dos cuentas
  // pisandose en situaciones distintas pueden diferir por unos minutos. El
  // recorte no puede dejar a nadie en negativo.
  return Math.min(x, Math.max(0, espera), horasH || 0);
}

/** Lo que vale un día de vacaciones: 8 × 0,73 = 5,84 h (regla 7). */
const horasDiaVacaciones = cfg => cfg.horasMetaDia * cfg.pctDiaVacaciones;

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

  // El objetivo sale de SU jornada (40 h → 172, 32 h → 137,6) y se prorratea
  // por la parte del mes que estuvo de alta.
  const jornada = jornadaDe(c.jornada);
  const hsTgt = objetivoDe(jornada, cfg) * (diasDesde / diasDelMes);

  // ── Las J ────────────────────────────────────────────────────────────────
  // Solo las de su ventana: una J anterior a su alta no cubre un objetivo que
  // todavia no existia. Cada una vale SUS horas, sumadas a las de BOLT de ese
  // dia, como en la bitacora (regla 3).
  const jus = (c.jDias || []).filter(d => d >= primerDia);
  const horasDeJ = d => ((c.jHoras && c.jHoras.get(d)) || 0) / 3600;
  const horasJustificadas = jus.reduce((a, d) => a + horasDeJ(d), 0);
  const jSinHoras = jus.filter(d => !(horasDeJ(d) > 0)).length;

  // ── El recorte por utilizacion (regla 4) ─────────────────────────────────
  const viaje = c.viajeH || 0, espera = c.esperaH || 0;
  const horasEsperaQuitadas = esperaQuitada(viaje, espera, c.horas, cfg);

  // ── Vacaciones y permisos retribuidos (regla 7) ──────────────────────────
  // Por día natural, y solo los de su ventana: desde el arranque y hasta su baja.
  const enSuVentana = iso => Number(String(iso).slice(8, 10)) >= primerDia && (!c.baja || iso <= c.baja);
  const diasVacaciones = (c.vacDias || []).filter(enSuVentana).length;
  const diasPermiso = (c.permDias || []).filter(enSuVentana).length;
  const horasVacaciones = diasVacaciones * horasDiaVacaciones(cfg);
  const horasPermiso = diasPermiso * cfg.horasMetaDia;

  // LA DIFERENCIA SE MIDE CON LAS J, LAS VACACIONES Y LOS PERMISOS DENTRO. Un
  // dia justificado o de vacaciones cuenta con las horas que se le reconocen,
  // asi que no le resta a nadie sus horas extra.
  const horasComputadas = c.horas - horasEsperaQuitadas + horasJustificadas + horasVacaciones + horasPermiso;
  const delta = horasComputadas - hsTgt;

  // Las dos caras de la misma cifra: lo que sobra es `delta`, y lo que falta es
  // `delta` en negativo. Se guarda aparte porque es la pregunta de RRHH.
  const horasNoJustificadas = Math.max(0, -delta);

  const umbral = jornada === 32 ? cfg.umbralFAS32 : cfg.umbralFAS40;
  const eurNoc = cfg.eurHoraNoc * c.nocturnasH * cfg.factorNoc;

  // EL MBO ES SOLO DE PLANTILLA PROPIA (regla 6). A quien viene por ETT lo
  // contrata la agencia: nosotros no le debemos horas extra ni participación en
  // la facturación. Se pone a cero todo lo que se cobra por eso —los dos MBO y
  // los días extra—; lo que es medida (horas, objetivo, diferencia) se queda.
  const propia = !c.ett;
  const mboHsExt = propia && delta > 0 ? (delta * cfg.eurHoraExtra) * util : 0;   // € extra × utilización
  const mboFAS = propia && c.neto > umbral ? (c.neto - umbral) * cfg.pctMBOFAS : 0;
  const totalMBO = Math.max(mboHsExt, mboFAS);                     // gana el mayor de los dos MBO
  const compensacion = mboHsExt > mboFAS ? mboHsExt : 0;          // informativo: cuánto puso el MBO de horas
  const diasExtra = propia && delta > cfg.horasMetaDia ? delta / cfg.horasMetaDia : 0;

  // Nocturnidad, propinas y peajes son suyas se las pague quien se las pague:
  // esas SÍ las lleva todo el mundo, y son las que la ETT tiene que abonar.
  const total = eurNoc + c.peajes + c.propinas + totalMBO;

  return {
    conductorId: c.conductorId,
    nombre: c.nombre,
    nombreBolt: c.nombreBolt || '',
    nombreSS: c.nombreSS || '',
    nombreSSEnForma: c.nombreSSEnForma !== false,
    dni: c.dni || '',
    ett: !!c.ett,
    jornada,
    primerDia,
    alta: c.alta || '',
    baja: c.baja || '',
    origenArranque: origen,      // alta-anterior | alta-en-mes | primer-log
    horas: r2(c.horas),
    // El reparto de esas horas. No es adorno: es el argumento del recorte, y
    // sin el la agencia solo ve un numero que le resta y no lo puede comprobar.
    horasViaje: r2(viaje),
    horasEspera: r2(espera),
    horasEsperaQuitadas: r2(horasEsperaQuitadas),
    horasJustificadas: r2(horasJustificadas),
    horasNoJustificadas: r2(horasNoJustificadas),
    diasJustificados: jus.length,
    // J aprobadas a las que nadie puso horas: no suman. No se congela; solo
    // alimenta el aviso del panel.
    jSinHoras,
    // Lo que suman para el objetivo las vacaciones y los permisos (regla 7).
    diasVacaciones,
    horasVacaciones: r2(horasVacaciones),
    diasPermiso,
    horasPermiso: r2(horasPermiso),
    horasObjetivo: r2(hsTgt),
    deltaHoras: r2(delta),
    utilPct: c.utilPct != null ? r2(c.utilPct) : null,
    // Las nocturnas van dos veces a propósito: en euros (lo que se paga) y en
    // horas (lo que la ETT necesita para pagarlas ella). Una no se deduce de la
    // otra sin saber la tarifa del mes, y una nómina congelada tiene que
    // poder explicarse sola.
    nocturnasHoras: r2(c.nocturnasH || 0),
    propinas: r2(c.propinas),
    peajes: r2(c.peajes),
    nocturnas: r2(eurNoc),
    // La facturación de la que sale el FAS: la pide el resumen por conductor
    // del Excel para poder decir cuánto facturó, no solo si pasó el umbral.
    neto: r2(c.neto || 0),
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

  const [horas, dinero, fichas, justificantes, ausencias] = await Promise.all([
    repo.horasDelMes(desde, hasta),
    repo.dineroDelMes(desde, hasta),
    repo.fichasDelMes(hasta),
    repo.justificantesDelMes(desde, hasta),
    repo.ausenciasDelPeriodo(desde, hasta),
  ]);

  // Entra quien TRABAJÓ ese mes, y también quien no rodó nada pero tiene J
  // aprobadas o días de vacaciones o de permiso: sin eso, el mes entero de
  // quien estuvo de baja con todo justificado, o de vacaciones, se perdía (ni
  // horas, ni justificadas, ni fila). El dinero sin horas no hace nómina
  // variable: son pedidos de alguien que ya no aparece en los tramos (una
  // cuenta sin enlazar), y meterlo daría un objetivo contra cero horas hechas.
  const ids = new Set(horas.keys());
  justificantes.forEach((j, cid) => { if (j.aprobados.length) ids.add(cid); });
  ausencias.forEach((a, cid) => ids.add(cid));
  const diaDe = iso => Number(String(iso).slice(8, 10));
  const gente = [...ids].map(cid => {
    const h = horas.get(cid);
    const f = fichas.get(cid) || {};
    const d = dinero.get(cid) || { neto: 0, propinas: 0, peajes: 0 };
    const j = justificantes.get(cid) || { aprobados: [], horas: new Map(), pendientes: 0 };
    const a = ausencias.get(cid) || { vacaciones: [], permiso: [] };
    const efectivos = h ? h.viajeSeg + h.esperaSeg : 0;
    return {
      conductorId: cid,
      nombre: f.nombre || `#${cid}`,
      nombreBolt: f.nombreBolt || '',
      nombreSS: f.nombreSS || '',
      nombreSSEnForma: f.nombreSSEnForma !== false,
      dni: f.dni || '',
      ett: !!f.ett,
      jornada: f.jornada,
      alta: f.alta || '',
      baja: f.baja || '',
      // Solo se usa sin fecha de alta (el criterio viejo): el primer día con algo.
      primerDia: h ? h.primerDia : Math.min(...j.aprobados, ...a.vacaciones.map(diaDe), ...a.permiso.map(diaDe)),
      horas: h ? h.horasSeg / 3600 : 0,
      viajeH: h ? h.viajeSeg / 3600 : 0,
      esperaH: h ? h.esperaSeg / 3600 : 0,
      jDias: j.aprobados,
      jHoras: j.horas,
      jPendientes: j.pendientes,
      vacDias: a.vacaciones,
      permDias: a.permiso,
      nocturnasH: h ? h.nocSeg / 3600 : 0,
      utilPct: efectivos > 0 ? (h.viajeSeg / efectivos) * 100 : null,
      neto: d.neto, propinas: d.propinas, peajes: d.peajes,
    };
  });

  // Quien entró DESPUÉS del mes de trabajo (p. ej. alta en julio para la nómina
  // que paga junio) no pinta nada aquí; si tiene horas es que la fecha está mal
  // puesta, así que se lista aparte en vez de callarlo.
  const fuera = [];
  const dentro = gente.filter(c => {
    if (situarAlta(c.alta, mesD, anoD).donde !== 'despues') return true;
    if (!c.ett) fuera.push({ nombre: c.nombre, alta: c.alta, horas: r2(c.horas) });
    return false;
  });

  const todas = dentro
    .map(c => calcularFila(c, diasDelMes, cfg, mesD, anoD))
    .sort((a, b) => b.total - a.total);
  // La ETT se calcula con todos —su parte sale de estas mismas filas— pero va
  // aparte: la nómina, sus totales, su Excel y lo que se congela son solo de
  // plantilla propia (regla 6).
  const filas = todas.filter(f => !f.ett);
  const filasETT = todas.filter(f => f.ett);

  const totales = filas.reduce((t, f) => {
    t.propinas += f.propinas; t.peajes += f.peajes; t.nocturnas += f.nocturnas;
    t.mboFAS += f.mboFAS; t.compensacion += f.compensacion;
    t.diasExtra += f.diasExtra; t.total += f.total;
    t.horasJustificadas += f.horasJustificadas; t.horasNoJustificadas += f.horasNoJustificadas;
    t.horasEsperaQuitadas += f.horasEsperaQuitadas;
    t.horasVacaciones += f.horasVacaciones; t.horasPermiso += f.horasPermiso;
    return t;
  }, { propinas: 0, peajes: 0, nocturnas: 0, mboFAS: 0, compensacion: 0, diasExtra: 0, total: 0,
       horasJustificadas: 0, horasNoJustificadas: 0, horasEsperaQuitadas: 0, horasVacaciones: 0, horasPermiso: 0 });
  Object.keys(totales).forEach(k => { totales[k] = r2(totales[k]); });

  // ¿El mes de trabajo aún no terminó? → datos incompletos (aún no toca esa nómina).
  const hoy = new Date();
  const trabajoIncompleto = anoD > hoy.getFullYear() ||
    (anoD === hoy.getFullYear() && mesD >= hoy.getMonth() + 1);

  // Quién trabajó pero no está sellado en la bitácora: ahí los dos números se
  // separan y conviene decirlo antes de que alguien compare las pantallas.
  // Solo se pregunta por quien RODO. A quien tiene el mes entero justificado y
  // cero horas de BOLT la bitacora tampoco lo tiene, y con razon: no trabajo.
  // Meterlo aqui seria acusarla de perder a alguien que nunca estuvo.
  const sinSellar = await repo.sinSellarEnBitacora(desde, hasta,
    filas.filter(f => f.conductorId && f.horas > 0).map(f => f.conductorId));

  return {
    mes: mesNom, ano: anoNom, mesNombre: MESES_NOM[mesNom - 1], diasDelMes,
    mesDatos: mesD, anoDatos: anoD, mesDatosNombre: MESES_NOM[mesD - 1],
    desde, hasta,
    filas, filasETT, totales, config: cfg,
    congelada: false,
    avisos: {
      sinDni: filas.filter(f => !f.dni).length,
      // Sin nombre de BOLT no se puede cruzar esta fila con un informe de la
      // plataforma, que es la mitad de para lo que sirve la columna.
      sinNombreBolt: filas.filter(f => !f.nombreBolt).length,
      // A quien la ficha no le separa apellidos de nombres: su nombre de la
      // seguridad social sale de una pieza, sin la coma. No se parte a ojo.
      sinApellidosSeparados: filas.filter(f => !f.nombreSSEnForma).length,
      // J en la cola: nadie las ha aprobado todavia, asi que NO cuentan. Si se
      // aprueban, las horas justificadas de este mes suben.
      jPendientes: dentro.filter(c => !c.ett).reduce((a, c) => a + (c.jPendientes || 0), 0),
      conJ: filas.filter(f => f.diasJustificados > 0).length,
      // J aprobadas sin horas puestas: no suman nada (regla 3).
      jSinHoras: filas.reduce((a, f) => a + (f.jSinHoras || 0), 0),
      // Con vacaciones o permisos que suman para el objetivo (regla 7).
      conVacaciones: filas.filter(f => f.diasVacaciones > 0).length,
      conPermiso: filas.filter(f => f.diasPermiso > 0).length,
      // Los de ETT, que no salen aquí: van en su parte.
      ett: filasETT.length,
      // A quien no llegaba al umbral de utilizacion y se le ha recortado espera.
      conRecorte: filas.filter(f => f.horasEsperaQuitadas > 0).length,
      // Y, de esos, a quien el recorte le ha quitado las horas extra que tenia.
      recortadosSinExtra: filas.filter(f =>
        f.horasEsperaQuitadas > 0
        && f.horas + f.horasJustificadas + f.horasVacaciones + f.horasPermiso > f.horasObjetivo
        && f.deltaHoras <= 0).length,
      // Quien sigue debiendo horas despues de contarle todo lo justificado.
      conHorasSinJustificar: filas.filter(f => f.horasNoJustificadas > 0).length,
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

// ════════════════════════════════════════════════════════════════════════════
// LA NÓMINA BASE (regla 8, 16/10/2026)
// ════════════════════════════════════════════════════════════════════════════

/** El día en que empieza el periodo de la base: del 26 del mes anterior al 25. */
const DIA_CORTE = 26;

// Fechas AAAA-MM-DD sin zona horaria: se cuentan en UTC a medianoche, así que
// pasar a Date y volver no mueve el día (el fallo de toISOString es leer un
// DATE de PostgreSQL en hora de Madrid, que aquí no se hace).
const msDe = iso => { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const isoDe = ms => new Date(ms).toISOString().slice(0, 10);
const masDias = (iso, n) => isoDe(msDe(iso) + n * 86400000);
const diasEntre = (a, b) => Math.round((msDe(b) - msDe(a)) / 86400000) + 1;   // los dos incluidos

/**
 * El periodo de la base de la nómina de un mes (el de PAGO): del 26 del mes
 * anterior al 25 de ese mes. Mientras no ha cerrado, va hasta AYER (hoy aún no
 * ha terminado).
 */
function ventanaBase(mes, ano, hoyIso) {
  const ant = mesVencido(mes, ano);
  const desde = `${ant.ano}-${pad(ant.mes)}-${pad(DIA_CORTE)}`;
  const cierre = `${ano}-${pad(mes)}-${pad(DIA_CORTE - 1)}`;
  const ayer = masDias(hoyIso, -1);
  const hasta = ayer < cierre ? ayer : cierre;
  return {
    desde, cierre, hasta,
    diasPeriodo: diasEntre(desde, cierre),
    diasHastaAhora: hasta < desde ? 0 : diasEntre(desde, hasta),
    enCurso: hasta < cierre,
    sinEmpezar: hasta < desde,
  };
}

/** El salario base de su jornada, que es el TOPE de la base. 40 y 32 h, de la config; otra, por regla de tres. */
const topeDe = (jornada, cfg) => (jornada === 40 ? cfg.sueldoBase40
  : jornada === 32 ? cfg.sueldoBase32 : cfg.sueldoBase40 * (jornada / 40));

/**
 * La base de UNA persona. Pura: recibe sus horas, sus J, sus vacaciones y
 * permisos del periodo, y su contrato.
 *
 * El tope se prorratea por los días de CONTRATO del periodo entero (del 26 al
 * 25): quien entra el día 10 tiene asegurada la parte de esos días, no el mes.
 * Mientras el periodo está en curso el tope sigue siendo el del periodo entero,
 * así que casi nadie llega: es la base «hasta el momento».
 */
function filaBase(p, cfg, v) {
  const jornada = jornadaDe(p.jornada);
  const ini = p.alta && p.alta > v.desde ? p.alta : v.desde;
  const finContrato = p.baja && p.baja < v.cierre ? p.baja : v.cierre;
  const diasContrato = finContrato >= ini ? diasEntre(ini, finContrato) : 0;
  const finAhora = p.baja && p.baja < v.hasta ? p.baja : v.hasta;
  const dentro = iso => iso >= ini && iso <= finAhora;

  const horasEsperaQuitadas = esperaQuitada(p.viajeH, p.esperaH, p.horas, cfg);
  let horasJustificadas = 0;
  (p.jFechas || new Map()).forEach((seg, iso) => { if (dentro(iso)) horasJustificadas += seg / 3600; });
  const diasVacaciones = (p.vacaciones || []).filter(dentro).length;
  const diasPermiso = (p.permiso || []).filter(dentro).length;
  const horasVacaciones = diasVacaciones * horasDiaVacaciones(cfg);
  const horasPermiso = diasPermiso * cfg.horasMetaDia;
  const horasBase = Math.max(0, (p.horas || 0) - horasEsperaQuitadas + horasJustificadas + horasVacaciones + horasPermiso);

  // Con las horas tal como se enseñan (a dos decimales): quien las multiplique
  // por 8,16 en el Excel tiene que sacar el mismo importe, no uno que difiera
  // en céntimos por los decimales que no ve.
  const importe = r2(horasBase) * cfg.eurHoraBase;
  const tope = diasContrato > 0 ? topeDe(jornada, cfg) * (diasContrato / v.diasPeriodo) : 0;
  const base = Math.min(importe, tope);
  return {
    jornada, diasContrato,
    horas: r2(p.horas || 0), utilPct: p.utilPct == null ? null : r2(p.utilPct),
    horasEsperaQuitadas: r2(horasEsperaQuitadas),
    horasJustificadas: r2(horasJustificadas),
    diasVacaciones, horasVacaciones: r2(horasVacaciones),
    diasPermiso, horasPermiso: r2(horasPermiso),
    horasBase: r2(horasBase),
    importe: r2(importe),
    tope: r2(tope),
    llegaAlTope: diasContrato > 0 && importe >= tope,
    // Lo que pasa del tope no lo paga la base: va a las variables (MBO).
    sobreElTope: r2(Math.max(0, importe - tope)),
    // Lo que le falta para el tope: se le descuenta, sin más.
    faltaParaElTope: r2(Math.max(0, tope - importe)),
    base: r2(base),
  };
}

/**
 * LA NÓMINA BASE de un mes (el de PAGO), y la nómina entera: base + variables.
 *
 * Las variables son las de la pantalla (la congelada si la hay): se pasan en
 * `opciones.variables` para no calcularlas dos veces. Solo plantilla propia.
 * Entra quien tiene contrato en el periodo hasta ahora, y quien tiene
 * variables ese mes aunque ya se haya ido (cobra sus variables con base 0).
 */
async function nominaBase(mes, ano, opciones = {}) {
  const cfg = opciones.config || await leerConfig();
  const v = ventanaBase(mes, ano, opciones.hoy || hoyMadrid());
  const vars = opciones.variables || (await cargar(mes, ano)).resultado;
  const porVar = new Map(((vars && vars.filas) || [])
    .filter(f => !f.ett && f.conductorId).map(f => [Number(f.conductorId), f]));

  const vacio = new Map();
  const [horas, fichas, jus, aus] = await Promise.all([
    v.sinEmpezar ? vacio : repo.horasDelMes(v.desde, v.hasta),
    repo.fichasDelMes(v.sinEmpezar ? v.desde : v.hasta),
    v.sinEmpezar ? vacio : repo.justificantesDelMes(v.desde, v.hasta),
    v.sinEmpezar ? vacio : repo.ausenciasDelPeriodo(v.desde, v.hasta),
  ]);

  const ids = new Set(porVar.keys());
  if (!v.sinEmpezar) {
    fichas.forEach((f, cid) => {
      if (!f.ett && f.alta && f.alta <= v.hasta && (!f.baja || f.baja >= v.desde)) ids.add(cid);
    });
  }

  const filas = [...ids].map(cid => {
    const f = fichas.get(cid) || {};
    const h = horas.get(cid);
    const j = jus.get(cid);
    const a = aus.get(cid) || { vacaciones: [], permiso: [] };
    const efectivos = h ? h.viajeSeg + h.esperaSeg : 0;
    const fv = porVar.get(cid);
    const b = filaBase({
      jornada: f.jornada, alta: f.alta || '', baja: f.baja || '',
      horas: h ? h.horasSeg / 3600 : 0, viajeH: h ? h.viajeSeg / 3600 : 0, esperaH: h ? h.esperaSeg / 3600 : 0,
      utilPct: efectivos > 0 ? (h.viajeSeg / efectivos) * 100 : null,
      jFechas: j ? j.fechas : new Map(), vacaciones: a.vacaciones, permiso: a.permiso,
    }, cfg, v);
    const variables = fv ? Number(fv.total) || 0 : 0;
    return {
      conductorId: cid,
      nombre: f.nombre || (fv && fv.nombre) || `#${cid}`,
      nombreBolt: f.nombreBolt || (fv && fv.nombreBolt) || '',
      nombreSS: f.nombreSS || (fv && fv.nombreSS) || '',
      dni: f.dni || (fv && fv.dni) || '',
      alta: f.alta || '', baja: f.baja || '',
      ...b,
      variables: r2(variables),
      total: r2(b.base + variables),
    };
  }).sort((a, b) => b.total - a.total
      || String(a.nombreSS || a.nombre).localeCompare(String(b.nombreSS || b.nombre), 'es'));

  const suma = k => r2(filas.reduce((t, x) => t + (Number(x[k]) || 0), 0));
  const totales = {};
  ['horas', 'horasEsperaQuitadas', 'horasJustificadas', 'horasVacaciones', 'horasPermiso', 'horasBase',
    'importe', 'tope', 'base', 'sobreElTope', 'faltaParaElTope', 'variables', 'total'].forEach(k => { totales[k] = suma(k); });

  return {
    mes, ano, mesNombre: MESES_NOM[mes - 1],
    ventana: v, config: cfg,
    variablesDe: vars ? { mesNombre: MESES_NOM[vars.mesDatos - 1], ano: vars.anoDatos, congelada: !!vars.congelada } : null,
    filas, totales,
    avisos: {
      enCurso: v.enCurso, sinEmpezar: v.sinEmpezar,
      llegan: filas.filter(x => x.llegaAlTope).length,
      noLlegan: filas.filter(x => x.diasContrato > 0 && !x.llegaAlTope).length,
      soloVariables: filas.filter(x => x.diasContrato === 0).length,
    },
  };
}

/** El mes siguiente. La nomina PAGA en el mes siguiente al que se trabaja. */
const mesSiguiente = (mes, ano) => (mes === 12 ? { mes: 1, ano: ano + 1 } : { mes: mes + 1, ano });

/**
 * Lo que hay que pasarle a la ETT de un mes TRABAJADO.
 *
 * OJO CON EL MES: aqui se elige agosto y salen los datos de agosto. La nomina
 * va a mes vencido —la de septiembre paga agosto— porque es un pago; esto es un
 * parte de trabajo, y un parte de trabajo lleva el mes que dice.
 *
 * Por dentro reutiliza `calcular` del mes de pago correspondiente, para que las
 * cifras sean LAS MISMAS que las de la nomina y no dos cuentas paralelas que
 * algun dia se separen.
 *
 * Solo lleva lo que la ETT tiene que pagar: horas trabajadas (rodadas mas
 * justificadas), nocturnidad EN HORAS, propinas y peajes. Ningun MBO, porque no
 * les corresponde (regla 6).
 */
async function paraETT(mesTrabajo, anoTrabajo) {
  const pago = mesSiguiente(mesTrabajo, anoTrabajo);
  const r = await calcular(pago.mes, pago.ano);
  const cfg = r.config;
  // Solo la baja que cae DENTRO del mes que se pide. Una de hace tres meses no
  // pinta nada en este parte, y una del mes que viene todavia no ha pasado: en
  // el mes del informe esa persona segue trabajando.
  const bajaDelMes = baja => (baja && baja >= r.desde && baja <= r.hasta ? baja : '');

  const filas = (r.filasETT || [])
    .map(f => {
      // LAS HORAS QUE SE LE PAGAN A LA AGENCIA LLEVAN EL RECORTE POR
      // UTILIZACION, igual que las de casa. La hora de espera de quien no llega
      // al minimo no se le paga a un conductor nuestro y tampoco se le factura
      // a la ETT: es la misma hora y vale lo mismo, la cobre quien la cobre.
      const horasTrabajadas = r2(f.horas - f.horasEsperaQuitadas + f.horasJustificadas);
      const importeHoras = r2(horasTrabajadas * cfg.ettEurHora);
      // El plus nocturno es € POR HORA, no un porcentaje: 1,31 € cada hora
      // nocturna. No se parece en nada al de la nomina de casa (€hora x factor)
      // y mezclarlos seria facturar mal.
      const plusNocturno = r2(f.nocturnasHoras * cfg.ettPlusNocturno);
      return {
        ...f,
        horasTrabajadas,
        importeHoras,
        plusNocturno,
        // Lo que la agencia se ahorra por el recorte, en euros. En horas ya lo
        // tiene; en euros es lo que va a mirar.
        importeDescontado: r2(f.horasEsperaQuitadas * cfg.ettEurHora),
        // Lo que cuesta esa persona: sus horas mas su nocturnidad.
        costeTrabajador: r2(importeHoras + plusNocturno),
        bajaEnElMes: bajaDelMes(f.baja),
      };
    })
    .sort((a, b) => b.horasTrabajadas - a.horasTrabajadas);

  const totales = filas.reduce((t, f) => {
    t.horas += f.horas; t.horasJustificadas += f.horasJustificadas;
    t.horasEsperaQuitadas += f.horasEsperaQuitadas;
    t.horasTrabajadas += f.horasTrabajadas; t.nocturnasHoras += f.nocturnasHoras;
    t.importeHoras += f.importeHoras; t.plusNocturno += f.plusNocturno;
    t.importeDescontado += f.importeDescontado;
    t.costeTrabajador += f.costeTrabajador;
    t.propinas += f.propinas; t.peajes += f.peajes;
    return t;
  }, { horas: 0, horasJustificadas: 0, horasEsperaQuitadas: 0, horasTrabajadas: 0,
       nocturnasHoras: 0, importeHoras: 0, plusNocturno: 0, costeTrabajador: 0,
       importeDescontado: 0, propinas: 0, peajes: 0 });
  Object.keys(totales).forEach(k => { totales[k] = r2(totales[k]); });

  return {
    mes: mesTrabajo, ano: anoTrabajo, mesNombre: MESES_NOM[mesTrabajo - 1],
    desde: r.desde, hasta: r.hasta,
    trabajoIncompleto: r.avisos.trabajoIncompleto,
    eurHora: cfg.ettEurHora, plusNocturno: cfg.ettPlusNocturno,
    utilUmbral: cfg.utilUmbral, utilExigida: cfg.utilExigida,
    bajasEnElMes: filas.filter(f => f.bajaEnElMes).length,
    filas, totales,
  };
}

/**
 * Lo que la pantalla enseña al abrir un mes: la congelada si existe, y si no el
 * cálculo en vivo. Es una sola puerta para que la vista no tenga que decidir.
 */
/**
 * LO QUE SE LE DEBE A ALGUIEN QUE SE VA.
 *
 * Cuando alguien causa baja a mitad de mes, su variable queda partida en dos
 * nóminas que aún no se han pagado: la del mes anterior —que se paga el mes de
 * la baja— y la del propio mes de la baja, que ya no llega a pagarse nunca por
 * el camino normal. Sacarlo a mano era abrir dos meses de nómina en la pantalla
 * y buscar su fila en cada uno.
 *
 * NO SE RECALCULA NADA APARTE: se piden los dos meses al mismo `calcular` que
 * pinta la pantalla y se coge su fila. Si las cifras del finiquito salieran de
 * otra cuenta, tarde o temprano dirían algo distinto de la nómina.
 *
 * OJO CON EL OBJETIVO DE HORAS: se prorratea desde la fecha de ALTA, no hasta
 * la de baja. A quien se va el día 11 se le sigue pidiendo el mes entero, así
 * que su "diferencia de horas" sale muy negativa y no cobra MBO por horas
 * extra. Aquí se devuelven los días que de verdad estuvo de alta para que se
 * vea, pero el número es el mismo que enseña la nómina: cambiarlo cambia lo que
 * cobra la gente y eso no se hace de pasada.
 */
async function finiquito(conductorId) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');

  const persona = await repo.personaConBaja(cid);
  if (!persona) throw new Error('No encuentro a esa persona');
  if (!persona.baja) throw new Error(`${persona.nombre} no está de baja: el finiquito es para quien se va`);

  const [ab, mb] = [Number(persona.baja.slice(0, 4)), Number(persona.baja.slice(5, 7))];
  const anterior = mesVencido(mb, ab);

  // Los dos meses de TRABAJO: el de la baja y el de antes.
  const cfg = await leerConfig();
  const meses = await mesesDeTrabajo(cid, persona, [anterior, { mes: mb, ano: ab }], cfg);
  const total = meses.reduce((n, m) => n + (m.fila ? Number(m.fila.total) || 0 : 0), 0);
  return { persona, meses, total: r2(total), config: cfg };
}

/**
 * Cada mes de TRABAJO pedido, con su fila de la nómina y su día a día. Es lo
 * que comparten el finiquito y las extras de quien sigue de alta: el mismo
 * `calcular` que pinta la pantalla (que va por mes de PAGO, el siguiente al
 * trabajado) y su fila, más los días.
 */
async function mesesDeTrabajo(cid, persona, trabajos, cfg) {
  const baja = persona.baja ? { mes: Number(persona.baja.slice(5, 7)), ano: Number(persona.baja.slice(0, 4)) } : null;
  const hoy = hoyMadrid();
  const meses = [];
  for (const t of trabajos) {
    const pago = mesSiguiente(t.mes, t.ano);
    const r = await calcular(pago.mes, pago.ano, { config: cfg });
    // Quien es de ETT ya no está en `filas` (la nómina es solo de propia),
    // pero su mes sí se calcula: va en `filasETT`.
    const fila = [...(r.filas || []), ...(r.filasETT || [])]
      .find(x => Number(x.conductorId) === cid) || null;
    const diasDelMes = new Date(t.ano, t.mes, 0).getDate();
    meses.push({
      mes: t.mes, ano: t.ano,
      etiqueta: `${MESES_NOM[t.mes - 1]} ${t.ano}`,
      esMesDeLaBaja: !!baja && t.mes === baja.mes && t.ano === baja.ano,
      // El mes que aún no ha terminado: van los datos hasta hoy.
      enCurso: `${t.ano}-${pad(t.mes)}` === hoy.slice(0, 7),
      diasDelMes,
      diasDeAlta: diasDeAltaEnMes(persona, t.mes, t.ano, diasDelMes),
      fila,
      dias: await diaADia(cid, t.mes, t.ano, fila, persona, cfg),
    });
  }
  return meses;
}

/** 'AAAA-MM-DD' de hoy en Madrid: el servidor va en UTC. */
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * DESDE CUÁNDO HAY EXTRAS QUE SACAR: julio de 2026. Antes de eso los tramos de
 * BOLT no estaban en PostgreSQL y un mes anterior saldría a cero, que no es lo
 * mismo que «no hizo nada».
 */
const PRIMER_MES_EXTRAS = { mes: 7, ano: 2026 };

/**
 * Los meses que se pueden pedir en «Extras»: de julio de 2026 al mes en curso,
 * el más reciente primero. `clave` es 'AAAA-MM'.
 */
function mesesDeExtras() {
  const hoy = hoyMadrid();
  const fin = { mes: Number(hoy.slice(5, 7)), ano: Number(hoy.slice(0, 4)) };
  const out = [];
  for (let t = { ...PRIMER_MES_EXTRAS };
    t.ano < fin.ano || (t.ano === fin.ano && t.mes <= fin.mes);
    t = mesSiguiente(t.mes, t.ano)) {
    out.push({ clave: `${t.ano}-${pad(t.mes)}`, etiqueta: `${MESES_NOM[t.mes - 1]} ${t.ano}`,
      enCurso: t.mes === fin.mes && t.ano === fin.ano });
  }
  return out.reverse();
}

/**
 * LAS EXTRAS DE QUIEN SIGUE DE ALTA, del mes o los meses que se elijan
 * (06/10/2026, Camilo: «por el momento solo tenemos julio, agosto y
 * septiembre, pero también podré elegir el mes cursante, o varios meses para
 * sacarlo todo en un Excel»). El mismo formato que el finiquito: resumen y una
 * pestaña por mes, día a día.
 *
 * `claves` son 'AAAA-MM'. Solo valen las de `mesesDeExtras`: lo de antes de
 * julio de 2026 no está en la base, y lo futuro no ha pasado.
 */
async function extras(conductorId, claves) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');
  const validas = new Set(mesesDeExtras().map(m => m.clave));
  const pedidas = [...new Set(String(claves || '').split(',').map(s => s.trim()).filter(Boolean))];
  if (!pedidas.length) throw new Error('Elige al menos un mes');
  const malas = pedidas.filter(k => !validas.has(k));
  if (malas.length) throw new Error(`Esos meses no se pueden sacar: ${malas.join(', ')}. Hay datos desde julio de 2026 hasta el mes en curso.`);

  const persona = await repo.personaConBaja(cid);
  if (!persona) throw new Error('No encuentro a esa persona');
  const trabajos = pedidas.sort().map(k => ({ ano: Number(k.slice(0, 4)), mes: Number(k.slice(5, 7)) }));
  const cfg = await leerConfig();
  const meses = await mesesDeTrabajo(cid, persona, trabajos, cfg);
  const total = meses.reduce((n, m) => n + (m.fila ? Number(m.fila.total) || 0 : 0), 0);
  return { persona, meses, total: r2(total), config: cfg };
}

/**
 * EL DÍA A DÍA de un mes de una persona (06/10/2026, Camilo: «desglosado por
 * días, cuánto hizo de nocturnidad, de peajes, propinas…»).
 *
 * Sale de las MISMAS consultas que la nómina, pedidas solo para esa persona: los
 * totales del mes son la suma de estos días, así que el desglose cuadra con su
 * fila al céntimo. Las J valen lo mismo que allí: sus horas, y solo desde el
 * día en que arranca su mes.
 *
 * Lo que NO se reparte por días, porque se decide con el mes entero:
 *   · el MBO (las horas del mes contra el objetivo, o la facturación contra el
 *     umbral);
 *   · el descuento de espera por baja utilización (la utilización es la del mes).
 */
async function diaADia(cid, mes, ano, fila, persona, cfg) {
  const diasDelMes = new Date(ano, mes, 0).getDate();
  const desde = `${ano}-${pad(mes)}-01`;
  const hasta = `${ano}-${pad(mes)}-${pad(diasDelMes)}`;
  const [horas, dinero, jus, aus] = await Promise.all([
    repo.horasDelMes(desde, hasta, { conductorId: cid }),
    repo.dineroPorDia(cid, desde, hasta),
    repo.justificantesDelMes(desde, hasta, { conductorId: cid }),
    repo.ausenciasDelPeriodo(desde, hasta, { conductorId: cid }),
  ]);
  const a = aus.get(cid) || { vacaciones: [], permiso: [] };
  const h = horas.get(cid) || { dias: new Map() };
  const j = jus.get(cid) || { aprobados: [], horas: new Map(), pendientesDias: [] };
  const primerDia = fila ? fila.primerDia : 1;
  const vacio = { seg: 0, viajeSeg: 0, esperaSeg: 0, nocSeg: 0 };
  const hoy = hoyMadrid();

  return Array.from({ length: diasDelMes }, (_, i) => {
    const d = i + 1;
    const fecha = `${ano}-${pad(mes)}-${pad(d)}`;
    const x = h.dias.get(d) || vacio;
    const din = dinero.get(d) || { neto: 0, propinas: 0, peajes: 0 };
    const jAprobada = j.aprobados.includes(d);
    const cuentaJ = jAprobada && d >= primerDia;
    const nocturnasHoras = x.nocSeg / 3600;
    const nocturnas = cfg.eurHoraNoc * nocturnasHoras * cfg.factorNoc;
    return {
      dia: d, fecha,
      horas: x.seg / 3600,
      viaje: x.viajeSeg / 3600,
      espera: x.esperaSeg / 3600,
      // La J vale sus horas, sumadas a las rodadas (regla 3).
      horasJustificadas: cuentaJ ? ((j.horas && j.horas.get(d)) || 0) / 3600 : 0,
      // Las vacaciones (5,84 h) y los permisos (8 h), igual que en la fila del
      // mes: desde el arranque y hasta la baja (regla 7).
      vacaciones: a.vacaciones.includes(fecha), permiso: a.permiso.includes(fecha),
      horasVacPerm: d < primerDia || (persona.baja && fecha > persona.baja) ? 0
        : a.permiso.includes(fecha) ? cfg.horasMetaDia
        : a.vacaciones.includes(fecha) ? horasDiaVacaciones(cfg) : 0,
      jSinHoras: cuentaJ && !((j.horas && j.horas.get(d)) > 0),
      jAprobada, jAntesDelArranque: jAprobada && !cuentaJ,
      jPendiente: (j.pendientesDias || []).includes(d),
      nocturnasHoras, nocturnas,
      propinas: din.propinas, peajes: din.peajes, neto: din.neto,
      extras: nocturnas + din.propinas + din.peajes,
      antesDelAlta: !!(persona.alta && fecha < persona.alta),
      despuesDeLaBaja: !!(persona.baja && fecha > persona.baja),
      esLaBaja: persona.baja === fecha,
      // En el mes en curso, los días que aún no han llegado.
      futuro: fecha > hoy,
      hoy: fecha === hoy,
    };
  });
}

/** Cuántos días de ese mes estuvo la persona de alta. */
function diasDeAltaEnMes(persona, mes, ano, diasDelMes) {
  const dentro = (iso, cual) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return cual === 'alta' ? 1 : diasDelMes;
    const a = Number(m[1]), me = Number(m[2]), d = Number(m[3]);
    if (a < ano || (a === ano && me < mes)) return cual === 'alta' ? 1 : 0;
    if (a > ano || (a === ano && me > mes)) return cual === 'alta' ? diasDelMes + 1 : diasDelMes;
    return d;
  };
  const desde = dentro(persona.alta, 'alta');
  const hasta = dentro(persona.baja, 'baja');
  return Math.max(0, Math.min(hasta, diasDelMes) - Math.max(desde, 1) + 1);
}

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

/**
 * Las horas de UN día natural de cada persona: Map(conductor_id → segundos
 * efectivos). La misma cuenta que la nómina (viaje + espera de BOLT, dos cuentas
 * que se pisan cuentan una vez). La pide Vacaciones para saber quién trabajó un
 * festivo más de 6 horas (14/10/2026).
 */
async function horasDelDia(dia) {
  const m = await repo.horasDelMes(dia, dia);
  const d = Number(String(dia).slice(8, 10));
  const out = new Map();
  m.forEach((x, cid) => { const seg = x.porDia.get(d) || 0; if (seg > 0) out.set(Number(cid), seg); });
  return out;
}

module.exports = {
  DEFAULTS, CONFIG_CAMPOS, MESES_NOM,
  leerConfig, guardarConfig,
  calcular, cargar, congelar, descongelar, mesesCongelados, paraETT, finiquito, extras, mesesDeExtras,
  nominaBase,
  horasDelDia,
  leerCongelada: (mes, ano) => repo.leerCongelada(mes, ano),
  // Expuestos para poder probar el prorrateo y el cálculo sin base de datos.
  _situarAlta: situarAlta, _calcularFila: calcularFila, _mesVencido: mesVencido,
  _objetivoDe: objetivoDe, _mesSiguiente: mesSiguiente,
  _ventanaBase: ventanaBase, _filaBase: filaBase, _esperaQuitada: esperaQuitada,
};
