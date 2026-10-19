// ============================================================
// VACACIONES — el saldo de cada conductor
// ============================================================
// Camilo, 14/10/2026. Las reglas, todas suyas:
//
//   GENERADAS   0,0821 días por cada DÍA NATURAL desde el alta que dice el
//               sistema (el del contrato abierto). Cuentan la libranza, la baja
//               médica, las vacaciones y los permisos; NO cuentan los días de
//               suspensión (de empleo y sueldo, o por retirada del permiso de
//               conducir). Quien entró antes de 2026 empieza el 01/01/2026
//               (19/10/2026, Camilo: «Reinicia las vacaciones desde el 1, si
//               están dados de alta antes pues muy de malas, perdieron esos
//               días, que empiecen a contar desde este año»). Hasta entonces
//               era el 01/01/2025. Lo de antes no cuenta para NADA: ni lo
//               generado, ni las vacaciones cogidas, ni los permisos, ni los
//               festivos trabajados.
//   FESTIVOS    + 1 día entero por cada festivo nacional o de la Comunidad de
//               Madrid en el que trabajó MÁS DE 6 HORAS (las de la nómina: viaje
//               + espera de BOLT, por día natural).
//   DISFRUTADAS − los días de vacaciones que ya pasaron.
//   PERMISOS    − cada día de permiso de ASUNTOS PROPIOS resta un día entero
//               (Camilo, 14/10/2026: «Solo restan los de asuntos propios»). El
//               resto de permisos retribuidos no toca el saldo. El tipo es el
//               del convenio (`leave_type_code`), que se elige al poner el
//               permiso en Plantilla o al aplicar el ticket.
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

const TASA = 0.0821;
// Desde aquí cuenta todo (ver arriba). saldoDe recorta a esta fecha lo generado,
// las vacaciones, los permisos, las suspensiones y los festivos.
const DESDE_HISTORICO = '2026-01-01';
const UMBRAL_FESTIVO = 6 * 3600;          // más de 6 horas
// Desde aquí las horas de un festivo salen de `fv_tramo` (las calcula el
// sistema). Antes, de db/198 (historial de BOLT) o no hay datos.
const NUCLEO_DESDE = '2026-07-01';
// BOLT manda tramos con retraso: las horas de un festivo se rehacen hasta que
// han pasado estos días (como el sellado de la bitácora, que mira tres).
const MARGEN_DIAS = 4;
const NO_GENERAN = new Set(['suspendido', 'suspension_permiso']);
const ASUNTOS_PROPIOS = 'PR_ASUNTOS_PROPIOS';   // el único permiso que resta
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
 */
function saldoDe(p, tramos, festivos, horas, hoy) {
  const inicio = p.alta > DESDE_HISTORICO ? p.alta : DESDE_HISTORICO;
  const manana = mas(hoy, 1);
  const vacaciones = [], permisos = [], suspensiones = [];
  let disfrutadas = 0, programadas = 0, diasPermiso = 0, permisoProgramado = 0, diasSuspension = 0;

  for (const t of tramos || []) {
    const hasta = t.hasta || FIN;
    const pasado = solape(t.desde, hasta, inicio, hoy);
    // Lo de mañana en adelante, solo si tiene fin: una ausencia abierta no es
    // «programada», es que nadie le ha puesto la vuelta.
    const futuro = t.hasta ? solape(t.desde, t.hasta, manana, FIN) : 0;
    const linea = { fila: t.fila, desde: t.desde, hasta: t.hasta, motivo: t.motivo || '', dias: t.hasta ? dias(t.desde, t.hasta) : null };
    if (t.estado === 'vacaciones') {
      if (!pasado && !futuro) continue;
      disfrutadas += pasado; programadas += futuro;
      vacaciones.push({ ...linea, disfrutados: pasado, programados: futuro, quien: t.quien || '', puesto: t.puesto || '',
        // El ticket del que salieron, si salieron de uno.
        ticket: t.ticket_id ? { id: t.ticket_id, codigo: t.ticket_codigo || '' } : null,
        // Se pueden cambiar mientras les quede algo por llegar; las empezadas,
        // solo la vuelta (ver `validarCambio`).
        editable: !!t.hasta && t.hasta >= hoy,
        empezadas: t.desde <= hoy });
    } else if (t.estado === 'permiso') {
      if (!pasado && !futuro) continue;
      const resta = t.leave_type_code === ASUNTOS_PROPIOS;
      if (resta) { diasPermiso += pasado; permisoProgramado += futuro; }
      permisos.push({ ...linea, tipo: t.tipo_permiso || '', resta, restan: resta ? pasado : 0,
        programados: resta ? futuro : 0, dentro: pasado });
    } else if (NO_GENERAN.has(t.estado)) {
      if (!pasado) continue;
      diasSuspension += pasado;
      suspensiones.push({ ...linea, estado: t.estado, sinGenerar: pasado });
    }
  }

  const diasNaturales = dias(inicio, hoy);
  const diasQueGeneran = Math.max(0, diasNaturales - diasSuspension);
  const generadas = r2(TASA * diasQueGeneran);

  // Los festivos de su periodo. El de hoy aún no ha terminado.
  const lista = (festivos || []).filter(f => f.fecha >= inicio && f.fecha <= hoy).map(f => {
    const segundos = (horas && horas.get(f.fecha)) || 0;
    let estado;
    if (f.fecha === hoy) estado = 'hoy';
    else if (!f.horas_at) estado = f.fecha < NUCLEO_DESDE ? 'sin-datos' : 'pendiente';
    else estado = segundos > UMBRAL_FESTIVO ? 'suma' : 'no-suma';
    return { fecha: f.fecha, nombre: f.nombre, ambito: f.ambito, segundos, estado };
  });
  const festivosSuman = lista.filter(f => f.estado === 'suma').length;

  const saldo = r2(generadas + festivosSuman - disfrutadas - diasPermiso);
  const ahora = vacaciones.find(v => v.desde <= hoy && (v.hasta || FIN) >= hoy);
  return {
    inicio, desdeElAlta: inicio === p.alta,
    diasNaturales, diasSuspension, diasQueGeneran, generadas,
    festivosSuman, festivosSinDatos: lista.filter(f => f.estado === 'sin-datos').length,
    festivosPendientes: lista.filter(f => f.estado === 'pendiente' || f.estado === 'hoy').length,
    disfrutadas, permisos: diasPermiso, saldo,
    programadas, permisosProgramados: permisoProgramado,
    saldoTras: r2(saldo - programadas - permisoProgramado),
    deVacacionesHasta: ahora ? ahora.hasta : null,
    detalle: { festivos: lista, vacaciones, permisos, suspensiones },
  };
}

