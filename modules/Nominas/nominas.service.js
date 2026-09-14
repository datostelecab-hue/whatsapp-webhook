// ============================================================
// NÓMINAS · SERVICIO — la compensación variable del mes
// ============================================================
// Replica el cálculo que RRHH hacía en Excel + AppScript. Las FÓRMULAS son las
// mismas que llevaban meses cuadrando; lo que ha cambiado es de dónde salen los
// datos: antes de Google Sheets y de la API de BOLT, ahora de PostgreSQL.
//
// ── LAS CINCO REGLAS QUE HAY QUE SABER ────────────────────────────────────────
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
// 3. LAS J CUENTAN, Y VALEN EL DIA ENTERO. Un dia con justificante aprobado
//    (coche en taller, cuenta suspendida, medico) no es un dia sin trabajar:
//    es un dia que alguien dio por bueno. La nomina lo separa en dos cifras
//    que es justo lo que RRHH pregunta —cuanto de lo que falta esta explicado
//    y cuanto no—:
//
//      HORAS JUSTIFICADAS     lo que cubren las J aprobadas
//      HORAS NO JUSTIFICADAS  lo que sigue faltando para el objetivo despues
//                             de sumar las horas de BOLT y las justificadas
//
//    Una J vale la JORNADA ENTERA (las horas meta del dia, 8), sin distinguir
//    tipo ni motivo. La tabla `justificante` tiene una columna de horas, pero
//    no dice nada util: de las 182 J aprobadas de agosto de 2026, 114 traen un
//    "8" puesto a ojo y otras 13 traen las MISMAS horas que esa persona ya
//    habia rodado ese dia —sumarlas seria contar dos veces el mismo rato—.
//
//    Y TOPADA POR LO QUE FALTE DE ESE DIA. Una J cubre lo que no se pudo
//    hacer, no ocho horas encima de lo que si se hizo: quien rodo 3 h y tiene
//    J ese dia suma 5 justificadas, no 8, y el dia queda en 8, no en 11. Para
//    los 104 dias de agosto en que no se rodo nada, que son la mayoria, la J
//    vale las 8 enteras, que es lo esperado.
//
//    LAS J CUENTAN TAMBIEN PARA EL EXCESO. La diferencia contra el objetivo se
//    mide con las justificadas dentro: quien rodo 205,6 h y tuvo dos dias
//    justificados lleva 221,6 contra un objetivo de 176, y su exceso son 45,6
//    horas, no 29,6. Un dia justificado no puede restarle a nadie.
//
//    Y NO REGALA HORAS EXTRA, justo por el tope de arriba: como la J nunca sube
//    un dia por encima de la jornada, las justificadas solo pueden llevar a
//    alguien HASTA su objetivo. Para pasarse hay que haber rodado de mas los
//    demas dias, que es lo que la hora extra paga. Las dos reglas —vale el dia
//    entero, pero topada— van juntas: separarlas rompe el calculo.
//
// 4. LA HORA EXTRA SE PAGA POR CONDUCIR, NO POR ESTAR CONECTADO. Las horas
//    efectivas son viaje + espera, asi que quien pasa el mes con la app abierta
//    y poca carrera acumula horas igual que quien no para. El caso que lo
//    destapo: 211,4 h en el mes y 35,4 de exceso sobre el objetivo... con un
//    52,7 % de utilizacion. De sus 211 horas, 100 fueron espera.
//
//    Asi que todo el mundo tiene que llegar a una utilizacion minima (65 %,
//    editable). A quien no llega se le quitan horas DE ESPERA —nunca de viaje—
//    hasta que la alcanza:
//
//      utilizacion = viaje / (viaje + espera)
//      X = (viaje + espera) - viaje / minimo
//
//    Dos propiedades que la hacen segura:
//      · X nunca pasa de la espera que esa persona tiene, porque X <= espera
//        equivale a viaje <= viaje / minimo, cierto siempre que el minimo sea
//        menor que 1. No se le puede quitar viaje a nadie.
//      · Despues del recorte todos quedan EXACTAMENTE en el minimo. Quien ya
//        llegaba no pierde nada.
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
  utilMinima: 0.65,     // USADO — utilización mínima exigida. A quien no llega se le
                        // retiran horas de ESPERA hasta que la alcanza (regla 4).
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
  { key: 'utilMinima', label: 'Utilización mínima (fracción, 0.65 = 65%)', usado: true },
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

  // ── Las J ────────────────────────────────────────────────────────────────
  // Solo las de su ventana: una J anterior a su alta no cubre un objetivo que
  // todavia no existia. Cada una vale la jornada del dia, topada por lo que le
  // faltara a ese dia para llegar (ver la cabecera del fichero).
  const jus = (c.jDias || []).filter(d => d >= primerDia);
  const horasJustificadas = jus.reduce(
    (a, d) => a + Math.max(0, cfg.horasMetaDia - ((c.horasPorDia && c.horasPorDia.get(d)) || 0) / 3600), 0);

  // ── El recorte por utilizacion minima ────────────────────────────────────
  // A quien no llega al minimo se le retiran horas de ESPERA hasta que lo
  // alcanza (ver la regla 4 de la cabecera). El viaje no se toca nunca, y la
  // propia formula lo garantiza: X no puede pasar de la espera que tuvo.
  const viaje = c.viajeH || 0, espera = c.esperaH || 0;
  const efectivas = viaje + espera;
  let horasEsperaQuitadas = 0;
  if (cfg.utilMinima > 0 && cfg.utilMinima < 1 && efectivas > 0 && viaje < cfg.utilMinima * efectivas) {
    horasEsperaQuitadas = efectivas - viaje / cfg.utilMinima;
    // Cinturon: `c.horas` es el total con los solapes FUNDIDOS y `efectivas` es
    // la suma de los dos por separado, asi que si alguien tiene dos cuentas
    // pisandose en situaciones distintas pueden diferir por unos minutos. El
    // recorte no puede dejar a nadie en negativo.
    horasEsperaQuitadas = Math.min(horasEsperaQuitadas, Math.max(0, espera), c.horas);
  }

  // LA DIFERENCIA SE MIDE CON LAS J DENTRO. Un dia justificado cuenta como la
  // jornada que habria hecho, asi que no le resta a nadie: quien rodo 205,6 h y
  // tuvo dos dias justificados lleva 221,6 contra un objetivo de 176, y su
  // exceso son 45,6 h, no 29,6.
  //
  // Esto no regala horas extra porque la J esta TOPADA: nunca sube un dia por
  // encima de la jornada, de modo que las justificadas solo pueden llevar a
  // alguien HASTA su objetivo. Para pasarse hay que haber rodado de mas los
  // demas dias, que es precisamente lo que la hora extra paga.
  const horasComputadas = c.horas - horasEsperaQuitadas + horasJustificadas;
  const delta = horasComputadas - hsTgt;

  // Las dos caras de la misma cifra: lo que sobra es `delta`, y lo que falta es
  // `delta` en negativo. Se guarda aparte porque es la pregunta de RRHH.
  const horasNoJustificadas = Math.max(0, -delta);

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
    nombreBolt: c.nombreBolt || '',
    nombreSS: c.nombreSS || '',
    nombreSSEnForma: c.nombreSSEnForma !== false,
    dni: c.dni || '',
    ett: !!c.ett,
    jornada,
    primerDia,
    alta: c.alta || '',
    origenArranque: origen,      // alta-anterior | alta-en-mes | primer-log
    horas: r2(c.horas),
    horasEsperaQuitadas: r2(horasEsperaQuitadas),
    horasJustificadas: r2(horasJustificadas),
    horasNoJustificadas: r2(horasNoJustificadas),
    diasJustificados: jus.length,
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

  const [horas, dinero, fichas, justificantes] = await Promise.all([
    repo.horasDelMes(desde, hasta),
    repo.dineroDelMes(desde, hasta),
    repo.fichasDelMes(hasta),
    repo.justificantesDelMes(desde, hasta),
  ]);

  // Entra quien TRABAJÓ ese mes. El dinero sin horas no hace nómina variable:
  // son pedidos de alguien que ya no aparece en los tramos (una cuenta sin
  // enlazar), y meterlo daría un objetivo de horas contra cero horas hechas.
  const gente = [];
  horas.forEach((h, cid) => {
    const f = fichas.get(cid) || {};
    const d = dinero.get(cid) || { neto: 0, propinas: 0, peajes: 0 };
    const efectivos = h.viajeSeg + h.esperaSeg;
    const j = justificantes.get(cid) || { aprobados: [], pendientes: 0 };
    gente.push({
      conductorId: cid,
      nombre: f.nombre || `#${cid}`,
      nombreBolt: f.nombreBolt || '',
      nombreSS: f.nombreSS || '',
      nombreSSEnForma: f.nombreSSEnForma !== false,
      dni: f.dni || '',
      ett: !!f.ett,
      jornada: f.jornada,
      alta: f.alta || '',
      primerDia: h.primerDia,
      horas: h.horasSeg / 3600,
      viajeH: h.viajeSeg / 3600,
      esperaH: h.esperaSeg / 3600,
      horasPorDia: h.porDia,
      jDias: j.aprobados,
      jPendientes: j.pendientes,
      nocturnasH: h.nocSeg / 3600,
      utilPct: efectivos > 0 ? (h.viajeSeg / efectivos) * 100 : null,
      neto: d.neto, propinas: d.propinas, peajes: d.peajes,
    });
  });

  // QUIEN NO RODO NADA PERO TIENE J. No sale de `horas` —ahi solo esta quien
  // tiene tramos—, y sin esto el mes entero de quien estuvo de baja con todo
  // justificado se perdia: ni horas, ni justificadas, ni fila. Entra con cero
  // horas de BOLT y sus J, que es exactamente lo que paso.
  justificantes.forEach((j, cid) => {
    if (horas.has(cid) || !j.aprobados.length) return;
    const f = fichas.get(cid) || {};
    const d = dinero.get(cid) || { neto: 0, propinas: 0, peajes: 0 };
    gente.push({
      conductorId: cid,
      nombre: f.nombre || `#${cid}`,
      nombreBolt: f.nombreBolt || '',
      nombreSS: f.nombreSS || '',
      nombreSSEnForma: f.nombreSSEnForma !== false,
      dni: f.dni || '',
      ett: !!f.ett,
      jornada: f.jornada,
      alta: f.alta || '',
      primerDia: Math.min(...j.aprobados),
      horas: 0,
      viajeH: 0,
      esperaH: 0,
      horasPorDia: new Map(),
      jDias: j.aprobados,
      jPendientes: j.pendientes,
      nocturnasH: 0,
      utilPct: null,
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
    t.horasJustificadas += f.horasJustificadas; t.horasNoJustificadas += f.horasNoJustificadas;
    t.horasEsperaQuitadas += f.horasEsperaQuitadas;
    return t;
  }, { propinas: 0, peajes: 0, nocturnas: 0, mboFAS: 0, compensacion: 0, diasExtra: 0, total: 0,
       horasJustificadas: 0, horasNoJustificadas: 0, horasEsperaQuitadas: 0 });
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
      // Sin nombre de BOLT no se puede cruzar esta fila con un informe de la
      // plataforma, que es la mitad de para lo que sirve la columna.
      sinNombreBolt: filas.filter(f => !f.nombreBolt).length,
      // A quien la ficha no le separa apellidos de nombres: su nombre de la
      // seguridad social sale de una pieza, sin la coma. No se parte a ojo.
      sinApellidosSeparados: filas.filter(f => !f.nombreSSEnForma).length,
      // J en la cola: nadie las ha aprobado todavia, asi que NO cuentan. Si se
      // aprueban, las horas justificadas de este mes suben.
      jPendientes: dentro.reduce((a, c) => a + (c.jPendientes || 0), 0),
      conJ: filas.filter(f => f.diasJustificados > 0).length,
      // A quien no llegaba a la utilizacion minima y se le ha recortado espera.
      conRecorte: filas.filter(f => f.horasEsperaQuitadas > 0).length,
      // Y, de esos, a quien el recorte le ha quitado las horas extra que tenia.
      recortadosSinExtra: filas.filter(f =>
        f.horasEsperaQuitadas > 0 && f.horas + f.horasJustificadas > f.horasObjetivo
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
