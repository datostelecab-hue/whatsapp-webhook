// ============================================================
// ALERTAS DE CONTROL — controlador
// ============================================================
// Ver las alertas y el histórico va con el permiso '/alertas'. CAMBIAR quién
// las recibe y los umbrales va con '/alertas/config', que nace apagado para
// todo el mundo (`manual` en el catálogo): lo reparte el desarrollador uno a
// uno. Era el requisito: "solo yo elijo a quién le llegan".

const express = require('express');
const router = express.Router();
const alertas = require('./alertas.service');
const actor = require('../../services/repo/actor');

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [ALERTAS] ${req.method} ${req.path}: ${e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', (req, res) => {
  res.render('alertas', {
    titulo: 'Alertas de control',
    seccion: 'alertas',
    layout: 'layout-gestion',
  });
});

router.get('/api/estado', responde(req => alertas.estado({ dia: req.query.dia })));

router.get('/api/historial', responde(req => alertas.historial({ dia: req.query.dia })));

// Revisar AHORA (el botón). Hace lo mismo que el cron: si la franja está
// cerrada no manda nada, y lo ya avisado no se repite.
router.post('/api/revisar', responde(() => alertas.revisarYMirar()));

// ── Ajustes (permiso aparte) ────────────────────────────────────────────────

router.post('/config/api/guardar', responde(async req =>
  alertas.guardarConfig(req.body || {}, { usuarioId: await actor.idDe(req) })));

router.post('/config/api/destinatarios', responde(async req =>
  alertas.guardarDestinatarios((req.body || {}).ids, { usuarioId: await actor.idDe(req) })));

module.exports = router;
