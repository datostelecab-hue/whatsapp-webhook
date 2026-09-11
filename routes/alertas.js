// ============================================================
// ALERTAS DE CONTROL — la pantalla y su API
// ============================================================
// Ver las alertas y el histórico va con el permiso '/alertas'. CAMBIAR quién
// las recibe y los umbrales va con '/alertas/config', que nace apagado para
// todo el mundo (`manual` en el catálogo): lo reparte el desarrollador uno a
// uno. Era el requisito: "solo yo elijo a quién le llegan".

const express = require('express');
const router = express.Router();
const alertas = require('../services/repo/alertasControl');
const actor = require('../services/repo/actor');

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [ALERTAS] ${req.method} ${req.path}: ${e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', (req, res) => {
  res.render('alertas', {
    titulo: 'Alertas de control',
    seccion: 'alertas',
    layout: 'layout-gestion',
  });
});

router.get('/api/estado', responde(async req => alertas.estado({ dia: req.query.dia })));

router.get('/api/historial', responde(async req => alertas.historial({ dia: req.query.dia })));

// Revisar AHORA (el botón). Hace lo mismo que el cron: si la franja está
// cerrada no manda nada, y lo ya avisado no se repite.
router.post('/api/revisar', responde(async () => {
  const r = await alertas.revisar({});
  console.log(`🔔 [ALERTAS] Revisión manual: ${r.nuevas || 0} nueva(s), ${r.enviadas || 0} envío(s)`);
  return { resultado: r, ...(await alertas.estado({})) };
}));

// ── Ajustes (permiso aparte) ────────────────────────────────────────────────
router.post('/config/api/guardar', responde(async req => {
  const config = await alertas.guardarConfig(req.body || {}, { usuarioId: await actor.idDe(req) });
  console.log(`⚙️ [ALERTAS] Ajustes guardados · modo ${config.modo}`);
  return { config };
}));

router.post('/config/api/destinatarios', responde(async req => {
  const lista = await alertas.guardarDestinatarios((req.body || {}).ids, { usuarioId: await actor.idDe(req) });
  const reciben = lista.filter(x => x.recibe);
  console.log(`👥 [ALERTAS] Reciben ahora: ${reciben.map(x => x.nombre).join(', ') || '(nadie)'}`);
  return { destinatarios: lista };
}));

module.exports = router;
