// ============================================================
// EL SMS CERTIFICADO — las rutas (módulo 9, db/306)
// ============================================================
// Se monta en `/sms`. Llaves: '/sms' (mirar) y '/sms/enviar' (Diana: preparar
// y mandar), que comprueba el servicio. El receptor de estados de Mensatek va
// aparte y sin sesión (sms.receptor.js, en /mensatek).
'use strict';

const express = require('express');
const router = express.Router();
const sms = require('./sms.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [SMS]', req.method, req.path + ':', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  res.render('sms', {
    titulo: 'SMS certificado', seccion: 'sms', layout: 'layout-gestion',
    puedeEnviar: await sms.puede(await quien(req), sms.CLAVE_ENVIAR),
  });
});

router.get('/api/lista', responde(async req => sms.lista(await quien(req))));
router.get('/api/creditos', responde(async req => sms.creditos(await quien(req))));
router.get('/api/personas', responde(async req => sms.personas(await quien(req))));
router.get('/api/envio/:id', responde(async req => ({ ficha: await sms.ficha(req.params.id, await quien(req)) })));
router.post('/api/envio', responde(async req => sms.crear(req.body || {}, await quien(req))));
// Desde la ficha de una sanción o un finiquito: el borrador a esa persona.
router.post('/api/desde', responde(async req => sms.borradorDesde(req.body || {}, await quien(req))));
router.post('/api/envio/:id', responde(async req => sms.editar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/envio/:id/enviar', responde(async req => sms.enviar(req.params.id, await quien(req))));
router.post('/api/envio/:id/anular', responde(async req => sms.anular(req.params.id, await quien(req))));

module.exports = router;
