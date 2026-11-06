// ============================================================
// VACACIONES — el saldo de cada conductor
// ============================================================
// Camilo, 14/10/2026. Las reglas, todas suyas:
//
//   GENERADAS   0,05882 días por cada DÍA LABORADO desde el alta que dice el
//               sistema (el del contrato abierto): un día en el que trabajó MÁS
//               DE 4 HORAS; con 4 h justas, o menos, ese día no suma (06/11/2026,
//               Camilo: «De ahora en adelante las vacaciones serán calculadas a
//               0,05882 por día LABORADO del mes, solo si tiene más de 4 horas
//               en ese día, sino no le suma»). «El día» es el de la bitácora:
//               desde el 01/07/2026, bitacora_horas (de fv_tramo); antes, la
//               jornada de 05:00 a 05:00 de cada cuenta de BOLT que cargó db/231
//               del historial de estados de BOLT. Horas = viaje + espera de BOLT;
//               las J no cuentan como horas. Generan TAMBIÉN (06/11/2026, Camilo:
//               «las bajas médicas y días justificados sí suman también, las
//               libranzas y ausencias injustificadas no») un día con una J
//               aprobada y un día de baja médica que le tocaba trabajar; uno que
//               caía en su libranza, no; si no se sabe qué libraría (sin plaza o
//               antes del planificador), 5/7 de día («Supón 5 de cada 7 para los
//               de baja sin plaza»). Cada día cuenta una vez. Las
//               vacaciones, los permisos y los asuntos propios no generan.
//               Hasta entonces eran 0,0821 por DÍA NATURAL (con libranzas,
//               bajas, vacaciones y permisos, y sin las suspensiones).
//               Quien entró antes de 2026 empieza el 01/01/2026
//               (19/10/2026, Camilo: «Reinicia las vacaciones desde el 1, si
//               están dados de alta antes pues muy de malas, perdieron esos
//               días, que empiecen a contar desde este año»). Hasta entonces
//               era el 01/01/2025. Lo de antes no cuenta para NADA: ni lo
//               generado, ni las vacaciones cogidas, ni los permisos, ni los
//               festivos trabajados.
//   FESTIVOS    + 1 día entero por cada festivo nacional o de la Comunidad de
//               Madrid en el que trabajó MÁS DE 6 HORAS (las de la nómina: viaje
//               + espera de BOLT, por día natural).
//   DISFRUTADAS − los días de vacaciones que ya pasaron Y le tocaba trabajar:
//               sus libranzas se mantienen y no cuentan (06/11/2026, Camilo: «si
//               pido 18 días de vacaciones, me tiene que contar solo días
//               laborales para mí, se saltan los días de libranza»). Qué libra
//               cada día lo dice el cuadrante (libranzas.js); antes del
//               planificador (03/09/2026) no se sabe y cuentan todos.
//   PERMISOS    no tocan el saldo de vacaciones. Hasta el 29/10/2026 los de
//               asuntos propios restaban un día cada uno; desde entonces tienen
//               su banco aparte (abajo).
//
// LOS ASUNTOS PROPIOS, UN BANCO APARTE (29/10/2026). Camilo: «siempre, por
// conductor, debe de sumarse dos días al año de asuntos propios; si no lo ha
// usado, en vacaciones debe de quedarse el banco de asuntos propios aparte … que
// no reste a las vacaciones, él se restará solo» y «existirá asuntos propios
// (una situación de la plantilla) que resta él mismo en el módulo de
// vacaciones, pero ambos serán separados».
//   + 2 días por cada año natural desde el que se le calcula (2026, o el de su
//     alta), enteros y sin prorratear. Lo que no usa se queda en el banco: el
//     año siguiente suma otros 2 encima.
//   − cada día en la situación «Asuntos propios» (db/225). Un permiso de los de
//     antes con el tipo de asuntos propios cuenta igual.
//   Los días de asuntos propios generan vacaciones, como un permiso.
//
// Lo programado (vacaciones y permisos de mañana en adelante) no toca el saldo
// de hoy: se enseña aparte, con el saldo que quedará después.
//
// SOLO PLANTILLA PROPIA (16/10/2026, Camilo: «quita a la gente de la ETT, a
// ellos no les damos vacaciones»). Las vacaciones de un conductor de ETT se las
// da la agencia: aquí no lleva saldo. Sus ausencias se siguen poniendo en su
// ficha (lo aparta del cuadrante), pero no salen en este módulo.
//
// CAMBIAR UNAS VACACIONES YA APROBADAS (16/10/2026, Camilo: «que se puedan
// editar las vacaciones aprobadas pero solo a futuro, las que pasaron no, pero
// siempre ligado todavía al ticket de requerimiento»). Ver `cambiarVacaciones`:
// solo lo que aún no ha llegado, con la llave de quien aprueba, y el tramo
// sigue unido a su ticket, que apunta el cambio en su historia.

