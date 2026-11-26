// ============================================================
// LOS COMUNICADOS A LA PLANTILLA — las rutas (módulos 6 y 9, db/305)
// ============================================================
// Se monta en `/comunicados`. Llaves: '/comunicados' (mirar), y sus hijas
// '/comunicados/preparar' (Diana) y '/comunicados/aprobar' (Ignacio), que
// comprueba el servicio. El «Lo he leído» va por el portal (Portal/portal.controller).
'use strict';

const express = require('express');
const router = express.Router();
const comunicados = require('./comunicados.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Comunicados]', req.method, req.path + ':', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  const q = await quien(req);
  res.render('comunicados', {
    titulo: 'Comunicados', seccion: 'comunicados', layout: 'layout-gestion',
    puedePreparar: await comunicados.puede(q, comunicados.CLAVE_PREPARAR),
    puedeAprobar: await comunicados.puede(q, comunicados.CLAVE_APROBAR),
  });
});

router.get('/api/lista', responde(async req => comunicados.lista(await quien(req))));
router.get('/api/personas', responde(async req => comunicados.personas(await quien(req))));
router.get('/api/comunicado/:id', responde(async req => ({ ficha: await comunicados.ficha(req.params.id, await quien(req)) })));
router.post('/api/comunicado', responde(async req => comunicados.crear(req.body || {}, await quien(req))));
router.post('/api/comunicado/:id', responde(async req => comunicados.editar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/comunicado/:id/pedir', responde(async req => comunicados.pedir(req.params.id, await quien(req))));
router.post('/api/comunicado/:id/devolver', responde(async req => comunicados.devolver(req.params.id, req.body || {}, await quien(req))));
router.post('/api/comunicado/:id/aprobar', responde(async req => comunicados.aprobar(req.params.id, await quien(req))));
router.post('/api/comunicado/:id/anular', responde(async req => comunicados.anular(req.params.id, req.body || {}, await quien(req))));

module.exports = router;
