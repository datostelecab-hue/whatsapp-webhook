// ============================================================
// CONTROL — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada: ni qué jornada es, ni
// qué vista le toca a cada rol, ni cómo se llama un fichero.
//
//   /control              el cockpit "En directo"
//   /control/campanas     las tres pasadas de llamadas de la mañana
//   /control/historico    lo que pasó un día y lo que se hizo con ello
//   /control/km           km conectado vs desconectado
//   /control/reportes     solo descargables
//
// El "Tablero clásico" (leía las horas de la hoja Datos_API) se RETIRÓ: manda el
// cockpit "En directo" (PostgreSQL) y lo exportable vive en Reportes. Las dos
// listas en pantalla que tenía Reportes ("Quién sale — para llamar" y "Control
// del día") se quitaron el 07/09/2026: lo que se mira en vivo está en el
// cockpit, con el telefonito y la J al lado de cada uno. Con el tablero se
// fueron sus rutas huérfanas: el POST /excel (exportaba filas que ya no mandaba
// nadie), el POST /enviar-ws (mandaba hasta 200 plantillas de WhatsApp a los
// números que llegaran en el cuerpo, sin ningún botón detrás), y /justificar +
// /justificantes por NOMBRE (la J va por id desde el cockpit y la bitácora).

const express = require('express');
const router = express.Router();
const control = require('./control.service');
const actor = require('../../services/repo/actor');   // quién firma (id por email si la cookie es vieja)

/** Envoltorio: recoge el error y lo devuelve legible, sin repetirlo veinte veces. */
const responde = (fn, codigo = 500) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [Control] ${req.method} ${req.path}: ${e.stack || e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

/** Un descargable: el servicio dice los bytes y el nombre, aquí solo se sirven. */
const descarga = (fn, mime) => async (req, res) => {
  try {
    const { bytes, nombre } = await fn(req);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(bytes);
  } catch (e) {
    console.error(`❌ [Control] ${req.path}: ${e.stack || e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF = 'application/pdf';

// ── Las pantallas ──────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.render('controlDirecto', {
    titulo: 'Control · En directo', seccion: 'control', layout: 'layout-gestion',
    ...control.paraLaPantalla(),
  });
});

router.get('/campanas', (req, res) => {
  const { vista, ...datos } = control.vistaDeCampanas((req.usuario || {}).rol, req.query.vista);
  res.render(vista, {
    titulo: 'Control · Campañas', seccion: 'control', layout: 'layout-gestion', ...datos,
  });
});

router.get('/historico', (req, res) => {
  res.render('controlHistorico', {
    titulo: 'Control · Histórico', seccion: 'control', layout: 'layout-gestion',
    hoy: control.diaOperativoHoy(),
  });
});

router.get('/km', (req, res) => {
  res.render('kmTraza', { titulo: 'Control · KM y traza', seccion: 'control', layout: 'layout-gestion' });
});

router.get('/reportes', (req, res) => {
  res.render('reportes', { titulo: 'Control · Reportes', seccion: 'control', layout: 'layout-gestion' });
});

// ── Lectura ────────────────────────────────────────────────────────────────

router.get('/api/directo', responde(req => control.directo({ dia: req.query.dia })));

router.get('/api/campanas', responde(req =>
  control.campanas({ dia: req.query.dia, turno: req.query.turno })));

router.get('/api/campanas-informe', responde(req =>
  control.campanasInforme({ dia: req.query.dia, turno: req.query.turno })));

router.get('/api/historico', responde(req => control.historico(req.query.dia)));

router.get('/api/km-traza', responde(req => control.kmTraza(req.query.dia, req.query.turno)));

// Ej: /control/api/km-diagnostico?dia=2026-09-01&mats=9521MMX,6663LCY&mapon=1
router.get('/api/km-diagnostico', responde(req => control.kmDiagnostico({
  dia: req.query.dia, turno: req.query.turno,
  mats: req.query.mats || req.query.mat,
  nombres: req.query.nombres || req.query.nombre,
  conMapon: req.query.mapon === '1' || req.query.mapon === 'true',
})));

router.get('/api/llamadas', responde(req =>
  control.listarLlamadas({ desde: req.query.desde, hasta: req.query.hasta })));

router.get('/asistencia/periodo', responde(() => control.asistenciaPeriodo()));

// ── Escritura ──────────────────────────────────────────────────────────────

router.post('/api/llamada', responde(async req =>
  control.apuntarLlamada(req.body || {}, req.usuario, await actor.idDe(req)), 400));

router.post('/api/justificar-directo', responde(async req =>
  control.justificarEnDirecto(req.body || {}, req.usuario, await actor.idDe(req)), 400));

// ── Los descargables ───────────────────────────────────────────────────────

router.get('/historico/excel', descarga(req =>
  control.historicoExcel({ desde: req.query.desde, hasta: req.query.hasta, dia: req.query.dia }), XLSX));

router.get('/asistencia/pdf', descarga(req =>
  control.asistenciaPdf({ desde: req.query.desde, hasta: req.query.hasta }), PDF));

router.get('/asistencia/excel', descarga(req =>
  control.asistenciaExcel({ desde: req.query.desde, hasta: req.query.hasta }), XLSX));

//   /control/auditoria-lunes/excel            → los 4 últimos lunes
//   /control/auditoria-lunes/excel?lunes=8    → los 8 últimos (máximo 12)
router.get('/auditoria-lunes/excel', descarga(req =>
  control.auditoriaLunesExcel(req.query.lunes), XLSX));

router.get('/reporte/excel', descarga(req => control.reporteHorasExcel(req.query.dia), XLSX));
router.get('/cascada/pdf', descarga(req => control.cascadaPdf(req.query.dia), PDF));
router.get('/sankey/pdf', descarga(req => control.sankeyPdf(req.query.dia), PDF));

router.get('/turnos/excel', descarga(req =>
  control.turnosExcel({ dias: req.query.dias, desde: req.query.desde }), XLSX));

router.get('/planificador/excel', descarga(req => control.parrillaExcel(req.query.dia), XLSX));
router.get('/reporte-turnos/excel', descarga(req => control.reporteTurnosExcel(req.query.dia), XLSX));

module.exports = router;
