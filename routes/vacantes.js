const express = require('express');
const router = express.Router();
const { vacantesPorZona } = require('../services/vacantes');

// Qué zonas + turnos hay que cubrir (en vivo desde la cobertura).
router.get('/', (req, res) => {
  res.render('vacantes', {
    titulo: 'Vacantes',
    seccion: 'vacantes',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const vacantes = await vacantesPorZona();
    const tot = vacantes.reduce((a, v) => {
      a.dia += v.faltanDia; a.noche += v.faltanNoche; return a;
    }, { dia: 0, noche: 0 });
    res.json({
      status: 'ok', vacantes,
      total: { dia: tot.dia, noche: tot.noche, todo: tot.dia + tot.noche }
    });
  } catch (error) {
    console.error('❌ [Vacantes] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
