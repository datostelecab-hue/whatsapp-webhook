// ============================================================
// CONTROL · SERVICIO — quién tenía que salir, quién salió y qué se hizo
// ============================================================
// Lo que el controlador tenía dentro y no le tocaba: la jornada con la que se
// mira todo, el orden en que se apunta una llamada, cómo se arma un informe de
// varios días y qué nombre lleva cada descargable.
//
// ── LAS SEIS COSAS QUE HAY QUE SABER ────────────────────────────────────────
//
// 1. TODO VA POR JORNADA OPERATIVA (05→05), no por fecha de calendario.
//    Es el mismo día para el plan, la actividad, las llamadas y las J. Cuando
//    no lo era, entre las 00:00 y las 05:00 se pintaban los badges del lunes
//    sobre el plan del martes y dos operadores llamaban al mismo conductor.
//    La jornada la dice `repo/llamadas.diaOperativoHoy()`, y es la única.
//
// 2. LA LLAMADA SE ESCRIBE UNA SOLA VEZ, en `llamada_seguimiento`. Hasta db/131
//    se copiaba además al Call Center con una clasificación clavada en el
//    código, así que allí todas las llamadas parecían la misma. Ahora el Call
//    Center las LEE de aquí y las clasifica por su tipo y su caso: una copia
//    envejece, una lectura no puede.
//
// 3. EL INFORME DEL HISTÓRICO SE CAMINA, NO SE RESTA. Cada día recalcula el
//    cockpit contra el núcleo (unos 5 s), así que hay un tope de 7: un mes de
//    una sentada serían dos minutos y medio de petición colgada. Y el calendario
//    se recorre día a día porque el día del cambio de hora tiene 23 o 25 horas
//    y restar bloques de 24 se salta una jornada.
//
// 4. LOS PARTES SE PIDEN DE UNO EN UNO. Cada uno ya paraleliza sus consultas por
//    dentro; lanzar siete a la vez ahoga el pool.
//
// 5. CAMPAÑAS SON DOS VISTAS DE LA MISMA COSA. El gestor ve la operativa (a
//    quién llamar); admin y desarrollador entran al informe (cómo va el día).
//    Quién ve qué es una regla, no una preferencia de pantalla, y vive aquí.
//
// 6. LA ASISTENCIA LLEGA HASTA AYER. La jornada de hoy no ha terminado y quien
//    entra a las 17:00 aún no ha faltado a nada. El periodo por defecto lo pone
//    el repositorio; aquí solo se respeta.

const { enDirecto } = require('./cockpit.service');
const rutas = require('../../services/flotaViva/rutas');
const llamadas = require('../../services/repo/llamadas');       // el "telefonito"
const repoJust = require('../../services/repo/justificantes');  // justificar: PostgreSQL
const campanasSrv = require('./campanas.service');
const historicoSrv = require('./historico.service');
const asistencia = require('./asistencia.repo');
const auditoriaLunes = require('./auditoriaLunes.repo');
const reporteTurnos = require('./reporteTurnos.service');
// El reporte de horas del día, con sus bandas de color (los datos, en
// `reporteHoras.repo`).
const justificantes = require('./reporteHoras.service');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = v => (ISO.test(v || '') ? v : null);

/** Hoy en Madrid, 'YYYY-MM-DD'. Fecha de CALENDARIO: solo para lo que pide un día suelto. */
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** La jornada operativa en curso (05→05). La que usa el cockpit y todo lo suyo. */
const diaOperativoHoy = () => llamadas.diaOperativoHoy();

/** El día pedido, o la jornada en curso. */
const diaDe = v => iso(v) || llamadas.diaOperativoHoy();

// Las horas que escribe una persona: "7,5" vale, "7.5" vale, "siete" no. Se
// devuelven como texto limpio; los límites los pone repo/justificantes.
const horasLimpias = h => (h == null || h === '') ? '' : String(h).trim().replace(',', '.');

// ── Lo que hace falta para pintar las pantallas ────────────────────────────

/**
 * El buzón de resultados y el catálogo de motivos viven EN EL SERVIDOR, no en
 * la vista: la misma lista la usan el cockpit, las campañas y el histórico, y
 * tres copias en tres .ejs se desincronizan al primer motivo nuevo.
 */
const paraLaPantalla = () => ({
  resultadosLlamada: llamadas.RESULTADOS,
  catalogoLlamada: llamadas.CATALOGO,
  tiposJ: repoJust.TIPOS_J,
});

