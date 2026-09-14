// ============================================================
// VACANTES — controlador
// ============================================================
// Lo que Tráfico armó en el generador y Selección tiene que reclutar. Traduce
// HTTP a llamadas al servicio y no decide nada.
//
// Los candidatos salían de la hoja TICKETS, que lleva muerta desde que Selección
// se migró: la lista de "candidatos de esta vacante" estaba SIEMPRE vacía y
// nadie podía verlo, porque una lista vacía no parece un error. Ahora salen de
// `candidatura`, que es donde están.

const express = require('express');
const router = express.Router();
const vacantes = require('./vacantes.service');
const actor = require('../../services/repo/actor');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Vacantes]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quien = req => actor.idDe(req);

router.get('/', (req, res) => {
  res.render('vacantes', {
    titulo: 'Vacantes',
    seccion: 'vacantes',
    layout: 'layout-gestion',
  });
});

router.get('/api/datos', responde(() => vacantes.tablero()));

router.get('/api/ficha/:id', responde(async req => ({ vacante: await vacantes.ficha(req.params.id) })));

router.post('/api/anular/:id', responde(async req =>
  vacantes.anular(req.params.id, (req.body || {}).motivo, await quien(req))));

router.post('/api/reabrir/:id', responde(async req =>
  vacantes.reabrir(req.params.id, await quien(req))));

module.exports = router;
