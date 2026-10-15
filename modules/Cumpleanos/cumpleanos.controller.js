// ============================================================
// CUMPLEAÑOS — rutas
// ============================================================
// Libre para cualquiera que haya entrado: `/cumpleanos` no está en el catálogo
// de permisos, y las tarjetas salen en las pantallas de TODOS, sin excepción.

const express = require('express');
const router = express.Router();
const cumpleanos = require('./cumpleanos.service');

const responde = fn => async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await fn(req)) });
  } catch (e) {
    console.error(`❌ [Cumpleaños] ${req.path}: ${e.message}`);
    res.status(500).json({ status: 'error', msg: e.message });
  }
};

// Quién cumple hoy, visto por quien pregunta (si es él, la felicitación).
router.get('/api/hoy', responde(req => cumpleanos.hoy((req.usuario || {}).id)));

module.exports = router;
