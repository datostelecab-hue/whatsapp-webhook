// ============================================================
// RECAUDACIÓN — controlador
// ============================================================
// Quién sea cada uno sale de la SESIÓN, nunca del cuerpo de la petición: en un
// módulo de caja, "lo apuntó Fulano" tiene que ser verdad. Es lo único que este
// fichero decide; el resto lo dice el servicio.

const express = require('express');
const router = express.Router();
const recaudacion = require('./recaudacion.service');
const actor = require('../../services/repo/actor');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Recaudación]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

/** Quién firma. Por id de sesión, y por correo si la cookie es vieja. */
const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

router.get('/', async (req, res) => {
  res.render('recaudacion', {
    titulo: 'Recaudación', seccion: 'recaudacion', layout: 'layout-gestion',
    ...(await recaudacion.paraLaPantalla(req.usuario, await quienEs(req))),
  });
});

// ── Mirar ──────────────────────────────────────────────────────────────────

router.get('/api/cuadro', responde(async req =>
  recaudacion.cuadro(req.usuario, await quienEs(req))));

router.get('/api/comprobar', responde(() => recaudacion.comprobar()));

router.get('/api/conductor/:id', responde(req => recaudacion.ficha(req.params.id)));

router.get('/api/candidatos', responde(() => recaudacion.candidatos()));

// Lo que BOLT dice ahora mismo, sin congelar nada: para mirar antes de tocar.
router.get('/api/cierre/bolt', responde(() => recaudacion.loQueDiceBolt()));

// ── Apuntar ────────────────────────────────────────────────────────────────

router.post('/api/movimiento', responde(async req =>
  recaudacion.anotar(req.body || {}, req.usuario, await quienEs(req))));

router.post('/api/movimiento/:id/anular', responde(async req =>
  recaudacion.anular(req.params.id, await quienEs(req), (req.body || {}).motivo)));

// ── El cierre de BOLT ──────────────────────────────────────────────────────

router.post('/api/cierre/calcular', responde(async req =>
  recaudacion.recalcular(await quienEs(req))));

router.post('/api/cierre/ajuste', responde(async req =>
  recaudacion.ajustarCierre(req.body || {}, await quienEs(req))));

router.post('/api/cierre', responde(async req =>
  recaudacion.guardarCierre(req.body || {}, await quienEs(req))));

router.post('/api/cierre/importar', responde(async req =>
  recaudacion.importarCierre(req.body || {}, await quienEs(req))));

module.exports = router;