const repo = require('./vacaciones.repo');
const plantilla = require('../Conductores/plantilla.service');   // la puerta de las ausencias (y la llave de aprobar)
const ticketera = require('../Ticketera/ticketera.service');      // la historia del ticket
const aFuturo = require('../../services/vacacionesAFuturo');       // solo a futuro: la misma regla que Plantilla
const nominas = require('../Nominas/nominas.service');   // la puerta de Nóminas: las horas de un día
const libranzas = require('./libranzas');                // qué días libra: no cuentan como vacaciones

const TASA = 0.05882;                      // por día laborado (06/11/2026; era 0,0821 por día natural)
// Desde aquí cuenta todo (ver arriba). saldoDe recorta a esta fecha lo generado,
// las vacaciones, los permisos, las suspensiones y los festivos.
const DESDE_HISTORICO = '2026-01-01';
const UMBRAL_LABORADO = 4 * 3600;         // un día laborado: más de 4 horas
// Un día de baja médica sin saber qué libraría (sin plaza, o antes del
// planificador) vale 5/7 de día: una semana de cinco (06/11/2026).
const BAJA_SIN_PLAZA = 5 / 7;
const UMBRAL_FESTIVO = 6 * 3600;          // más de 6 horas
// Los festivos de septiembre para atrás NO suman (06/11/2026, Camilo: «quita las
// vacaciones generadas por festivos de septiembre para atrás ya que esas sí
// fueron pagas»): el festivo trabajado se pagó en la nómina. Siguen en la
// ficha, como «pagado»; desde octubre de 2026 suman su día.
const FESTIVOS_PAGADOS_HASTA = '2026-09-30';
// Desde aquí las horas de un festivo salen de `fv_tramo` (las calcula el
// sistema). Antes, de db/198 (historial de BOLT) o no hay datos.
const NUCLEO_DESDE = '2026-07-01';
// BOLT manda tramos con retraso: las horas de un festivo se rehacen hasta que
// han pasado estos días (como el sellado de la bitácora, que mira tres).
const MARGEN_DIAS = 4;
const NO_GENERAN = new Set(['suspendido', 'suspension_permiso']);
const ASUNTOS_PROPIOS = 'PR_ASUNTOS_PROPIOS';   // el tipo del convenio (leave_type)
const AP_POR_ANIO = 2;                          // días de asuntos propios cada año
// Un día de asuntos propios: la situación propia (db/225) o, de antes, un
// permiso con ese tipo.
const esAsuntoPropio = t => t.estado === 'asuntos_propios' || (t.estado === 'permiso' && t.leave_type_code === ASUNTOS_PROPIOS);
const FIN = '9999-12-31';

// ── Fechas en 'AAAA-MM-DD', sin husos: todo es día natural ───────────────────
const DIA = 86400000;
const ms = d => Date.parse(d + 'T00:00:00Z');
const iso = t => new Date(t).toISOString().slice(0, 10);
const mas = (d, n) => iso(ms(d) + n * DIA);
const dias = (a, b) => (b < a ? 0 : Math.round((ms(b) - ms(a)) / DIA) + 1);
const solape = (a1, b1, a2, b2) => dias(a1 > a2 ? a1 : a2, b1 < b2 ? b1 : b2);
const r2 = n => Math.round(n * 100) / 100;
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

/**
 * EL SALDO DE UNA PERSONA. Función pura: todo lo que necesita entra por los
 * argumentos, para poder probarla sin base (scripts/comprobar-vacaciones-saldo.js).
 *
 *   p         { alta }  el alta del contrato abierto
 *   tramos    [{ estado, desde, hasta, motivo, tipo_permiso, fila, quien, puesto }] suyos
 *   festivos  [{ fecha, nombre, ambito, horas_at }] el calendario
 *   horas     Map(fecha → segundos) suyas en los festivos
 *   laborados Map(día → segundos) suyos, cada día de la bitácora con horas
 *             (de db/231 antes del 01/07/2026)
 *   plan      día → { trabaja, por } (libranzas.elDia con su plan): un día de
 *             vacaciones en el que libraba NO cuenta (06/11/2026). Sin plan,
 *             cuentan todos, como antes.
 *   justificados Set(día) de sus J aprobadas: generan como un día trabajado
 */
