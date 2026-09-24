// ============================================================
// BITÁCORA — controlador
// ============================================================
//   /bitacora           el día a día
//   /bitacora/general   la plantilla entera contra el calendario entero
//
// Las dos leen el MISMO /api/datos: son dos formas de mirar la misma rejilla.

const express = require('express');
const router = express.Router();
const bitacora = require('./bitacora.service');
const actor = require('../../services/repo/actor');
const sesion = require('../../services/sesion');   // para el guard del desarrollador

const responde = (fn, codigo = 400) => async (req, res) => {
  try {
    const r = await fn(req);
    res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [Bitácora] ${req.method} ${req.path}: ${e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

/** Quién firma. Por id de sesión, y por correo si la cookie es vieja. */
const quien = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

router.get('/', (req, res) => {
  // Quién puede ESCRIBIR en la bitácora (justificar, anular, marcar libranza)
  // sale de la matriz de permisos, no de una lista de roles. `permisos` en null
  // es acceso total (superadmin y desarrollador).
  const mias = res.locals.permisos;
  res.render('bitacora', {
    titulo: 'Bitácora', seccion: 'bitacora', layout: 'layout-gestion',
    rol: (req.usuario && req.usuario.rol) || '',
    puedeJustificar: !mias || mias.includes('/bitacora/justificar'),
  });
});

router.get('/general', (req, res) => {
  res.render('bitacoraGeneral', {
    titulo: 'Bitácora general', seccion: 'bitacora', layout: 'layout-gestion',
  });
});

// ── Lectura ────────────────────────────────────────────────────────────────

router.get('/api/datos', responde(() => bitacora.datos(), 500));
router.get('/api/vacaciones', responde(() => bitacora.vacaciones(), 500));

router.get('/api/dia', responde(req =>
  bitacora.llamadasDelDia(req.query.conductor, req.query.dia)));

// ── Escritura ──────────────────────────────────────────────────────────────

router.post('/api/justificar', responde(async req => {
  const b = req.body || {};
  return bitacora.justificar(
    { conductorId: b.conductorId, dia: b.dia, horas: b.horas, observacion: b.observacion },
    await quien(req));
}));

router.post('/api/anular-justificante', responde(req =>
  bitacora.anularJustificante({ conductorId: (req.body || {}).conductorId, dia: (req.body || {}).dia })));

router.post('/api/libranza', responde(async req => {
  const b = req.body || {};
  return bitacora.libranza({ conductorId: b.conductorId, dia: b.dia, quitar: b.quitar }, await quien(req));
}));

// REHACER el histórico sellado. Solo el desarrollador: reescribe histórico.
router.post('/api/resellar', sesion.requiereDesarrollador, responde(req =>
  bitacora.resellar(req.body || {}, (req.usuario || {}).nombre)));

module.exports = router;
