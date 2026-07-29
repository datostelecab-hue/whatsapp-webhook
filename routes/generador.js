const express = require('express');
const router = express.Router();
const { generarVacante, datosGenerador } = require('../services/generadorVacantes');
const { guardarVacante } = require('../services/vacantes');

router.get('/', (req, res) => {
  res.render('generador', {
    titulo: 'Generador de vacantes',
    seccion: 'generador',
    layout: 'layout-gestion'
  });
});

// Zonas → matrículas con huecos (para los desplegables).
router.get('/api/datos', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await datosGenerador()) });
  } catch (error) {
    console.error('❌ [Generador] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Genera una propuesta de vacante a partir de zona + turno + días + matrícula.
router.post('/api/generar', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await generarVacante(req.body || {})) });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Guarda la vacante que armó Tráfico → la verá Selección.
router.post('/api/guardar', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await guardarVacante(req.body || {})) });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
