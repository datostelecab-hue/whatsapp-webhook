// ============================================================
// JUSTIFICANTES — el módulo de aprobación
// ============================================================
// Las J nacen PENDIENTES desde el cockpit o las campañas, y aquí el área
// responsable las aprueba o las rechaza: una J de tráfico la aprueba Tráfico,
// una de RRHH la aprueba RRHH. Quién entra a esta pantalla lo decide el
// desarrollador en /usuarios, con la clave '/justificantes' de la matriz: el
// módulo no ata tipos a roles a propósito, porque ese reparto lo eligen ellos
// y cambia (hoy lo aprueba una persona, mañana un departamento).
//
// Rechazar ANULA la J por el circuito de siempre (fuera de bitácora y de
// reportes), con quién y por qué: el que la puso tiene que poder saberlo.

const express = require('express');
const router = express.Router();
const repo = require('../services/repo/justificantes');
const actor = require('../services/repo/actor');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
};

router.get('/', (req, res) => {
  res.render('justificantes', {
    titulo: 'Justificantes',
    seccion: 'justificantes',
    layout: 'layout-gestion',
    tiposJ: repo.TIPOS_J,
  });
});

router.get('/api/cola', responde(async req => ({
  filas: await repo.listar({
    estado: req.query.estado || 'pendiente',
    tipo: req.query.tipo || undefined,
    desde: req.query.desde, hasta: req.query.hasta,
  }),
  pendientes: await repo.pendientesPorTipo(),
  cuentas: await repo.cuentas({ desde: req.query.desde, hasta: req.query.hasta }),
})));

router.post('/api/:id/aprobar', responde(async req =>
  repo.aprobar(req.params.id, { usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req) })));

router.post('/api/:id/rechazar', responde(async req =>
  repo.rechazar(req.params.id, {
    usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req),
    motivo: (req.body || {}).motivo,
  })));

// Los dos finales de una J RECHAZADA. Sin ellos el caso se quedaba abierto para
// siempre: la alerta "Justificación rechazada" pedía llamar y no había forma de
// decir que ya se había llamado.
router.post('/api/:id/rehacer', responde(async req =>
  repo.rehacer(req.params.id, {
    ...(req.body || {}),
    usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req),
  })));

router.post('/api/:id/cerrar', responde(async req =>
  repo.cerrar(req.params.id, {
    usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req),
    nota: (req.body || {}).nota,
  })));

router.post('/api/:id/reabrir', responde(async req => repo.reabrir(req.params.id)));

module.exports = router;
