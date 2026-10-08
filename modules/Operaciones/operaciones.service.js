// ============================================================
// OPERACIONES · SERVICIO — las alertas del coche y la auditoría de flota
// ============================================================
// Qué hace la flota cuando nadie mira: los avisos de Mapon (exceso, frenazo,
// golpe) y la auditoría que cruza los km del GPS con los que BOLT factura.
//
// ── LAS CUATRO COSAS QUE HAY QUE SABER ──────────────────────────────────────
//
// 1. LAS ALERTAS YA NO SE LE PIDEN A MAPON AQUÍ. Las trae la ingesta cada 15
//    minutos y aquí se leen de PostgreSQL. Antes la pantalla llamaba a Mapon en
//    CADA carga: si Mapon estaba caído no decía "esto es de hace un rato",
//    decía error; y como la ventana de su API es de 31 días, lo anterior no
//    existía para nadie. Por eso se sirve también la FRESCURA: es lo que
//    distingue "no ha pasado nada" de "hace rato que no llega nada".
//
// 2. EL TÍTULO Y EL ICONO DE CADA TIPO SON PRESENTACIÓN, y se ponen aquí y no
//    en la tabla: cambiar cómo se llama un tipo en pantalla no puede exigir una
//    migración ni reescribir el histórico.
//
// 3. LA AUDITORÍA SE SIRVE DEL HISTÓRICO. Solo hoy y ayer tocan las APIs; el
//    resto ya está calculado. Reprocesar es PESADO —una llamada a Mapon por
//    coche y día—, así que va en segundo plano y el panel sondea el progreso.
//
// 4. HAY PARADA DE EMERGENCIA, y no es un adorno: un backfill largo consume
//    mucha cuota de Google y puede dejar sin servicio al resto del ERP (el
//    login también lee de Sheets). Se acepta por GET a propósito, para poder
//    cortarlo desde la barra del navegador sin reiniciar nada.

const { TIPOS, UMBRAL, MAX_DIAS } = require('../../services/mapon');
const alertas = require('./alertasMapon.repo');
const auditoria = require('./auditoria.service');

// ── Las alertas de Mapon ───────────────────────────────────────────────────

const paraLaPantalla = () => ({ tipos: TIPOS, umbral: UMBRAL, maxDias: MAX_DIAS });

/** El rango que se mira. Por defecto los últimos 7 días, como siempre. */
function rangoAlertas(desde, hasta) {
  const iso = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
  const esDia = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const esES = v => /^\d{2}\/\d{2}\/\d{4}$/.test(v || '');
  const aIso = v => (esES(v) ? v.slice(6) + '-' + v.slice(3, 5) + '-' + v.slice(0, 2) : v);
  const d = esDia(aIso(desde)) ? aIso(desde) : iso(new Date(Date.now() - 7 * 86400000));
  const h = esDia(aIso(hasta)) ? aIso(hasta) : iso(new Date());
  return { desde: `${d}T00:00:00+02:00`, hasta: `${h}T23:59:59+02:00`, d, h };
}

// Mil alertas ya son más de las que nadie lee de una sentada; lo que importa es
// DECIRLO, para que quien mire sepa que hay más detrás y acote el rango.
const TOPE = 1000;

async function listarAlertas({ desde, hasta, tipo } = {}) {
  const r = rangoAlertas(desde, hasta);
  const [lista, tipos, frescura] = await Promise.all([
    alertas.listar({ ...r, tipo }),
    alertas.porTipo(r),
    alertas.frescura(),
  ]);
  console.log(`🛰️  [OPERACIONES] ${lista.length} alertas (${tipo || 'todas'}) ${r.d} → ${r.h}`);
  return {
    alertas: lista.map(a => ({
      ...a,
      tipoTitulo: (TIPOS[a.tipo] && TIPOS[a.tipo].titulo) || a.tipo,
      icono: (TIPOS[a.tipo] && TIPOS[a.tipo].icono) || 'fa-circle-exclamation',
    })),
    tipos, frescura, total: lista.length, umbral: UMBRAL, desde: r.d, hasta: r.h,
    truncado: lista.length >= TOPE,
  };
}

