const express = require('express');
const router = express.Router();
const { procesarYUnificar } = require('../services/boltHorasCore');

// Procesar mes actual
router.get('/procesar', async (req, res) => {
  try {
    const ahora = new Date();
    const mes = ahora.getMonth() + 1;
    const ano = ahora.getFullYear();

    console.log(`🔄 Procesando ${mes}/${ano}...`);
    const result = await procesarYUnificar(mes, ano);

    res.json(result);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Procesar mes específico
router.get('/procesar/:mes/:ano', async (req, res) => {
  try {
    const mes = parseInt(req.params.mes);
    const ano = parseInt(req.params.ano);

    console.log(`🔄 Procesando ${mes}/${ano}...`);
    const result = await procesarYUnificar(mes, ano);

    res.json(result);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;