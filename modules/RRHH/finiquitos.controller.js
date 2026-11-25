// ============================================================
// LOS FINIQUITOS — las rutas (módulo 7, db/291)
// ============================================================
// Se monta en `/finiquitos`. Llaves: '/finiquitos' (entrar y mirar),
// '/finiquitos/revisar' (Diana) y '/finiquitos/aprobar' (Ignacio): cada acción
// la exige el servicio.
'use strict';

const express = require('express');
const router = express.Router();
const finiquitos = require('./finiquitos.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Finiquitos]', req.method, req.path + ':', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  const q = await quien(req);
  res.render('finiquitos', {
    titulo: 'Finiquitos', seccion: 'finiquitos', layout: 'layout-gestion',
    puedeRevisar: await finiquitos.puede(q, finiquitos.CLAVE_REVISAR),
    puedeAprobar: await finiquitos.puede(q, finiquitos.CLAVE_APROBAR),
  });
});

router.get('/api/lista', responde(async req => finiquitos.lista(await quien(req))));
router.get('/api/finiquito/:id', responde(async req => ({ ficha: await finiquitos.ficha(req.params.id, await quien(req)) })));
router.get('/api/conductor/:id', responde(async req => finiquitos.deConductor(req.params.id, await quien(req))));
router.get('/api/finiquito/:id/pdf', async (req, res) => {
  try {
    const p = await finiquitos.pdf(req.params.id, await quien(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(p.nombre)}`);
    res.end(p.bytes);
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 400).type('text').send(e.message);
  }
});
router.post('/api/preparar', responde(async req => finiquitos.preparar((req.body || {}).conductorId, req.body || {}, await quien(req))));
router.post('/api/finiquito/:id/revisar', responde(async req => finiquitos.revisar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/finiquito/:id/devolver', responde(async req => finiquitos.devolver(req.params.id, req.body || {}, await quien(req))));
router.post('/api/finiquito/:id/aprobar', responde(async req => finiquitos.aprobar(req.params.id, await quien(req))));
router.post('/api/finiquito/:id/enviar', responde(async req => finiquitos.enviar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/finiquito/:id/firmado', responde(async req => finiquitos.firmado(req.params.id, await quien(req))));
router.post('/api/finiquito/:id/anular', responde(async req => finiquitos.anular(req.params.id, req.body || {}, await quien(req))));

module.exports = router;