/** Las piezas de la base para una o todas las personas. */
async function cargar({ id = null } = {}) {
  const gente = await repo.personas({ id });
  const ids = gente.map(p => p.id);
  let festivos, horas;
  try {
    [festivos, horas] = await Promise.all([repo.festivos(), repo.horasFestivos(ids)]);
  } catch (e) {
    if (e.code === '42P01') throw new Error('Falta aplicar la migración db/197 (el calendario de festivos).');
    throw e;
  }
  const tramos = await repo.tramos(ids, DESDE_HISTORICO);
  const porId = new Map(ids.map(i => [i, { tramos: [], horas: new Map() }]));
  tramos.forEach(t => porId.get(t.id).tramos.push(t));
  horas.forEach(h => porId.get(h.id).horas.set(h.fecha, Number(h.segundos)));
  return { gente, festivos, porId };
}

const contrato = p => (p.tipo === 'ett' ? `ETT${p.ett_nombre ? ' · ' + p.ett_nombre : ''}` : 'Propia');

/** La lista: una fila por persona con contrato abierto, con su saldo. */
async function lista({ hoy = hoyMadrid() } = {}) {
  const { gente, festivos, porId } = await cargar();
  const filas = gente.map(p => {
    const x = porId.get(p.id);
    const s = saldoDe(p, x.tramos, festivos, x.horas, hoy);
    delete s.detalle;
    return { id: p.id, nombre: p.nombre, dni: p.dni_nie || '', alta: p.alta, contrato: contrato(p), tipo: p.tipo, ...s };
  });
  return { filas, hoy, reglas: { tasa: TASA, desde: DESDE_HISTORICO, umbralHoras: UMBRAL_FESTIVO / 3600 } };
}

/** La ficha de una persona: el saldo y de dónde sale cada número. */
async function ficha(id, { hoy = hoyMadrid() } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Falta la persona');
  const { gente, festivos, porId } = await cargar({ id: n });
  if (!gente.length) {
    const [ett] = await repo.personas({ id: n, conEtt: true });
    throw new Error(ett
      ? `${ett.nombre} es de ETT: sus vacaciones se las da la agencia, no nosotros, así que aquí no lleva saldo.`
      : 'Esta persona no tiene un contrato abierto: no lleva saldo de vacaciones.');
  }
  const p = gente[0];
  const x = porId.get(p.id);
  return {
    id: p.id, nombre: p.nombre, dni: p.dni_nie || '', alta: p.alta, contrato: contrato(p), tipo: p.tipo, hoy,
    reglas: { tasa: TASA, desde: DESDE_HISTORICO, umbralHoras: UMBRAL_FESTIVO / 3600, nucleoDesde: NUCLEO_DESDE },
    ...saldoDe(p, x.tramos, festivos, x.horas, hoy),
  };
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
  if (nuevas.desde === t.desde && nuevas.hasta === t.hasta && !cambiaMotivo) {
    throw new Error('No has cambiado nada');
  }

  await plantilla.editarAusencia(Number(conductorId), Number(filaId), {
    desde: nuevas.desde, hasta: nuevas.hasta, ...(cambiaMotivo ? { motivo } : {}),
  }, quien);

  const tramo = f => `del ${ddmmaaaa(f.desde)} al ${ddmmaaaa(f.hasta)}`;
  if (t.ticket_id) {
    const nota = (nuevas.desde !== t.desde || nuevas.hasta !== t.hasta)
      ? `Vacaciones cambiadas desde Vacaciones: antes ${tramo(t)}, ahora ${tramo(nuevas)}.`
      : 'Vacaciones: cambiado el motivo desde Vacaciones.';
    await ticketera.anotarCambioDeVacaciones(t.ticket_id, {
      nota: nota + (cambiaMotivo ? ` Motivo: «${motivo || '(sin motivo)'}».` : ''),
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
  TASA, DESDE_HISTORICO, UMBRAL_FESTIVO, NUCLEO_DESDE, ASUNTOS_PROPIOS,
  lista, ficha, sellarFestivos, cambiarVacaciones,
  _saldoDe: saldoDe, _validarCambio: validarCambio,
};