/**
 * Qué pantalla de campañas le toca a quien mira. El informe enlaza a la vista
 * de gestor (`?vista=gestor`) para cuando quieran bajar al detalle.
 */
function vistaDeCampanas(rol, pedida) {
  const esAdmin = ['superadmin', 'desarrollador'].includes(rol || '');
  return {
    esAdmin,
    vista: esAdmin && pedida !== 'gestor' ? 'controlCampanasInforme' : 'controlCampanas',
    ...paraLaPantalla(),
  };
}

// ── El cockpit ─────────────────────────────────────────────────────────────

/**
 * EN DIRECTO: el plan del cuadrante fundido con la actividad real, más lo que
 * ya se ha hecho en esta jornada.
 *
 * Las llamadas y las J van con el MISMO día que el plan: es lo que evita que
 * dos operadores llamen dos veces al mismo conductor. Si alguna de las dos
 * falla, el cockpit sale igual —sin badges— en vez de no salir.
 */
async function directo({ dia } = {}) {
  const d = diaDe(dia);
  const base = await enDirecto({ dia: d });
  const [llam, justis] = await Promise.all([
    llamadas.resumenHoy(d).catch(() => ({})),
    llamadas.justificadosHoy(d).catch(() => ({})),
  ]);
  return { ...base, llamadas: llam, justificados: justis };
}

/**
 * EL AHORA DE CADA CONDUCTOR, para refrescar En directo cada 10 s.
 *
 * Sale de la FOTO DEL AHORA (services/flotaViva/ahora.js), la misma que lee el
 * mapa: no se calcula nada aquí y, si el mapa ya la ha pedido, ni siquiera se
 * consulta la base. Va compacto —[situación, desde] por cuenta de BOLT— porque
 * se pide muy a menudo; la pantalla lo pone encima de lo que ya tiene.
 */
async function ahora() {
  const f = await require('../../services/flotaViva/ahora').foto();
  const conductores = {};
  f.porConductor.forEach((x, uuid) => { conductores[uuid] = [x.situacion, x.desde]; });
  return { at: f.at, conductores };
}

// Las campañas van POR TURNO (?turno=dia|noche); sin él decide el reloj.
const turnoDe = q => (q === 'dia' || q === 'noche' ? q : undefined);

const campanas = ({ dia, turno } = {}) =>
  campanasSrv.estado({ dia: iso(dia) || undefined, turno: turnoDe(turno) });

/**
 * El informe de campañas: el estado (números, no gente) + las cuentas de
 * llamadas del día, del turno que el estado eligió (pedido o por reloj).
 */
async function campanasInforme({ dia, turno } = {}) {
  const d = diaDe(dia);
  const estado = await campanasSrv.estado({ dia: d, turno: turnoDe(turno) });
  return { ...estado, estadisticas: await llamadas.estadisticasHoy(d, estado.turno) };
}

// ── El histórico ───────────────────────────────────────────────────────────

const historico = dia => historicoSrv.parte(dia);

/**
 * Los trazos de una persona en una jornada concreta, con los km de cada uno.
 *
 * Es el mismo listado que En directo enseña al desplegar una fila, pero mirando
 * un día cerrado en vez de las últimas 24 h. Se pide al abrir el bloque y no
 * con el parte entero: son 20-30 líneas por persona y el parte trae ochenta.
 */
const trazos = (conductorId, dia) =>
  require('./panel.service').historialConductor(Number(conductorId), { dia })
    .then(historial => ({ historial }));

/**
 * TODAS las llamadas que se le han hecho a una persona, no las de ese día.
 *
 * No se calcula aquí: es la misma historia que enseña el Call Center en su
 * pestaña «Por conductor» —las de Control y las suyas, juntas y ordenadas—, y
 * dos formas de contar las llamadas de alguien acabarían diciendo cosas
 * distintas el día que una de las dos se quede sin tocar.
 *
 * Se sirve desde aquí y no desde /callcenter para que el permiso sea el de esta
 * pantalla: quien lleva el Histórico tiene que poder abrir el historial de
 * alguien sin que le den además el módulo de Call Center entero.
 */
const historialLlamadas = conductorId =>
  require('./callcenter.service').historiaConductor(Number(conductorId));

// Cada día del informe recalcula el cockpit entero (unos 5 s). Ver la nota 3.
const MAX_DIAS_INFORME = 7;

