// ============================================================
// EL ENVÍO A FIRMA — las rutas (módulo 6, db/293)
// ============================================================
// Se monta en `/firmas`. Llaves: '/firmas' (mirar) y '/firmas/aprobar' (Diana:
// preparar, aprobar, descartar y cerrar). Lo que hace el Bot telecab NO tiene
// ruta: va por `scripts/firmas/bot.js`.
'use strict';

const express = require('express');
const router = express.Router();
const firmas = require('./firmas.service');
// Las comunicaciones de horas de cada martes (db/294): su tarea se registra al cargarse.
require('./comunicaciones.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Firmas]', req.method, req.path + ':', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  res.render('firmas', {
    titulo: 'Firmas', seccion: 'firmas', layout: 'layout-gestion',
    puedeAprobar: await firmas.puede(await quien(req), firmas.CLAVE_APROBAR),
  });
});

router.get('/api/lista', responde(async req => firmas.lista(await quien(req))));
router.get('/api/envio/:id', responde(async req => ({ ficha: await firmas.ficha(req.params.id, await quien(req)) })));
router.get('/api/personas', responde(async req => firmas.personas(await quien(req))));
router.post('/api/envio', responde(async req => firmas.crear(req.body || {}, await quien(req))));
router.post('/api/aprobar-varias', responde(async req => firmas.aprobarVarias(req.body || {}, await quien(req))));
router.post('/api/envio/:id/aprobar', responde(async req => firmas.aprobar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/envio/:id/descartar', responde(async req => firmas.descartar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/envio/:id/borrador', responde(async req => firmas.aBorrador(req.params.id, req.body || {}, await quien(req))));
router.post('/api/envio/:id/cerrar', responde(async req => firmas.cerrar(req.params.id, req.body || {}, await quien(req))));

module.exports = router;
