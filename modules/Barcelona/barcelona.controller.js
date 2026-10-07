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

// ── Las pantallas ──────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.render('barcelona-planificador', { titulo: 'Barcelona · Planificador', seccion: 'bcn-planificador', layout: LAYOUT });
});

// ── El planificador ────────────────────────────────────────────────────────

router.get('/api/tablero', responde(req => barcelona.tablero({ fecha: req.query.fecha })));

router.post('/api/asignar', responde(async req => barcelona.asignar(req.body || {}, await actor.idDe(req)), 400));

module.exports = router;