/** El día siguiente, caminando el calendario. No se restan bloques de 24 h. */
function diaSiguiente(d) {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd, 12) + 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * EL INFORME DEL HISTÓRICO. Un día por defecto; con `desde`/`hasta` apila
 * varios en las mismas hojas con la fecha delante, para la tabla dinámica.
 */
async function historicoExcel({ desde, hasta, dia } = {}) {
  const arranque = iso(desde) || iso(dia) || diaOperativoHoy();
  const fin = iso(hasta) || arranque;
  if (fin < arranque) throw new Error('El "hasta" es anterior al "desde"');

  const dias = [];
  for (let d = arranque; d <= fin && dias.length < MAX_DIAS_INFORME; d = diaSiguiente(d)) dias.push(d);

  const partes = [];
  for (const d of dias) partes.push(await historicoSrv.parte(d));   // de uno en uno: ver la nota 4

  const bytes = await require('./historico.excel').generar(partes);
  const total = partes.reduce((a, p) => ({
    llamadas: a.llamadas + p.resumen.llamadas,
    noSalieron: a.noSalieron + p.resumen.noSalieron,
    alertas: a.alertas + p.conductores.reduce((n, c) => n + c.alertas.length, 0),
  }), { llamadas: 0, noSalieron: 0, alertas: 0 });
  console.log(`📊 [Control] histórico (Excel) ${dias[0]}→${dias[dias.length - 1]}: ` +
    `${total.noSalieron} no salieron · ${total.alertas} alertas · ${total.llamadas} llamadas`);

  const nombre = `control-historico-${dias[0]}` +
    (dias.length > 1 ? `-a-${dias[dias.length - 1]}` : '') + '.xlsx';
  return { bytes, nombre };
}

// ── Las llamadas de seguimiento ────────────────────────────────────────────

/**
 * APUNTAR UNA LLAMADA. Se escribe UNA VEZ, en `llamada_seguimiento`.
 *
 * Hasta db/131 esto escribía además un espejo en el Call Center, y el espejo
 * mentía: la clasificación iba clavada en el código, así que una avería en ruta
 * y un conductor que no coge el teléfono entraban al Call Center como la misma
 * cosa. Ahora el Call Center LEE estas llamadas y las clasifica por su tipo y
 * su caso. Una llamada, una fila, un sitio.
 *
 * `origen` dice en qué pasada se etiquetó a cada uno: el cockpit ('control') o
 * la campaña 1, 2 o 3.
 */
async function apuntarLlamada(b, usuario, usuarioId) {
  const u = usuario || {};
  const r = await llamadas.registrar({
    conductorId: b.conductorId, turno: b.turno, resultado: b.resultado, nota: b.nota,
    tipo: b.tipo, alertas: b.alertas, matricula: b.matricula,
    origen: /^campana[123]$/.test(b.origen || '') ? b.origen : 'control',
    usuarioId: u.id || usuarioId,
    // La jornada que está mirando quien llama, para que la llamada caiga en la
    // misma carta donde se apuntó (de madrugada no es la fecha de hoy).
    dia: iso(b.dia) || undefined,
  });

  console.log(`📞 [Control] Llamada apuntada · conductor ${b.conductorId} · ` +
    `${b.resultado || 'sin resultado'} · ${u.nombre || ''}`);
  return r;
}

/** Las llamadas de un rango de días (la lista del Histórico). */
const listarLlamadas = ({ desde, hasta } = {}) => llamadas.listar({ desde, hasta });

/**
 * JUSTIFICAR DESDE EL COCKPIT, por conductor_id y para la jornada en curso. La
 * carta enseña luego "J · X h · quién", que es lo que le dice al segundo
 * operador que no hace falta volver a llamar.
 */
async function justificarEnDirecto(b, usuario, usuarioId) {
  const dia = diaDe(b.dia);
  const r = await repoJust.guardarPorId({
    conductorId: b.conductorId, diaIso: dia,
    horas: horasLimpias(b.horas),
    observacion: b.observacion,
    tipo: b.tipo,
    usuarioId: (usuario && usuario.id) || usuarioId,
  });
  console.log(`📝 [Control] J en directo · ${dia} · conductor ${r.conductorId} ` +
    `(${b.horas || 'sin'} h) · ${(usuario || {}).nombre || ''}`);
  return { dia, ...r };
}

// ── KM y traza ─────────────────────────────────────────────────────────────

