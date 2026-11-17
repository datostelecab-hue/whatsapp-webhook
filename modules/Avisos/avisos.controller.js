// ============================================================
// LOS AVISOS — /avisos/api (ítem 3, db/254)
// ============================================================
//   GET  /avisos/api/mios               → { avisos: [...], sinLeer }
//   POST /avisos/api/leidos             { ids? }  (sin ids: todos los suyos)
//   POST /avisos/api/:id/resolver       { nota }
//
// De todos los que tienen sesión, como /contadores: no está en el catálogo de
// permisos. Cada uno ve, lee y resuelve los suyos: los de su área (Organización)
// y los que van a su nombre. (/avisos/efectivo es otra cosa: la tarjeta de caja.)
'use strict';

const express = require('express');
const router = express.Router();
const actor = require('../../services/repo/actor');
const avisos = require('../../services/avisos');

const responde = fn => async (req, res) => {
  try {
    const id = (req.usuario && req.usuario.id) || await actor.idDe(req);
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', ...(await fn(req, id)) });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('❌ [Avisos]:', e.stack || e.message);
    res.status(status).json({ status: 'error', msg: status >= 500 ? 'No se han podido leer los avisos' : e.message });
  }
};

router.get('/api/mios', responde((req, id) => avisos.mios(id)));
router.post('/api/leidos', responde((req, id) => avisos.marcarLeidos(id, { ids: (req.body || {}).ids == null ? null : (req.body || {}).ids })));
router.post('/api/:id/resolver', responde((req, id) => avisos.resolver(id, req.params.id, { nota: (req.body || {}).nota })));

module.exports = router;
