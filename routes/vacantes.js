const express = require('express');
const router = express.Router();
const { leerVacantesGuardadas } = require('../services/vacantes');

// Vacantes que Tráfico guardó desde el generador. Son las que Selección recluta.
router.get('/', (req, res) => {
  res.render('vacantes', {
    titulo: 'Vacantes',
    seccion: 'vacantes',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const todas = await leerVacantesGuardadas();
    const abiertas = todas.filter(v => v.estado !== 'Cerrada' && v.estado !== 'Cubierta');
    res.json({
      status: 'ok',
      vacantes: abiertas,
      contadores: {
        abiertas: abiertas.length,
        dia: abiertas.filter(v => v.turno === 'Día').length,
        noche: abiertas.filter(v => v.turno === 'Noche').length
      }
    });
  } catch (error) {
    console.error('❌ [Vacantes] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