/** El km CONECTADO vs DESCONECTADO por conductor. Del núcleo, no del `mileage`. */
const kmTraza = (dia, turno) => rutas.kmConectadoDesconectado(
  iso(dia) || hoyMadrid(), ['dia', 'noche', 'completo'].includes(turno) ? turno : 'completo');

/**
 * POR QUÉ una matrícula sale (o no) con km en el reporte: traza los tres cruces
 * del núcleo (fv_ruta / fv_vehiculo.mapon_unit / fv_tramo) y dice dónde se corta.
 *
 * El turno por defecto es 'operativo' (05→05), el mismo que el reporte de horas.
 * Con `conMapon` se le pregunta además a Mapon por la ventana exacta, que es lo
 * que cierra la bifurcación "hueco de ingesta vs. baliza caída".
 */
function kmDiagnostico({ dia, turno, mats, nombres, conMapon } = {}) {
  const lista = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  const m = lista(mats), n = lista(nombres);
  if (!m.length && !n.length) throw new Error('Falta ?mats= (matrículas) o ?nombre= (conductor)');
  return rutas.diagnosticoKm(iso(dia) || hoyMadrid(), m,
    ['dia', 'noche', 'completo', 'operativo'].includes(turno) ? turno : 'operativo',
    { conMapon, nombres: n });
}

// ── Asistencia ─────────────────────────────────────────────────────────────

/** Quién faltó y cuántas veces. Ver la nota 6. */
async function asistenciaPdf({ desde, hasta } = {}) {
  const datos = await asistencia.faltas({ desde, hasta });
  const bytes = await require('./asistencia.pdf').generar(datos);
  console.log(`📄 [Control] asistencia ${datos.desde}→${datos.hasta}: ` +
    `${datos.reincidentes.length} con faltas de ${datos.todos.length}`);
  return { bytes, nombre: `asistencia-${datos.desde}-a-${datos.hasta}.pdf` };
}

/** El mismo reporte en Excel: es el que se usa de verdad (se ordena y se filtra). */
async function asistenciaExcel({ desde, hasta } = {}) {
  const datos = await asistencia.faltas({ desde, hasta });
  const bytes = await require('./asistencia.excel').generar(datos);
  console.log(`📊 [Control] asistencia (Excel) ${datos.desde}→${datos.hasta}: ` +
    `${datos.reincidentes.length} con faltas de ${datos.todos.length}`);
  return { bytes, nombre: `asistencia-${datos.desde}-a-${datos.hasta}.xlsx` };
}

const asistenciaPeriodo = () => asistencia.periodoPorDefecto();

/**
 * LA AUDITORÍA DE LOS LUNES, sin tarjeta a propósito: se pidió como un vistazo
 * puntual, no como un reporte de cada semana. Se baja por URL.
 */
async function auditoriaLunesExcel(lunes) {
  const datos = await auditoriaLunes.informe({ lunes });
  const bytes = await require('./auditoriaLunes.excel').generar(datos);
  console.log(`📊 [Control] auditoría de lunes ${datos.dias.join(', ')}: ` +
    `${datos.conductores.length} conductores · ${datos.totales.faltas} faltas · ` +
    `${datos.detalle.length} casos a mirar`);
  return { bytes, nombre: `auditoria-lunes-${datos.dias[0]}-a-${datos.dias[datos.dias.length - 1]}.xlsx` };
}

// ── Los descargables del día ───────────────────────────────────────────────
// `dia` aquí NO es una fecha: es la clave 1|2|3 del reporte de horas (hoy, ayer,
// anteayer), que es como lo pide la pantalla desde que existe.

const claveDia = d => ([1, 2, 3].includes(Number(d)) ? Number(d) : 1);

/** El reporte del día con las bandas de color en la celda de horas. */
async function reporteHorasExcel(dia) {
  const rep = await justificantes.reporteDia(claveDia(dia));
  const bytes = await justificantes.excelDia(rep);
  return { bytes, nombre: `reporte-horas-${rep.fecha.replace(/\//g, '-')}.xlsx` };
}

const { DIAS_LARGOS: DIAS_SEMANA } = require('../../services/nucleo');

/** La fecha de la clave 1|2|3, en ISO y en texto, con su día de la semana. */
function fechaDeClave(dia) {
  const { Y, M, D, str, idx } = justificantes.fechaDeClave(claveDia(dia));
  return { iso: `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`, str, diaSemana: DIAS_SEMANA[idx] };
}

