const express = require('express');
const router = express.Router();
const { TIPOS, UMBRAL, MAX_DIAS, leerAlertas, listarSetups } = require('../services/mapon');

router.get('/', (req, res) => {
  res.render('operaciones', {
    titulo: 'Alertas Mapon', seccion: 'operaciones', layout: 'layout-gestion',
    tipos: TIPOS, umbral: UMBRAL, maxDias: MAX_DIAS
  });
});

router.get('/api/alertas', async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.query;
    const r = await leerAlertas({ desde, hasta, tipo });
    console.log(`🛰️  [OPERACIONES] ${r.alertas.length} alertas (${tipo || 'todas'}) ${desde || '-7d'} → ${hasta || 'hoy'}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/alertas:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Diagnóstico: con qué límite está avisando Mapon ahora mismo.
router.get('/api/setups', async (req, res) => {
  try {
    res.json({ status: 'ok', setups: await listarSetups() });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/setups:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
