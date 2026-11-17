// ============================================================
// LAS NOVEDADES — /novedades (db/253)
// ============================================================
//   GET  /novedades/api/estado   → { version, pendiente, recorrido }
//   POST /novedades/api/visto    { version, recorrido? }  → lo mismo
//   GET  /novedades/api/pantalla/:p   el recorrido de una pantalla (chat, tablero): → { pantalla, visto, recorrido }
//   POST /novedades/api/pantalla/:p   { como: 'hecho' | 'saltado' }  → lo mismo
//
// De todos los que tienen sesión, como /contadores: no está en el catálogo de
// permisos. Cada uno lee y marca lo suyo (el id sale de la sesión).
'use strict';

const express = require('express');
const router = express.Router();
const actor = require('../../services/repo/actor');
const novedades = require('./novedades.service');

const responde = fn => async (req, res) => {
  try {
    const id = (req.usuario && req.usuario.id) || await actor.idDe(req);
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', ...(await fn(req, id)) });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('❌ [Novedades]:', e.stack || e.message);
    res.status(status).json({ status: 'error', msg: status >= 500 ? 'No se han podido leer las novedades' : e.message });
  }
};

router.get('/api/estado', responde((req, id) => novedades.estado(id)));
router.post('/api/visto', responde((req, id) => novedades.marcar(id, {
  version: String((req.body || {}).version || ''),
  recorrido: (req.body || {}).recorrido || null,
})));

router.get('/api/pantalla/:p', responde((req, id) => novedades.pantalla(id, req.params.p)));
router.post('/api/pantalla/:p', responde((req, id) => novedades.marcarPantalla(id, req.params.p, String((req.body || {}).como || ''))));

module.exports = router;
