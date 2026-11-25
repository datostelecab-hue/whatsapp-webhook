// ============================================================
// LAS AUSENCIAS QUE VALIDA RR. HH. — las rutas (módulo 1, db/289)
// ============================================================
// Se monta en `/ausencias`. Dos llaves:
//   '/ausencias'          mirarlas y el % de plantilla de baja
//   '/ausencias/validar'  decidir (marcada `escribir`: toda petición que no sea
//                         un GET la exige)
// El servicio lo vuelve a comprobar: el botón escondido no es un candado.
'use strict';

const express = require('express');
const router = express.Router();
const ausencias = require('./ausencias.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Ausencias]', req.method, req.path + ':', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message, pide: e.pide });
  }
};

router.get('/', async (req, res) => {
  res.render('ausencias', {
    titulo: 'Ausencias', seccion: 'ausencias', layout: 'layout-gestion',
    puedeValidar: await ausencias.puede(await quien(req), ausencias.CLAVE_VALIDAR),
  });
});

router.get('/api/lista', responde(async req => ausencias.lista(await quien(req))));
router.get('/api/ausencia/:id', responde(async req => ({ ficha: await ausencias.ficha(req.params.id, await quien(req)) })));
router.get('/api/bajas', responde(async req => ausencias.historicoBaja(await quien(req))));
router.post('/api/decidir', responde(async req => ausencias.decidir(req.body || {}, await quien(req))));

module.exports = router;