/**
 * Diagnóstico: con qué límite está avisando Mapon ahora mismo. Es una pregunta
 * a Mapon SOBRE MAPON —su configuración, no sus datos—, así que vive en la
 * herramienta y no aquí: la ingesta no puede traer algo que no es un dato.
 */
const setups = async () => ({ setups: await require('./mapon.diagnostico').setups() });

// ── La auditoría de flota ──────────────────────────────────────────────────

async function datosDeAuditoria({ desde, hasta } = {}) {
  const r = await auditoria.cargarAuditoria({ desde, hasta });
  console.log(`📊 [OPERACIONES] auditoría: ${r.km.length} matrículas · ${r.eventos.length} repostajes · ` +
    `${r.dias.length} días · ${r.refrescados} refrescados`);
  return r;
}

/**
 * El mismo rango, pero PREGUNTADO POR PERSONA. No existía: con el histórico en
 * una hoja de cálculo los conductores iban en una celda separados por comas y no
 * había forma de ir de la persona a sus kilómetros. Ahora es una consulta.
 */
async function porConductor({ desde, hasta, tramo } = {}) {
  const { ini, fin } = auditoria.resolverRango({ desde, hasta });
  const dias = auditoria.ejeDias(ini, fin);
  return { filas: await auditoria.porConductor({
    desde: dias[0], hasta: dias[dias.length - 1], tramo, limite: 200,
  }) };
}

const hayProcesadoEnMarcha = () => auditoria.progreso().activo;
const progreso = () => auditoria.progreso();
const detener = () => auditoria.detener();

/**
 * Procesar (o reprocesar) días. Lo normal lo hace la ingesta de madrugada; esto
 * es para el backfill o para rehacer un día concreto.
 *
 * Se admite la LISTA de días pendientes —no tienen por qué ser contiguos—: así
 * no se reprocesan de balde los días buenos que haya en medio.
 */
function lanzarProcesado({ desde, hasta, dias } = {}) {
  auditoria.procesarRango({ desde, hasta, dias })
    .catch(e => console.error('❌ [AUDITORÍA] procesar:', e.message));
}

// ── Los descargables ───────────────────────────────────────────────────────

/** Una tabla de la auditoría en Excel. Ver `auditoria.excel`: uno por tabla. */
async function excelDeAuditoria({ desde, hasta, tabla } = {}) {
  const r = await auditoria.cargarAuditoria({ desde, hasta });
  return require('./auditoria.excel').generar(r, tabla || 'dia');
}

/** El Sankey en PDF. ?flujo=turnos (05-17/17-05) o ?flujo=mitades (00-12/12-24). */
async function pdfDeFlujo({ desde, hasta, flujo } = {}) {
  const r = await auditoria.cargarAuditoria({ desde, hasta });
  const { generarPdfFlujo, totalesDe } = require('../../services/auditoriaPdf');
  const { diaES, fecha } = require('./auditoria.excel');
  const { rgb } = require('pdf-lib');

  const porMitades = String(flujo) === 'mitades';
  const defs = porMitades
    ? {
        titulo: 'Flujo de kilómetros · día natural partido a mediodía',
        subtitulo: 'Día de 00:00 a 24:00, dividido en primera mitad (00–12) y segunda mitad (12–24).',
        tramos: [
          { seg: 'manana', txt: '00:00 - 12:00', color: 'gold' },
          { seg: 'tarde', txt: '12:00 - 24:00', color: 'azul' },
        ],
      }
    : {
        titulo: 'Flujo de kilómetros · por turno',
        subtitulo: 'Turno de día 05:00–17:00 y turno de noche 17:00–05:00 del día siguiente.',
        tramos: [
          { seg: 'dia', txt: 'Turno de día', color: 'gold' },
          { seg: 'noche', txt: 'Turno de noche', color: 'azul' },
        ],
      };

  const COLOR = { gold: rgb(0.91, 0.72, 0.29), azul: rgb(0.38, 0.65, 0.98) };
  const tramos = defs.tramos.map(t => ({
    txt: t.txt, color: COLOR[t.color], tot: totalesDe((r.segmentos && r.segmentos[t.seg]) || []),
  }));
  const matriculas = new Set(defs.tramos
    .flatMap(t => (r.segmentos && r.segmentos[t.seg]) || []).map(k => k.placa)).size;

  const bytes = await generarPdfFlujo({
    titulo: defs.titulo, subtitulo: defs.subtitulo,
    rango: `${fecha(diaES(r.desde))} → ${fecha(diaES(r.hasta))}`,
    tramos, matriculas,
  });
  return { bytes, nombre: `flujo-km-${porMitades ? 'mitades' : 'turnos'}-${diaES(r.desde)}-a-${diaES(r.hasta)}.pdf` };
}

