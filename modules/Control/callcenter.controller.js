// ============================================================
// CALL CENTER — controlador (registro de llamadas + cuadro de mando)
// ============================================================

const express = require('express');
const router = express.Router();
const cc = require('./callcenter.service');
const actor = require('../../services/repo/actor');

// Quién atiende. El nombre se sigue guardando porque es lo que se lee en la
// pantalla; el id se añade ahora que hay tabla, para poder contar por persona
// sin depender de cómo se escribiera su nombre ese día.
const quien = async req => ({ usuarioId: await actor.idDe(req) });

const responde = (fn, codigo = 500) => async (req, res) => {
  try {
    const r = await fn(req);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [CallCenter] ${req.method} ${req.path}: ${e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

/** Quién atiende, tal y como se firma en la llamada. */
const agenteDe = req => {
  const u = req.usuario || {};
  return `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email || '';
};

const rango = req => ({ desde: (req.query || {}).desde, hasta: (req.query || {}).hasta });

router.get('/', (req, res) => {
  res.render('callCenter', { titulo: 'Call Center', seccion: 'callcenter', layout: 'layout-gestion' });
});

// El catálogo de clasificación: clusters → subclusters → motivos → resultados/acciones.
router.get('/api/catalogo', (req, res) =>
  res.json({ status: 'ok', catalogo: cc.CATALOGO, universales: cc.RESULTADOS_UNIVERSALES }));

// Conductores para el formulario, con matrícula y turno de HOY (caché de 10 min).
router.get('/api/conductores', responde(async () => ({ conductores: await cc.conductoresForm() })));

// Los KPIs del periodo, sus llamadas y las pendientes de cualquier fecha.
router.get('/api/datos', responde(req => cc.panelDelPeriodo(rango(req))));

// La pestaña «Por conductor»: una fila por persona llamada en el periodo.
router.get('/api/por-conductor', responde(req => cc.porConductor(rango(req))));

// La historia COMPLETA de una persona, de las dos fuentes y sin ventana.
router.get('/api/historia/:conductorId', responde(req => cc.historiaConductor(req.params.conductorId), 400));

router.post('/api/registrar', responde(async req => {
  const llamada = await cc.registrar(req.body || {}, agenteDe(req), await quien(req));
  console.log(`📞 [CallCenter] ${agenteDe(req)}: ${llamada.motivo} · ${llamada.conductor} · ${llamada.resultado}`);
  return { llamada };
}, 400));

// Resolver una pendiente: nota obligatoria, resultado final opcional.
router.post('/api/resolver', responde(async req => {
  const b = req.body || {};
  return { llamada: await cc.resolver(b.clave,
    { resolucion: b.resolucion, resultado: b.resultado }, agenteDe(req), await quien(req)) };
}, 400));

module.exports = router;