function saldoDe(p, tramos, festivos, horas, hoy, laborados, plan, justificados) {
  const inicio = p.alta > DESDE_HISTORICO ? p.alta : DESDE_HISTORICO;
  const manana = mas(hoy, 1);
  const vacaciones = [], permisos = [], suspensiones = [], asuntos = [];
  let disfrutadas = 0, programadas = 0, diasSuspension = 0, apUsados = 0, apProgramados = 0;
  // Los días de vacaciones de a…b que cuentan: los que le tocaba trabajar. Si
  // las vacaciones llevan sus dos días de libranza puestos a mano (db/233),
  // mandan esos: esos días de la semana no cuentan y los demás sí. Las de antes
  // no los tienen y cuentan con lo que dice el planificador.
  const deVacaciones = (a, b, libra) => {
    const r = { cuentan: 0, libra: 0, sinCuadrante: 0 };
    for (let d = a; d <= b; d = mas(d, 1)) {
      if (libra) { if (libranzas.cuentaConLibra(libra, d)) r.cuentan++; else r.libra++; continue; }
      const x = plan ? plan(d) : null;
      if (!libranzas.cuenta(x)) r.libra++;
      else { r.cuentan++; if (x && x.trabaja === null) r.sinCuadrante++; }
    }
    return r;
  };

  for (const t of tramos || []) {
    const hasta = t.hasta || FIN;
    const pasado = solape(t.desde, hasta, inicio, hoy);
    // Lo de mañana en adelante, solo si tiene fin: una ausencia abierta no es
    // «programada», es que nadie le ha puesto la vuelta.
    const futuro = t.hasta ? solape(t.desde, t.hasta, manana, FIN) : 0;
    const linea = { fila: t.fila, desde: t.desde, hasta: t.hasta, motivo: t.motivo || '', dias: t.hasta ? dias(t.desde, t.hasta) : null };
    if (t.estado === 'vacaciones') {
      if (!pasado && !futuro) continue;
      // Solo los días que le tocaba trabajar: sus libranzas se mantienen (las
      // dos puestas a mano, si las lleva; si no, las del planificador).
      const libra = (t.libra_dias || []).length === 2 ? t.libra_dias.map(Number) : null;
      const ya = pasado ? deVacaciones(t.desde > inicio ? t.desde : inicio, hasta < hoy ? hasta : hoy, libra) : { cuentan: 0, libra: 0, sinCuadrante: 0 };
      const va = futuro ? deVacaciones(t.desde > manana ? t.desde : manana, t.hasta, libra) : { cuentan: 0, libra: 0, sinCuadrante: 0 };
      disfrutadas += ya.cuentan; programadas += va.cuentan;
      vacaciones.push({ ...linea, disfrutados: ya.cuentan, programados: va.cuentan,
        libranzas: ya.libra + va.libra, sinCuadrante: ya.sinCuadrante + va.sinCuadrante, libraDias: libra,
        quien: t.quien || '', puesto: t.puesto || '',
        // El ticket del que salieron, si salieron de uno.
        ticket: t.ticket_id ? { id: t.ticket_id, codigo: t.ticket_codigo || '' } : null,
        // Se pueden cambiar mientras les quede algo por llegar; las empezadas,
        // solo la vuelta (ver `validarCambio`).
        editable: !!t.hasta && t.hasta >= hoy,
        empezadas: t.desde <= hoy });
    } else if (esAsuntoPropio(t)) {
      if (!pasado && !futuro) continue;
      apUsados += pasado; apProgramados += futuro;
      asuntos.push({ ...linea, usados: pasado, programados: futuro, quien: t.quien || '', puesto: t.puesto || '',
        ticket: t.ticket_id ? { id: t.ticket_id, codigo: t.ticket_codigo || '' } : null });
    } else if (t.estado === 'permiso') {
      if (!pasado && !futuro) continue;
      permisos.push({ ...linea, tipo: t.tipo_permiso || '', dentro: pasado, programados: futuro });
    } else if (NO_GENERAN.has(t.estado)) {
      if (!pasado) continue;
      diasSuspension += pasado;
      suspensiones.push({ ...linea, estado: t.estado, sinGenerar: pasado });
    }
  }

  const diasNaturales = dias(inicio, hoy);
  // LOS DÍAS QUE GENERAN, cada uno una vez y por lo primero que tenga:
  //   · trabajó MÁS de 4 h (laborados);
  //   · si no, una J aprobada ese día (06/11/2026, Camilo: «las bajas médicas y
  //     días justificados sí suman también, las libranzas y ausencias
  //     injustificadas no»);
  //   · si no, estaba de baja médica y ese día le tocaba trabajar: un día de
  //     baja que caía en su libranza no suma, como no suma la libranza. Si NO
  //     SE SABE qué libraría (sin plaza, o antes del planificador), cada día de
  //     baja vale 5/7 (06/11/2026, Camilo: «Supón 5 de cada 7 para los de baja
  //     sin plaza»): una semana de baja genera como una de cinco días, sin tener
  //     que inventarse cuáles serían sus libranzas.
  // Mes a mes, para la ficha; `cortos` son los que trabajó 4 h o menos y no
  // tienen otra cosa que los haga sumar.
  const porMes = new Map();
  const mesDe = dia => {
    const m = dia.slice(0, 7);
    if (!porMes.has(m)) porMes.set(m, { mes: m, laborados: 0, justificados: 0, bajas: 0, bajasSupuestas: 0, cortos: 0, segundos: 0 });
    return porMes.get(m);
  };
  const genera = new Map();      // día → 'trabajo' | 'justificado' | 'baja' | 'baja-supuesta'
  (laborados || new Map()).forEach((seg, dia) => {
    if (dia < inicio || dia > hoy || !(seg > 0)) return;
    mesDe(dia).segundos += seg;
    if (seg > UMBRAL_LABORADO) genera.set(dia, 'trabajo');
  });
  (justificados || new Set()).forEach(dia => {
    if (dia >= inicio && dia <= hoy && !genera.has(dia)) genera.set(dia, 'justificado');
  });
  for (const t of tramos || []) {
    if (t.estado !== 'baja_medica') continue;
    const a = t.desde > inicio ? t.desde : inicio, b = (t.hasta || FIN) < hoy ? t.hasta : hoy;
    for (let d = a; d <= b; d = mas(d, 1)) {
      if (genera.has(d)) continue;
      const q = plan ? plan(d) : null;
      if (!q || q.trabaja === null) genera.set(d, 'baja-supuesta');
      else if (q.trabaja) genera.set(d, 'baja');
    }
  }
  genera.forEach((por, dia) => {
    const x = mesDe(dia);
    if (por === 'trabajo') x.laborados++; else if (por === 'justificado') x.justificados++;
    else if (por === 'baja') x.bajas++; else x.bajasSupuestas++;
  });
  (laborados || new Map()).forEach((seg, dia) => {
    if (dia >= inicio && dia <= hoy && seg > 0 && !genera.has(dia)) mesDe(dia).cortos++;
  });
  const cuantos = por => [...genera.values()].filter(v => v === por).length;
  const diasLaborados = cuantos('trabajo'), diasJustificados = cuantos('justificado'), diasBaja = cuantos('baja');
  const diasBajaSupuestos = cuantos('baja-supuesta');
  // Los de baja sin saber qué libraría valen 5/7: el total puede llevar
  // decimales. Lo generado sale de los días SIN redondear (redondearlos antes de
  // multiplicar movía 0,01 lo generado); solo se redondea lo que se enseña.
  const valen = (enteros, supuestos) => enteros + supuestos * BAJA_SIN_PLAZA;
  const crudo = valen(diasLaborados + diasJustificados + diasBaja, diasBajaSupuestos);
  const diasQueGeneran = r2(crudo);
  const generadas = r2(TASA * crudo);
  const meses = [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes))
    .map(x => {
      const c = valen(x.laborados + x.justificados + x.bajas, x.bajasSupuestas);
      return { ...x, generan: r2(c), generadas: r2(TASA * c) };
    });

  // Los festivos de su periodo. El de hoy aún no ha terminado.
  const lista = (festivos || []).filter(f => f.fecha >= inicio && f.fecha <= hoy).map(f => {
    const segundos = (horas && horas.get(f.fecha)) || 0;
    let estado;
    if (f.fecha === hoy) estado = 'hoy';
    else if (f.fecha <= FESTIVOS_PAGADOS_HASTA) estado = 'pagado';
    else if (!f.horas_at) estado = f.fecha < NUCLEO_DESDE ? 'sin-datos' : 'pendiente';
    else estado = segundos > UMBRAL_FESTIVO ? 'suma' : 'no-suma';
    return { fecha: f.fecha, nombre: f.nombre, ambito: f.ambito, segundos, estado };
  });
  const festivosSuman = lista.filter(f => f.estado === 'suma').length;

  const saldo = r2(generadas + festivosSuman - disfrutadas);
  const ahora = vacaciones.find(v => v.desde <= hoy && (v.hasta || FIN) >= hoy);
  // El banco de asuntos propios: 2 por año natural, del año en que empieza a
  // contar al de hoy (a quien se fue, al de su baja).
  const anios = Number(hoy.slice(0, 4)) - Number(inicio.slice(0, 4)) + 1;
  const apGenerados = AP_POR_ANIO * Math.max(0, anios);
  const apSaldo = apGenerados - apUsados;
  return {
    inicio, desdeElAlta: inicio === p.alta,
    diasNaturales, diasSuspension, diasQueGeneran, diasLaborados, diasJustificados, diasBaja, diasBajaSupuestos, generadas,
    festivosSuman, festivosSinDatos: lista.filter(f => f.estado === 'sin-datos').length,
    festivosPendientes: lista.filter(f => f.estado === 'pendiente' || f.estado === 'hoy').length,
    disfrutadas, saldo,
    programadas,
    saldoTras: r2(saldo - programadas),
    deVacacionesHasta: ahora ? ahora.hasta : null,
    asuntosPropios: {
      porAnio: AP_POR_ANIO, anios: Math.max(0, anios), desde: inicio.slice(0, 4),
      generados: apGenerados, usados: apUsados, programados: apProgramados,
      saldo: apSaldo, saldoTras: apSaldo - apProgramados,
    },
    detalle: { festivos: lista, vacaciones, permisos, suspensiones, asuntos, meses },
  };
}

