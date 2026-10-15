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

// Felicitar a un compañero de oficina que cumple hoy (db/205).
router.post('/api/felicitar', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    res.json({ status: 'ok', ...(await cumpleanos.felicitar((req.body || {}).usuarioId, req.usuario.id)) });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Las felicitaciones que me han mandado y aún no he visto; y darlas por vistas.
router.get('/api/mias', responde(req => cumpleanos.mias((req.usuario || {}).id)));
router.post('/api/vistas', responde(req => cumpleanos.vistas((req.usuario || {}).id, (req.body || {}).ids)));

module.exports = router;
