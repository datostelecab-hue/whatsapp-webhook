// ============================================================
// RECAUDACIÓN — controlador
// ============================================================
// Quién sea cada uno sale de la SESIÓN, nunca del cuerpo de la petición: en un
// módulo de caja, "lo apuntó Fulano" tiene que ser verdad. Es lo único que este
// fichero decide; el resto lo dice el servicio.
//
// UNA POR SEDE (05/11/2026): `crear(servicio, opciones)` arma las mismas rutas
// sobre el servicio que se le dé. Madrid es la de siempre (abajo); Barcelona la
// monta en /barcelona/recaudacion con su servicio (modules/Barcelona). `vista`
// es lo que la pantalla necesita saber de la sede: la base de sus URL y si la
// gente es su cuenta de BOLT.

const express = require('express');
const actor = require('../../services/repo/actor');

/** Quién firma. Por id de sesión, y por correo si la cookie es vieja. */
const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

function crear(recaudacion, { titulo = 'Recaudación', seccion = 'recaudacion', etiqueta = 'Recaudación', vista = {} } = {}) {
  const router = express.Router();

  const responde = fn => async (req, res) => {
    try { res.json({ status: 'ok', ...(await fn(req)) }); }
    catch (e) {
      console.error(`❌ [${etiqueta}]`, req.method, req.path + ':', e.message);
      res.status(400).json({ status: 'error', msg: e.message });
    }
  };

  router.get('/', async (req, res) => {
    res.render('recaudacion', {
      titulo, seccion, layout: 'layout-gestion',
      ...(await recaudacion.paraLaPantalla(req.usuario, await quienEs(req))),
      ...vista,
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

  return router;
}

// Madrid: el servicio de siempre, en /recaudacion (app.js).
module.exports = crear(require('./recaudacion.service'));
module.exports.crear = crear;