/** Las piezas de la base para una o todas las personas (también las que se fueron este año). */
async function cargar({ id = null } = {}) {
  const gente = await repo.personas({ id, conBajas: true, desde: DESDE_HISTORICO });
  const ids = gente.map(p => p.id);
  let festivos, horas;
  try {
    [festivos, horas] = await Promise.all([repo.festivos(), repo.horasFestivos(ids)]);
  } catch (e) {
    if (e.code === '42P01') throw new Error('Falta aplicar la migración db/197 (el calendario de festivos).');
    throw e;
  }
  const [tramos, lab, pl, js] = await Promise.all([repo.tramos(ids, DESDE_HISTORICO), repo.diasLaborados(ids, DESDE_HISTORICO),
    repo.planes(ids), repo.justificados(ids, DESDE_HISTORICO)]);
  // Qué le tocaba cada día (libranzas.js): sus libranzas no cuentan como vacaciones.
  const planDe = id => { const x = pl.porId.get(String(id)); return x ? (d => libranzas.elDia(x, d, pl.inicio)) : null; };
  const porId = new Map(ids.map(i => [i, { tramos: [], horas: new Map(), laborados: new Map(), justificados: new Set(), plan: planDe(i) }]));
  js.forEach(j => { const x = porId.get(j.id); if (x) x.justificados.add(j.dia); });
  tramos.forEach(t => porId.get(t.id).tramos.push(t));
  horas.forEach(h => porId.get(h.id).horas.set(h.fecha, Number(h.segundos)));
  lab.filas.forEach(d => { const x = porId.get(d.id); if (x) x.laborados.set(d.dia, Number(d.segundos)); });
  return { gente, festivos, porId, sinHistorico: lab.sinHistorico };
}