/**
 * LA CASCADA: el mismo dato que el Sankey, contado como una cuenta de
 * resultados. Se hizo porque dirección no leía el Sankey —hay que explicar cómo
 * se sigue una cinta de grosor variable— y un gráfico que hay que explicar no
 * sirve para una reunión. El Sankey se queda para quien lo prefiera.
 */
async function cascadaPdf(dia) {
  const f = fechaDeClave(dia);
  const s = await rutas.sankeyFlota(f.iso);
  const bytes = await require('./kmCascada.pdf').generarPdfCascada({
    titulo: `${f.diaSemana} ${f.str} · jornada completa`,
    subtitulo: 'Cada kilómetro que rodó la flota de Madrid, repartido por lo que estaba haciendo el conductor en ese momento.',
    tramos: s.tramos, matriculas: s.matriculas,
  });
  return { bytes, nombre: `km-cascada-${f.str.replace(/\//g, '-')}.pdf` };
}

/** El Sankey. Reutiliza el generador de la Auditoría; el dato va POR MATRÍCULA. */
async function sankeyPdf(dia) {
  const { generarPdfFlujo } = require('../../services/auditoriaPdf');
  const { rgb } = require('pdf-lib');
  const f = fechaDeClave(dia);
  const s = await rutas.sankeyFlota(f.iso);
  // El color de cada turno se pone aquí (tenemos pdf-lib): día verde, noche azul.
  const tramos = s.tramos.map((t, i) => ({ ...t, color: i === 0 ? rgb(0.13, 0.70, 0.45) : rgb(0.38, 0.65, 0.98) }));
  const bytes = await generarPdfFlujo({
    titulo: `Flujo de KM · ${f.diaSemana} ${f.str}`,
    subtitulo: 'En BOLT (viaje + espera) vs desconectado (descanso + apagado). Por coche, sin duplicar. Solo la flota de Madrid.',
    rango: f.str, tramos, matriculas: s.matriculas,
    // BOLT en vivo marca "en viaje" desde que acepta hasta que deja al pasajero:
    // la ida a recoger va DENTRO de ese km, no separada. Ponía "Con pasajero ·
    // 0 de camino", que se leía como que nadie fue a recoger.
    etiquetas: { totalPasajero: 'En viaje (con pasajero o de camino)' },
  });
  return { bytes, nombre: `sankey-km-${f.str.replace(/\//g, '-')}.pdf` };
}

/**
 * Turnos de hoy (solo noche) + los N días siguientes con las dos tablas.
 * Pensado para el viernes: llevar impreso quién sale el sábado y el domingo.
 */
async function turnosExcel({ dias, desde } = {}) {
  const n = Math.min(Math.max(Number(dias) || 2, 0), 6);
  const { buffer, nombre } = await require('./turnos.excel').generarExcelTurnos({ dias: n, desde });
  return { bytes: buffer, nombre: `${nombre}.xlsx` };
}

/**
 * LA PARRILLA del planificador (formato ANEXO): por CORRETURNO, cada coche con
 * su descanso, matrícula y las 4 plazas (fijo/CT × día/noche) con teléfono y
 * zona. Sale del planificador REAL (PostgreSQL), no de las hojas.
 */
async function parrillaExcel(dia) {
  const d = iso(dia) || hoyMadrid();
  return { bytes: await require('../Planificacion/tablero.service').parrilla(d),
    nombre: `Planificador_${d}.xlsx` };
}

/**
 * REPORTE POR TURNOS (5-5): quién rodó de 05:00→17:00 y de 17:00→05:00, con
 * horas, matrícula y los NN incluidos. Del núcleo (fv_*), no de las hojas.
 */
async function reporteTurnosExcel(dia) {
  const d = iso(dia) || hoyMadrid();
  const reporte = await reporteTurnos.datos(d);
  return { bytes: await reporteTurnos.excelTurnos(reporte), nombre: `Reporte_turnos_${d}.xlsx` };
}

module.exports = {
  hoyMadrid, diaOperativoHoy,
  paraLaPantalla, vistaDeCampanas,
  directo, ahora, campanas, campanasInforme,
  historico, historicoExcel, trazos, historialLlamadas,
  apuntarLlamada, listarLlamadas, justificarEnDirecto,
  kmTraza, kmDiagnostico,
  asistenciaPdf, asistenciaExcel, asistenciaPeriodo, auditoriaLunesExcel,
  reporteHorasExcel, cascadaPdf, sankeyPdf,
  turnosExcel, parrillaExcel, reporteTurnosExcel,
};
