const express = require('express');
const router = express.Router();
const { escribirResultadosUnificados, procesarUltimos15Dias } = require('../services/boltResumen');

// Procesar flotas unificadas
router.post('/unificadas', async (req, res) => {
  try {
    const result = await escribirResultadosUnificados();
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Procesar últimos 15 días
router.post('/15dias', async (req, res) => {
  try {
    const result = await procesarUltimos15Dias();
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Procesar todo
router.post('/todo', async (req, res) => {
  try {
    const unificadas = await escribirResultadosUnificados();
    const quinceDias = await procesarUltimos15Dias();
    res.json({ status: 'ok', unificadas, quinceDias });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;