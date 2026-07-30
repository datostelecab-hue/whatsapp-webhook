const express = require('express');
const router = express.Router();
const { leerPeticiones, crearPeticion, aprobarPeticion, rechazarPeticion, TIPOS } = require('../services/peticiones');
const { leerTablero } = require('../services/planificadorV2');

router.get('/', (req, res) => {
  res.render('peticiones', {
    titulo: 'Peticiones',
    seccion: 'peticiones',
    layout: 'layout-gestion',
    tipos: TIPOS
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const [{ lista }, tablero] = await Promise.all([leerPeticiones(), leerTablero().catch(() => null)]);
    // Conductores de la agenda, para el selector del formulario de Tráfico.
    const conductores = ((tablero && tablero.conductores) || [])
      .filter(c => c.idBolt || c.nombre)
      .map(c => ({ id: c.idBolt || c.nombre, nombre: c.nombre || c.idBolt, turno: c.turno || '', estado: c.estado || '' }))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    res.json({ status: 'ok', peticiones: lista, conductores });
  } catch (error) {
    console.error('❌ [Peticiones] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/crear', async (req, res) => {
  try { res.json({ status: 'ok', peticion: await crearPeticion(req.body || {}) }); }
  catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});

router.post('/aprobar', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ status: 'ok', peticion: await aprobarPeticion(b.id, { desde: b.desde, hasta: b.hasta }) });
  } catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});

router.post('/rechazar', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ status: 'ok', peticion: await rechazarPeticion(b.id, b.motivo) });
  } catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});

module.exports = router;
