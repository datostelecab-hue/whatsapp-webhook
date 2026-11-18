// ============================================================
// JUSTIFICANTES — controlador
// ============================================================
// La pantalla de aprobación de las J. Quién entra lo decide el desarrollador en
// /usuarios con la clave '/justificantes'; el módulo no ata tipos a roles.

const express = require('express');
const router = express.Router();
const justificantes = require('./justificantes.service');
const auditoriaJ = require('../../services/repo/auditoriaJ');
const actor = require('../../services/repo/actor');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
};

/** Quién firma. Por id de sesión, y por correo si la cookie es vieja. */
const quien = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);
/** Quién es, con su rol: para lo que depende de una llave (las de KM). */
const quienCon = async req => ({ id: await quien(req), rol: req.usuario && req.usuario.rol });
// Un error con estado (403 sin la llave) sale con su estado.
const respondeCon = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) { res.status(e.status || 400).json({ status: 'error', msg: e.message }); }
};

router.get('/', (req, res) => {
  res.render('justificantes', {
    titulo: 'Justificantes',
    seccion: 'justificantes',
    layout: 'layout-gestion',
    tiposJ: justificantes.TIPOS_J,
    casuisticasMenosJ: justificantes.CASUISTICAS_MENOS_J,
  });
});

router.get('/api/cola', responde(async req => justificantes.cola({
  estado: req.query.estado, tipo: req.query.tipo,
  desde: req.query.desde, hasta: req.query.hasta,
}, await quienCon(req))));

// ── LAS JUSTIFICACIONES DE KM (db/268): su pestaña en esta misma pantalla ──
router.post('/api/km', respondeCon(async req => justificantes.ponerKm(req.body || {}, await quienCon(req))));
router.post('/api/km/:id/aprobar', respondeCon(async req => justificantes.aprobarKm(req.params.id, await quienCon(req))));
router.post('/api/km/:id/rechazar', respondeCon(async req =>
  justificantes.rechazarKm(req.params.id, await quienCon(req), (req.body || {}).motivo)));

// EL HISTORIAL de una J o una −J (db/228): cada cambio, con quién, cuándo y desde dónde.
router.get('/api/historial', responde(async req =>
  ({ historial: await auditoriaJ.historial(req.query.entidad, req.query.id) })));

// ── LA −J (db/227): su cola va en la misma pantalla, en su pestaña ─────────
// Aquí se pone desde la J «Por compañero» del perjudicado: quién lo causó.
router.get('/api/menos-j/personas', responde(async () => ({ personas: await justificantes.personasMenosJ() })));

router.post('/api/menos-j', responde(async req =>
  justificantes.ponerMenosJ(req.body || {}, await quien(req))));

router.post('/api/menos-j/:id/aprobar', responde(async req =>
  justificantes.aprobarMenosJ(req.params.id, await quien(req))));

router.post('/api/menos-j/:id/rechazar', responde(async req =>
  justificantes.rechazarMenosJ(req.params.id, await quien(req), (req.body || {}).motivo)));

router.post('/api/:id/aprobar', responde(async req =>
  justificantes.aprobar(req.params.id, await quien(req))));

router.post('/api/:id/rechazar', responde(async req =>
  justificantes.rechazar(req.params.id, await quien(req), (req.body || {}).motivo)));

// Los dos finales de una J RECHAZADA. Sin ellos el caso se quedaba abierto para
// siempre: la alerta "Justificación rechazada" pedía llamar y no había forma de
// decir que ya se había llamado.
router.post('/api/:id/rehacer', responde(async req =>
  justificantes.rehacer(req.params.id, await quien(req), req.body || {})));

router.post('/api/:id/cerrar', responde(async req =>
  justificantes.cerrar(req.params.id, await quien(req), (req.body || {}).nota)));

router.post('/api/:id/reabrir', responde(async req => justificantes.reabrir(req.params.id, await quien(req))));

module.exports = router;
