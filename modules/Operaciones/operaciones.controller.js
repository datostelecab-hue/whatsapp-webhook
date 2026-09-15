// ============================================================
// OPERACIONES — controlador
// ============================================================
//   /operaciones                     las alertas de Mapon
//   /operaciones/auditoria           KM del GPS vs KM facturado, y repostajes
//   /operaciones/fichaje/diagnostico la herramienta de Mapon (por URL, sin botón)

const express = require('express');
const router = express.Router();
const operaciones = require('./operaciones.service');

const responde = (fn, codigo = 400) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [OPERACIONES] ${req.method} ${req.path}: ${e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

const descarga = (fn, mime) => async (req, res) => {
  try {
    const { bytes, nombre } = await fn(req);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(bytes);
  } catch (e) {
    console.error(`❌ [OPERACIONES] ${req.path}: ${e.stack || e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── Alertas de Mapon ───────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.render('operaciones', {
    titulo: 'Alertas Mapon', seccion: 'operaciones', layout: 'layout-gestion',
    ...operaciones.paraLaPantalla(),
  });
});

router.get('/api/alertas', responde(req => operaciones.listarAlertas({
  desde: req.query.desde, hasta: req.query.hasta, tipo: req.query.tipo,
})));

router.get('/api/setups', responde(() => operaciones.setups(), 500));

// ── Auditoría de flota ─────────────────────────────────────────────────────

router.get('/auditoria', (req, res) => {
  res.render('auditoriaFlota', {
    titulo: 'Auditoría de flota', seccion: 'auditoria', layout: 'layout-gestion',
    maxDias: operaciones.paraLaPantalla().maxDias,
  });
});

router.get('/api/auditoria', responde(req =>
  operaciones.datosDeAuditoria({ desde: req.query.desde, hasta: req.query.hasta })));

router.get('/api/auditoria/conductores', responde(req => operaciones.porConductor({
  desde: req.query.desde, hasta: req.query.hasta, tramo: req.query.tramo,
})));

// Es PESADO —una llamada a Mapon por coche y día—, así que corre en segundo
// plano y el panel sondea el progreso.
router.post('/auditoria/procesar', (req, res) => {
  if (operaciones.hayProcesadoEnMarcha()) {
    return res.status(409).json({ status: 'error', msg: 'Ya hay un procesado en marcha' });
  }
  const b = req.body || {};
  operaciones.lanzarProcesado({ desde: b.desde, hasta: b.hasta, dias: b.dias });
  res.json({ status: 'ok', msg: 'Procesado iniciado' });
});

router.get('/auditoria/procesar/estado', (req, res) =>
  res.json({ status: 'ok', progreso: operaciones.progreso() }));

// Parada de emergencia. Se acepta por GET a propósito, para poder cortar un
// backfill largo desde la barra del navegador sin reiniciar nada.
const parar = (req, res) => res.json({ status: 'ok', ...operaciones.detener() });
router.post('/auditoria/procesar/detener', parar);
router.get('/auditoria/procesar/detener', parar);

// ── Los descargables ───────────────────────────────────────────────────────
// ?tabla= tramo (dia|noche|manana|tarde|completo) · resumen-turnos · detalle-dia
// · repostajes · ofensores. Por defecto, el turno de día.

router.get('/auditoria/excel', descarga(req => operaciones.excelDeAuditoria({
  desde: req.query.desde, hasta: req.query.hasta, tabla: req.query.tabla,
}), XLSX));

router.get('/auditoria/pdf', descarga(req => operaciones.pdfDeFlujo({
  desde: req.query.desde, hasta: req.query.hasta, flujo: req.query.flujo,
}), 'application/pdf'));

// ── La herramienta de Mapon ────────────────────────────────────────────────
// Solo lectura por omisión; las opciones que actúan sobre un coche están
// documentadas una a una en `mapon.diagnostico`. Sin `status: 'ok'`: se lee
// como un volcado, no como una respuesta de API.

router.get('/fichaje/diagnostico', async (req, res) => {
  try { res.json(await require('./mapon.diagnostico').diagnostico(req.query || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
