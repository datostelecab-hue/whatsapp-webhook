// ============================================================
// CALL CENTER — controlador (registro de llamadas + cuadro de mando)
// ============================================================

const express = require('express');
const router = express.Router();
const cc = require('./callcenter.service');

const responde = (fn, codigo = 500) => async (req, res) => {
  try {
    const r = await fn(req);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [CallCenter] ${req.method} ${req.path}: ${e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

/** Quién atiende, tal y como se firma en la hoja. */
const agenteDe = req => {
  const u = req.usuario || {};
  return `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email || '';
};

router.get('/', (req, res) => {
  res.render('callCenter', { titulo: 'Call Center', seccion: 'callcenter', layout: 'layout-gestion' });
});

// El catálogo de clasificación: clusters → subclusters → motivos → resultados/acciones.
router.get('/api/catalogo', (req, res) =>
  res.json({ status: 'ok', catalogo: cc.CATALOGO, universales: cc.RESULTADOS_UNIVERSALES }));

// Conductores para el formulario, con matrícula y turno de HOY (caché de 10 min).
router.get('/api/conductores', responde(async () => ({ conductores: await cc.conductoresForm() })));

// Los KPIs del periodo, sus llamadas y las pendientes de cualquier fecha.
router.get('/api/datos', responde(req =>
  cc.panelDelPeriodo({ desde: (req.query || {}).desde, hasta: (req.query || {}).hasta })));

router.post('/api/registrar', responde(async req => {
  const llamada = await cc.registrar(req.body || {}, agenteDe(req));
  console.log(`📞 [CallCenter] ${agenteDe(req)}: ${llamada.motivo} · ${llamada.conductor} · ${llamada.resultado}`);
  return { llamada };
}, 400));

// Resolver una pendiente: nota obligatoria, resultado final opcional.
router.post('/api/resolver', responde(async req => {
  const b = req.body || {};
  return { llamada: await cc.resolver(b.clave, { resolucion: b.resolucion, resultado: b.resultado }, agenteDe(req)) };
}, 400));

module.exports = router;
