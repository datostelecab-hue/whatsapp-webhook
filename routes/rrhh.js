const express = require('express');
const router = express.Router();
const {
  leerTickets, procesarAltaRRHH, noContinuarRRHH, ESTADOS
} = require('../services/tickets');

// Tablero de RRHH: recibe los "Aprobado en BOLT" y tramita el alta.
router.get('/', (req, res) => {
  res.render('rrhh', {
    titulo: 'RRHH',
    seccion: 'rrhh',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    const porTramitar = lista.filter(t => t.estado === ESTADOS.APROBADO_BOLT);
    const altas = lista.filter(t => t.estado === ESTADOS.ALTA);
    const noAlta = lista.filter(t => t.estado === ESTADOS.NO_ALTA);
    res.json({
      status: 'ok', porTramitar, altas, noAlta,
      contadores: { porTramitar: porTramitar.length, altas: altas.length, noAlta: noAlta.length }
    });
  } catch (error) {
    console.error('❌ [RRHH] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Tramitar el alta → crea la ficha en AGENDA_V2 (Pendiente Asignar) y pasa a Tráfico.
router.post('/alta', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await procesarAltaRRHH(b.tel, {
      fecha_alta: b.fecha_alta, fecha_habilitado: b.fecha_habilitado
    });
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// RRHH decide no continuar con el alta.
router.post('/no-continuar', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await noContinuarRRHH(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