const contrato = p => (p.tipo === 'ett' ? `ETT${p.ett_nombre ? ' · ' + p.ett_nombre : ''}` : 'Propia');

/**
 * EL SALDO DE QUIEN SE FUE, A SU BAJA (21/10/2026). Lo que generó y no disfrutó
 * hasta el día que dejó la empresa, que es lo que entra en su finiquito: la
 * misma cuenta (`saldoDe`) con «hoy» en su baja. Lo de después no existe para
 * él: nada programado, nada que cambiar. Quien tiene la baja puesta más adelante
 * (baja programada) sigue contando a hoy, como cualquiera de alta.
 */
function saldoPara(p, x, festivos, hoy) {
  const deBaja = !!(p.baja && p.baja <= hoy);
  const corte = deBaja ? p.baja : hoy;
  const tramos = deBaja ? x.tramos.filter(t => t.desde <= p.baja) : x.tramos;
  const s = saldoDe(p, tramos, festivos, x.horas, corte, x.laborados, x.plan, x.justificados);
  if (deBaja) {
    s.programadas = 0; s.saldoTras = s.saldo; s.deVacacionesHasta = null;
    s.asuntosPropios.programados = 0; s.asuntosPropios.saldoTras = s.asuntosPropios.saldo;
    s.detalle.vacaciones.forEach(v => { v.editable = false; v.programados = 0; });
    s.detalle.asuntos.forEach(a => { a.programados = 0; });
  }
  return { ...s, deBaja, baja: p.baja || null, motivoBaja: p.motivo_baja || '', corte };
}

