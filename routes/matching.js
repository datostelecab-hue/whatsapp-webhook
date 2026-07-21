const express = require('express');
const router = express.Router();
const { leerTablero } = require('../services/planificadorV2');

router.get('/', (req, res) => {
  res.render('matching', { titulo: 'Matching', seccion: 'matching', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    const t = await leerTablero();
    res.json({
      sugerencias: t.sugerencias,
      pendientes: t.pendientes,
      bases: t.bases,
      demandaPorZona: t.resumen.demandaPorZona
    });
  } catch (error) {
    console.error('❌ [MATCHING] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
