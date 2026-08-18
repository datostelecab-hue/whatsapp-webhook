// ============================================================
// CALL CENTER — rutas (registro de llamadas + cuadro de mando)
// ============================================================
const express = require('express');
const router = express.Router();
const cc = require('../services/callCenter');

// Página
router.get('/', (req, res) => {
  res.render('callCenter', { titulo: 'Call Center', seccion: 'callcenter', layout: 'layout-gestion' });
});

// Catálogo de clasificación (clusters → subclusters → motivos → resultados/acciones)
router.get('/api/catalogo', (req, res) => {
  res.json({ status: 'ok', catalogo: cc.CATALOGO, universales: cc.RESULTADOS_UNIVERSALES });
});

// Conductores para el formulario, con matrícula y turno de HOY (cache 10 min)
router.get('/api/conductores', async (req, res) => {
  try { res.json({ status: 'ok', conductores: await cc.conductoresForm() }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Datos del panel: KPIs del periodo + llamadas del periodo + pendientes (de cualquier fecha)
router.get('/api/datos', async (req, res) => {
  try {
    const q = req.query || {};
    const hoy = cc.hoyMadrid();
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(q.desde || '') ? q.desde : hoy;
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(q.hasta || '') ? q.hasta : hoy;
    const d0 = cc.inicioDia(desde), d1 = cc.finDia(hasta);

    const todas = await cc.listar();
    const periodo = todas.filter(x => x.ts >= d0 && x.ts < d1);
    res.json({
      status: 'ok', desde, hasta,
      kpis: cc.kpis(periodo, todas),
      llamadas: [...periodo].sort((a, b) => b.ts - a.ts).slice(0, 800),
      pendientes: todas.filter(x => x.estado === 'pendiente').sort((a, b) => a.ts - b.ts)
    });
  } catch (e) {
    console.error('❌ [CallCenter] /api/datos:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Registrar una llamada
router.post('/api/registrar', async (req, res) => {
  try {
    const u = req.usuario || {};
    const agente = `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email || '';
    const ll = await cc.registrar(req.body || {}, agente);
    console.log(`📞 [CallCenter] ${agente}: ${ll.motivo} · ${ll.conductor} · ${ll.resultado}`);
    res.json({ status: 'ok', llamada: ll });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Resolver una llamada pendiente (nota obligatoria; resultado final opcional)
router.post('/api/resolver', async (req, res) => {
  try {
    const u = req.usuario || {};
    const agente = `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email || '';
    const b = req.body || {};
    const ll = await cc.resolver(b.clave, { resolucion: b.resolucion, resultado: b.resultado }, agente);
    res.json({ status: 'ok', llamada: ll });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
