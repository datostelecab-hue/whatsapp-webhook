// ============================================================
// EL BANCO DE KM — las rutas (/operaciones/banco-km, db/267)
// ============================================================
//   GET  /operaciones/banco-km                    la pantalla
//   GET  /operaciones/banco-km/api/semana?lunes=  una semana: conductores y matrículas
//   GET  /operaciones/banco-km/api/historia?persona=&hasta=   las últimas semanas de uno
//   POST /operaciones/banco-km/api/recalcular     { lunes }   rehace las jornadas cerradas de esa semana
//
// La llave es '/operaciones/banco-km' (el catálogo de permisos la pide por el
// prefijo de la ruta). Las reglas, en bancoKm.service.js.
'use strict';

const express = require('express');
const router = express.Router();
const actor = require('../../services/repo/actor');
const banco = require('./bancoKm.service');

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);
const responde = fn => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', ...(await fn(req)) });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('❌ [Banco de KM]', req.method, req.path + ':', e.stack || e.message);
    res.status(e.status || 400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', (req, res) => {
  res.render('bancoKm', { titulo: 'Banco de KM', seccion: 'banco-km', layout: 'layout-gestion' });
});

router.get('/api/semana', responde(req => banco.semana(req.query.lunes)));
router.get('/api/historia', responde(req => banco.historia(req.query.persona, req.query.hasta)));
router.post('/api/recalcular', responde(async req => banco.recalcular((req.body || {}).lunes, await quienEs(req))));

module.exports = router;