/** La lista: una fila por persona —de alta, o que se fue este año—, con su saldo. */
// Las reglas, para que la pantalla las diga con los números de aquí y no con los suyos.
const reglas = sinHistorico => ({ tasa: TASA, desde: DESDE_HISTORICO, umbralHoras: UMBRAL_FESTIVO / 3600, festivosPagadosHasta: FESTIVOS_PAGADOS_HASTA,
  umbralLaborado: UMBRAL_LABORADO / 3600, bajaSinPlaza: '5/7', nucleoDesde: NUCLEO_DESDE, apPorAnio: AP_POR_ANIO, sinHistorico: !!sinHistorico });

async function lista({ hoy = hoyMadrid() } = {}) {
  const { gente, festivos, porId, sinHistorico } = await cargar();
  const filas = gente.map(p => {
    const x = porId.get(p.id);
    const s = saldoPara(p, x, festivos, hoy);
    delete s.detalle;
    return { id: p.id, nombre: p.nombre, dni: p.dni_nie || '', alta: p.alta, contrato: contrato(p), tipo: p.tipo, ...s };
  });
  return { filas, hoy, reglas: reglas(sinHistorico) };
}

/** La ficha de una persona: el saldo y de dónde sale cada número. */
async function ficha(id, { hoy = hoyMadrid() } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Falta la persona');
  const { gente, festivos, porId, sinHistorico } = await cargar({ id: n });
  if (!gente.length) {
    const [ett] = await repo.personas({ id: n, conEtt: true });
    throw new Error(ett
      ? `${ett.nombre} es de ETT: sus vacaciones se las da la agencia, no nosotros, así que aquí no lleva saldo.`
      : 'Esta persona no tiene contrato este año: no lleva saldo de vacaciones.');
  }
  const p = gente[0];
  const x = porId.get(p.id);
  return {
    id: p.id, nombre: p.nombre, dni: p.dni_nie || '', alta: p.alta, contrato: contrato(p), tipo: p.tipo, hoy,
    reglas: reglas(sinHistorico),
    ...saldoPara(p, x, festivos, hoy),
  };
}

// ── Simular unas vacaciones (06/11/2026) ────────────────────────────────────
// Camilo: «en un calendario, simula los días que X trabajador ha pedido. Si pongo
// por ejemplo de 11/08 al 12/09, me tiene que decir cuántos días de libranza
// coge el trabajador saltando también sus futuras libranzas». No guarda nada.

