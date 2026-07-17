const express = require('express');
const router = express.Router();
const { actualizarHorasPorDia, actualizarUltimos15Dias, actualizarFlotasUnificadas, actualizarTodo } = require('../services/boltResumen');

router.post('/unificadas', async (req, res) => {
  try {
    const result = await actualizarFlotasUnificadas();
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/15dias', async (req, res) => {
  try {
    const result = await actualizarUltimos15Dias();
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/pordia', async (req, res) => {
  try {
    const result = await actualizarHorasPorDia();
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/todo', async (req, res) => {
  try {
    const result = await actualizarTodo();
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;