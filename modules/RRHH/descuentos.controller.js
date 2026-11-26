// ============================================================
// LOS DESCUENTOS EN NÓMINA — las rutas (módulo 4.2, db/298)
// ============================================================
// Se monta en `/descuentos`. Llaves: '/descuentos' (mirar), '/descuentos/proponer'
// y '/descuentos/aprobar' (aprobar, anular, aplazar y cerrar el mes). El efectivo
// también lo propone quien apunta la nómina en Recaudación ('/recaudacion/nomina').
'use strict';

const express = require('express');
const router = express.Router();
const descuentos = require('./descuentos.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Descuentos]', req.method, req.path + ':', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  const q = await quien(req);
  const [proponer, aprobar] = await Promise.all([descuentos.puede(q, descuentos.CLAVE_PROPONER), descuentos.puede(q, descuentos.CLAVE_APROBAR)]);
  res.render('descuentos', { titulo: 'Descuentos en nómina', seccion: 'descuentos', layout: 'layout-gestion', puede: { proponer, aprobar } });
});

router.get('/api/lista', responde(async req => descuentos.lista(await quien(req))));
router.get('/api/descuento/:id', responde(async req => ({ ficha: await descuentos.ficha(req.params.id, await quien(req)) })));
router.get('/api/personas', responde(async req => descuentos.personas(await quien(req))));
router.post('/api/descuento', responde(async req => descuentos.crear(req.body || {}, await quien(req))));
router.post('/api/descuento/:id/aprobar', responde(async req => descuentos.aprobar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/descuento/:id/anular', responde(async req => descuentos.anular(req.params.id, req.body || {}, await quien(req))));
router.post('/api/descuento/:id/aplazar', responde(async req => descuentos.aplazar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/cerrar-mes', responde(async req => descuentos.cerrarMes(req.body || {}, await quien(req))));
router.get('/api/excel/:periodo', async (req, res) => {
  try {
    const { buffer, nombre } = await descuentos.excelDelMes(req.params.periodo, await quien(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`);
    res.send(buffer);
  } catch (e) { res.status(e.status && e.status < 500 ? e.status : 400).send(e.message); }
});

module.exports = router;
