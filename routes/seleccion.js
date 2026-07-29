const express = require('express');
const router = express.Router();
const { leerVacantesGuardadas } = require('../services/vacantes');
const { geocodificar } = require('../services/geocoding');
const {
  leerTickets, guardarTicket, cambiarEtapaCandidatura, enviarABolt, descartar,
  CANALES, ETAPAS_CANDIDATURA, ESTADOS, ETAPAS
} = require('../services/tickets');

// Vista de Selección (funnel de candidatos).
router.get('/', async (req, res) => {
  let vacantes = [];
  try {
    vacantes = (await leerVacantesGuardadas())
      .filter(v => v.estado !== 'Cerrada' && v.estado !== 'Cubierta');
  } catch (e) { console.error('❌ [Selección] vacantes:', e.message); }
  res.render('seleccion', {
    titulo: 'Selección',
    seccion: 'seleccion',
    layout: 'layout-gestion',
    canales: CANALES,
    etapas: ETAPAS_CANDIDATURA,
    vacantes
  });
});

// Candidatos del funnel, agrupados por etapa de candidatura.
router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    const enFunnel = lista.filter(t => t.etapa === ETAPAS.SELECCION
      && ETAPAS_CANDIDATURA.includes(t.estado));
    const porEtapa = {};
    ETAPAS_CANDIDATURA.forEach(e => { porEtapa[e] = []; });
    enFunnel.forEach(t => porEtapa[t.estado].push(t));

    const pendienteBolt = lista.filter(t => t.estado === ESTADOS.PENDIENTE_BOLT).length;
    const descartados = lista.filter(t => t.estado === ESTADOS.DESCARTADO).length;

    res.json({
      status: 'ok',
      porEtapa,
      contadores: {
        funnel: enFunnel.length,
        porEtapa: ETAPAS_CANDIDATURA.reduce((a, e) => (a[e] = porEtapa[e].length, a), {}),
        pendienteBolt, descartados
      }
    });
  } catch (error) {
    console.error('❌ [Selección] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Un ticket concreto por teléfono (para cargarlo en la ficha).
router.get('/api/ticket/:tel', async (req, res) => {
  try {
    const { porTel } = await leerTickets();
    const { normalizarTel } = require('../services/tickets');
    const t = porTel.get(normalizarTel(req.params.tel)) || null;
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Crear / actualizar ticket (upsert por teléfono).
router.post('/ticket', async (req, res) => {
  try {
    const t = await guardarTicket(req.body || {});
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Mover de etapa dentro del funnel.
router.post('/etapa', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await cambiarEtapaCandidatura(b.tel, b.estado);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Enviar la solicitud a BOLT (solo tras completar el funnel).
router.post('/bolt', async (req, res) => {
  try {
    const t = await enviarABolt((req.body || {}).tel);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Descartar candidato.
router.post('/descartar', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await descartar(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Geocodifica una dirección (mismo servicio que la Agenda).
router.post('/geocodificar', async (req, res) => {
  try {
    const { direccion, codigoPostal } = req.body || {};
    const r = await geocodificar(direccion, codigoPostal);
    if (!r) return res.json({ status: 'ok', encontrado: false });
    if (r.error) return res.status(502).json({ status: 'error', msg: r.mensaje });
    res.json({ status: 'ok', encontrado: true, ...r, coordenadas: `${r.lat}, ${r.lng}` });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
