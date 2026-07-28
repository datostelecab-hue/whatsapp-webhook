const express = require('express');
const router = express.Router();
const { leerTablero } = require('../services/planificadorV2');
const {
  leerTickets, guardarTicket, declararApto, descartar, CANALES, ESTADOS
} = require('../services/tickets');

/** Zonas operativas reales (las de los coches del planificador), ordenadas. */
async function zonasOperativas() {
  const t = await leerTablero();
  const set = new Set();
  (t.coches || []).forEach(c => { if (c.zona) set.add(c.zona.toString().trim()); });
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
}

// Vista de Selección.
router.get('/', async (req, res) => {
  let zonas = [];
  try { zonas = await zonasOperativas(); }
  catch (e) { console.error('❌ [Selección] zonas:', e.message); }
  res.render('seleccion', {
    titulo: 'Selección',
    seccion: 'seleccion',
    layout: 'layout-gestion',
    canales: CANALES,
    zonas
  });
});

// Tickets en JSON. El front lo pide al cargar y tras cada acción.
router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    const enCriba = lista.filter(t => t.estado === ESTADOS.CRIBA);
    const pendienteBolt = lista.filter(t => t.estado === ESTADOS.PENDIENTE_BOLT);
    const descartados = lista.filter(t => t.estado === ESTADOS.DESCARTADO);
    res.json({
      status: 'ok',
      enCriba, pendienteBolt, descartados,
      contadores: {
        enCriba: enCriba.length,
        pendienteBolt: pendienteBolt.length,
        descartados: descartados.length
      }
    });
  } catch (error) {
    console.error('❌ [Selección] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Un ticket concreto por teléfono (para cargarlo en el formulario).
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

// Declarar APTO (exige prueba + médico) → pasa a RRHH.
router.post('/apto', async (req, res) => {
  try {
    const t = await declararApto((req.body || {}).tel);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Descartar candidato en Selección.
router.post('/descartar', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await descartar(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