const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
// 'AAAA-MM-DD' o 'dd/mm/aaaa' → 'AAAA-MM-DD'.
function aIso(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/**
 * Del `desde` al `hasta` de una persona, día a día: si cuenta como vacaciones o
 * libra (no cuenta), si es festivo y si ya tiene algo puesto. Con el saldo de hoy
 * y el que le quedaría.
 *
 * LOS DOS DÍAS QUE LIBRA, A MANO (06/11/2026, db/233; Camilo: «En el simulador
 * debe de decir los días que libra pero A MANO … sí o sí tienen que ser dos
 * días»): `libra` = '3,4'. Esos días de la semana no cuentan; los demás, sí. Lo
 * que dice el planificador va al lado (`segunPlanificador`), para compararlo.
 */
async function simular(id, { desde, hasta, libra } = {}, { hoy = hoyMadrid() } = {}) {
  const a = aIso(desde), b = aIso(hasta);
  if (!a || !b) throw new Error('Faltan el primer y el último día');
  if (b < a) throw new Error('El último día va antes que el primero');
  if (dias(a, b) > 366) throw new Error('Como mucho un año de una vez');
  const dosDias = libranzas.dosDiasLibra(libra);
  const f = await ficha(id, { hoy });            // la misma persona y el mismo saldo que la ficha
  const { porId } = await cargar({ id: Number(id) });
  const x = porId.get(String(f.id));
  const fest = new Map((await repo.festivos()).map(z => [z.fecha, z.nombre]));
  const ya = d => (x.tramos || []).find(t => t.desde <= d && (t.hasta || FIN) >= d);
  const lista = [];
  for (let d = a; d <= b; d = mas(d, 1)) {
    const t = ya(d);
    const cuenta = libranzas.cuentaConLibra(dosDias, d);
    lista.push({ dia: d, dow: libranzas.isodow(d), trabaja: cuenta, por: 'a-mano',
      cuenta, festivo: fest.get(d) || null, ya: t ? t.estado : null });
  }
  const cuentan = lista.filter(d => d.cuenta);
  // Lo que restaría de verdad: lo que ya son vacaciones ya está en su saldo.
  const nuevos = cuentan.filter(d => d.ya !== 'vacaciones').length;
  const segun = libranzas.libraSegunPlanificador(x.plan, a);
  return {
    id: f.id, nombre: f.nombre, desde: a, hasta: b, hoy,
    naturales: lista.length, cuentan: cuentan.length, libranzas: lista.length - cuentan.length, nuevos,
    yaDeVacaciones: lista.filter(d => d.ya === 'vacaciones').length,
    otraAusencia: lista.filter(d => d.ya && d.ya !== 'vacaciones').length,
    sinCuadrante: 0,
    libra: dosDias,
    diasQueLibra: dosDias.map(n => DIAS_SEMANA[n - 1]),
    segunPlanificador: segun,
    saldo: f.saldo, programadas: f.programadas, saldoTras: f.saldoTras, quedaria: r2(f.saldoTras - nuevos),
    deBaja: f.deBaja, dias: lista,
  };
}

/**
 * LO QUE LIBRA SEGÚN EL PLANIFICADOR la semana que empieza `desde` (hoy si no se
 * dice), para proponer a mano los dos días de unas vacaciones (db/233). Si son
 * dos o menos se proponen marcados (a Angel Lopez Gomez le sale uno: falta
 * elegir el otro); si son más —un CT que trabaja dos días—, no se marca nada.
 * Quien las pone elige; esto solo ayuda.
 */
async function libranzasSugeridas(id, desde, { hoy = hoyMadrid() } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Falta la persona');
  const d = aIso(desde) || hoy;
  const pl = await repo.planes([String(n)]);
  const x = pl.porId.get(String(n));
  const segun = x ? libranzas.libraSegunPlanificador(dia => libranzas.elDia(x, dia, pl.inicio), d) : [];
  const texto = !segun.length
    ? 'El planificador no dice qué libra (no tiene plaza, o es antes del 03/09/2026).'
    : segun.length === 1 ? `Según el planificador libra solo el ${libranzas.nombresDias(segun)}: elige el segundo día.`
      : segun.length === 2 ? `Según el planificador libra ${libranzas.nombresDias(segun)}.`
        : `Según el planificador libra ${segun.length} días a la semana (${libranzas.nombresDias(segun)}): elige los dos de sus vacaciones.`;
  return { desde: d, segunPlanificador: segun, propuestos: segun.length <= 2 ? segun : [], texto };
}

// ── Cambiar unas vacaciones ya aprobadas ────────────────────────────────────

const ddmmaaaa = d => String(d || '').split('-').reverse().join('/');

// Lo que se puede cambiar de unas vacaciones (solo a futuro) vive en
// services/vacacionesAFuturo.js: la misma regla la aplica Plantilla.
const validarCambio = aFuturo.validarCambio;

/**
 * CAMBIA UNAS VACACIONES YA APROBADAS (16/10/2026). Solo lo que aún no ha
 * llegado (`validarCambio`), y solo quien las aprueba: la llave la exige la
 * puerta de Plantilla, que es la que corrige el tramo —la misma fila, así que
 * sigue unida a su ticket—. Si salieron de un ticket, el ticket apunta el cambio
 * en su historia y su resolución pasa a decir las fechas nuevas.
 */
async function cambiarVacaciones(conductorId, filaId, datos = {}, quien = {}, { hoy = hoyMadrid() } = {}) {
  const t = await repo.tramo(conductorId, filaId);
  if (!t || t.estado !== 'vacaciones') throw new Error('Esas vacaciones no existen (o no son de esta persona)');
  const nuevas = validarCambio(t, datos, hoy);
  const motivo = datos.motivo === undefined ? undefined : String(datos.motivo || '').trim();
  const cambiaMotivo = motivo !== undefined && motivo !== (t.motivo || '');
  // Los dos días que libra (db/233): solo mientras no hayan empezado.
  const libra = datos.libraDias === undefined ? null : libranzas.dosDiasLibra(datos.libraDias);
  if (libra) aFuturo.validarLibra(t, libra, hoy);
  const cambiaLibra = !!libra && String(libra) !== String((t.libra_dias || []).map(Number).sort((a, b) => a - b));
  if (nuevas.desde === t.desde && nuevas.hasta === t.hasta && !cambiaMotivo && !cambiaLibra) {
    throw new Error('No has cambiado nada');
  }

  await plantilla.editarAusencia(Number(conductorId), Number(filaId), {
    desde: nuevas.desde, hasta: nuevas.hasta, ...(cambiaMotivo ? { motivo } : {}), ...(cambiaLibra ? { libraDias: libra } : {}),
  }, quien);

  const tramo = f => `del ${ddmmaaaa(f.desde)} al ${ddmmaaaa(f.hasta)}`;
  if (t.ticket_id) {
    const nota = (nuevas.desde !== t.desde || nuevas.hasta !== t.hasta)
      ? `Vacaciones cambiadas desde Vacaciones: antes ${tramo(t)}, ahora ${tramo(nuevas)}.`
      : cambiaLibra ? 'Vacaciones: cambiados los días que libra desde Vacaciones.' : 'Vacaciones: cambiado el motivo desde Vacaciones.';
    await ticketera.anotarCambioDeVacaciones(t.ticket_id, {
      nota: nota + (cambiaLibra ? ` Libra: ${libranzas.nombresDias(libra)}.` : '') + (cambiaMotivo ? ` Motivo: «${motivo || '(sin motivo)'}».` : ''),
      resolucion: `Aplicado: Vacaciones ${tramo(nuevas)} (cambiadas el ${ddmmaaaa(hoy)})`,
    }, quien);
  }
  console.log(`🏖️ [Vacaciones] conductor ${conductorId}, tramo ${filaId}: ${tramo(t)} → ${tramo(nuevas)}` +
    (t.ticket_codigo ? ` · ticket ${t.ticket_codigo}` : ''));
  return { cambiadas: { ...nuevas, motivo: cambiaMotivo ? motivo : t.motivo }, ticket: t.ticket_codigo || null };
}

/**
 * LAS HORAS DE LOS FESTIVOS, desde el sistema. Cada hora: los festivos desde el
 * 01/07/2026 que ya pasaron y no tienen las horas, o las tienen de antes de que
 * BOLT terminara de mandar ese día. Con la misma cuenta que la nómina.
 */
async function sellarFestivos({ hoy = hoyMadrid() } = {}) {
  let fechas;
  try { fechas = await repo.festivosPorSellar(NUCLEO_DESDE, hoy, MARGEN_DIAS); }
  catch (e) { if (e.code === '42P01') return { sinTabla: true, hechos: [] }; throw e; }
  const hechos = [];
  for (const fecha of fechas) {
    const horas = await nominas.horasDelDia(fecha);
    const personas = await repo.guardarHorasFestivo(fecha, horas, 'nucleo');
    hechos.push({ fecha, personas, masDe6: [...horas.values()].filter(s => s > UMBRAL_FESTIVO).length });
  }
  return { hechos };
}

module.exports = {
  TASA, DESDE_HISTORICO, UMBRAL_LABORADO, UMBRAL_FESTIVO, FESTIVOS_PAGADOS_HASTA, NUCLEO_DESDE, ASUNTOS_PROPIOS, AP_POR_ANIO,
  lista, ficha, simular, libranzasSugeridas, sellarFestivos, cambiarVacaciones,
  _saldoDe: saldoDe, _validarCambio: validarCambio,
};
