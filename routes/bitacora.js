const express = require('express');
const router = express.Router();
const { leerBitacora } = require('../services/bitacora');

// VISTA_FINAL es una lectura grande (A:ZZ); se cachea unos minutos. La bitácora
// se refresca por cron cada hora, así que unos minutos de desfase es aceptable.
let cache = null, ts = 0;
const TTL = 3 * 60 * 1000;

router.get('/', (req, res) => {
  res.render('bitacora', { titulo: 'Bitácora', seccion: 'bitacora', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    if (!cache || Date.now() - ts > TTL) { cache = await leerBitacora(); ts = Date.now(); }
    res.json({ status: 'ok', ...cache });
  } catch (error) {
    console.error('❌ [Bitácora] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