// ── Las dos pasadas de la ingesta ──────────────────────────────────────────
// Entran por aquí y no por los repositorios: `services/ingesta.js` está fuera
// del módulo, y la puerta es lo único que permite cambiar esto por dentro.

/**
 * LAS ALERTAS DE MAPON, cada 15 minutos. Dos días de ventana: sobra solape, y
 * el solape no cuesta nada porque las repetidas se descartan por su clave.
 */
async function pasadaDeAlertas() {
  const mapon = require('../../services/mapon');
  const staging = require('../../services/repo/staging');
  const t0 = Date.now();
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 2 * 86400000);
  const { alertas: traidas } = await mapon.leerAlertas({ desde, hasta: hoy });
  const descargaId = await staging.registrarDescarga({
    fuente: 'mapon', endpoint: 'alert/list.json (todas)',
    params: { desde: desde.toISOString(), hasta: hoy.toISOString() },
    payload: traidas, filas: traidas.length, ms: Date.now() - t0,
  });
  const nuevas = await alertas.guardar(traidas, descargaId);
  return { registros: nuevas, detalle: { traidas: traidas.length, nuevas } };
}

/**
 * LA AUDITORÍA DIARIA. Es la tarea más cara con diferencia —una llamada a Mapon
 * por coche—, así que va una vez al día, de madrugada.
 *
 * Y SE CURA SOLA: si ayer ya está, se ocupa del día pendiente más antiguo de la
 * última semana. Uno por vuelta —cada día son ~20 segundos y 144 llamadas, y no
 * hay prisa por recuperar la semana de un golpe—. Un fallo suelto deja de
 * necesitar que alguien lo vea.
 */
async function pasadaDiaria() {
  const repo = require('./auditoria.repo');
  const hoy = auditoria.hoyMadrid();
  const ayer = auditoria.diaMenos(hoy, 1);

  // Los últimos 7 días cerrados: ayer y los seis anteriores.
  const ventana = [];
  for (let i = 1; i <= 7; i++) ventana.push(auditoria.diaMenos(hoy, i));
  const buenos = new Set((await repo.dias({ desde: ventana[ventana.length - 1], hasta: ayer }))
    .filter(d => d.ok).map(d => d.dia));

  // Ayer manda; si ya está, el hueco más viejo.
  const pendientes = ventana.filter(d => !buenos.has(d)).sort();
  const dia = !buenos.has(ayer) ? ayer : pendientes[0];
  if (!dia) return { registros: 0, detalle: { nada: 'los últimos 7 días ya están calculados' } };

  try {
    const r = await auditoria.procesarDia(dia);
    return { registros: r.filas, detalle: { dia, repostajes: r.eventos, recuperado: dia !== ayer } };
  } catch (e) {
    await repo.marcarFallo(dia, e.message).catch(() => {});
    throw new Error(`${dia}: ${e.message}`);
  }
}

module.exports = {
  paraLaPantalla, listarAlertas, setups,
  datosDeAuditoria, porConductor,
  lanzarProcesado, hayProcesadoEnMarcha, progreso, detener,
  excelDeAuditoria, pdfDeFlujo,
  pasadaDeAlertas, pasadaDiaria,
};
