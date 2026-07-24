const express = require('express');
const router = express.Router();
const { tableroControl } = require('../services/control');

// La interfaz de tráfico.
router.get('/', (req, res) => {
  res.render('control', {
    titulo: 'Control de tráfico',
    seccion: 'control',
    layout: 'layout-gestion'
  });
});

// Datos del tablero (JSON). El front lo refresca solo cada pocos minutos.
router.get('/api/datos', async (req, res) => {
  try {
    const datos = await tableroControl();
    res.json({ status: 'ok', ...datos });
  } catch (error) {
    console.error('❌ [Control] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
