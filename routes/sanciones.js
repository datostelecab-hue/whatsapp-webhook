// ============================================================
// SANCIONES POR EXCESO DE VELOCIDAD — rutas (Operaciones)
// ============================================================
const express = require('express');
const router = express.Router();
const sanciones = require('../services/sanciones');

// Página
router.get('/', (req, res) => {
  res.render('sanciones', { titulo: 'Sanciones velocidad', seccion: 'sanciones', layout: 'layout-gestion' });
});

// Estado del módulo (modo test/live, última corrida)
router.get('/api/estado', (req, res) => res.json({ status: 'ok', ...sanciones.estadoModulo() }));

// El registro legal completo
router.get('/api/log', async (req, res) => {
  try { res.json({ status: 'ok', modo: sanciones.modo(), log: await sanciones.leerLog() }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Procesar AHORA (manual): lee Mapon, resuelve, registra, auto-envía las 1ª advertencias.
router.post('/api/procesar', async (req, res) => {
  try {
    const minutos = Number((req.body || {}).minutos) || undefined;
    res.json({ status: 'ok', ...(await sanciones.procesar({ minutos })) });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Aprobar una reincidencia pendiente → se envía (o se simula en modo test).
router.post('/api/aprobar', async (req, res) => {
  try { res.json({ status: 'ok', ...(await sanciones.aprobar((req.body || {}).clave)) }); }
  catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Descartar una reincidencia pendiente (no se envía).
router.post('/api/rechazar', async (req, res) => {
  try { res.json({ status: 'ok', ...(await sanciones.rechazar((req.body || {}).clave, (req.body || {}).motivo)) }); }
  catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
