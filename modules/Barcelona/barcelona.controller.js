// ============================================================
// BARCELONA — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
//   /barcelona               el planificador (portada de la sede)
//   /barcelona/reportes      el reporte de horas (descargable)
//   /barcelona/visibilidad   las horas de la flota de Barcelona
//
// Sin clave en el catálogo de permisos a propósito: cualquiera que entre con la
// sede de Barcelona lo usa (Camilo, 07/10/2026). Ver services/sesion.js (SEDES).

const express = require('express');
const router = express.Router();
const barcelona = require('./barcelona.service');
const visibilidad = require('./visibilidad.service');
const actor = require('../../services/repo/actor');   // quién firma

const LAYOUT = 'layout-gestion';

/** Envoltorio: recoge el error y lo devuelve legible. */
const responde = (fn, codigo = 500) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [Barcelona] ${req.method} ${req.path}: ${e.stack || e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

/** Envoltorio de las descargas: el fichero, o el error legible. */
const descarga = (fn, mime) => async (req, res) => {
  try {
    const { bytes, nombre } = await fn(req);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(bytes);
  } catch (e) {
    console.error(`❌ [Barcelona] ${req.path}: ${e.stack || e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── Las pantallas ──────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.render('barcelona-planificador', { titulo: 'Barcelona · Planificador', seccion: 'bcn-planificador', layout: LAYOUT });
});

router.get('/reportes', (req, res) => {
  res.render('barcelona-reportes', { titulo: 'Barcelona · Reportes', seccion: 'bcn-reportes', layout: LAYOUT, hoy: barcelona.hoyMadrid() });
});

// LA VISIBILIDAD ES LA PANTALLA DE MADRID con sus datos: la misma vista, que
// pregunta a `api` en vez de a /visibilidad/api (ver visibilidad.service.js).
router.get('/visibilidad', (req, res) => {
  res.render('visibilidad', {
    titulo: 'Barcelona · Visibilidad', seccion: 'bcn-visibilidad', layout: LAYOUT,
    api: '/barcelona/api/visibilidad', sedeNombre: 'Barcelona',
  });
});

// ── El planificador ────────────────────────────────────────────────────────

router.get('/api/tablero', responde(req => barcelona.tablero({ fecha: req.query.fecha })));

router.post('/api/asignar', responde(async req => barcelona.asignar(req.body || {}, await actor.idDe(req)), 400));

// ── La Visibilidad ─────────────────────────────────────────────────────────

router.get('/api/visibilidad/resumen', responde(() => visibilidad.resumen()));
router.get('/api/visibilidad/serie', responde(req => visibilidad.serie(req.query.mes)));
router.get('/api/visibilidad/ultimos', responde(req => visibilidad.ultimosDias(Math.max(5, Math.min(60, Number(req.query.n) || 15)))));
router.post('/api/visibilidad/config', responde(async req => ({ config: await visibilidad.guardarConfig(req.body || {}) }), 400));

// ── El reporte de horas ────────────────────────────────────────────────────
//   /barcelona/reporte/excel                          → ayer
//   /barcelona/reporte/excel?desde=2026-10-01&hasta=2026-10-07

router.get('/reporte/excel', descarga(req => barcelona.reporteExcel({ desde: req.query.desde, hasta: req.query.hasta }), XLSX));

module.exports = router;
