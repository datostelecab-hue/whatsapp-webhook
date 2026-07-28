const express = require('express');
const router = express.Router();
const {
  leerTickets, conciliarTicketsBolt, marcarRechazadoBolt, ESTADOS
} = require('../services/tickets');

// Vista compartida (Selección + RRHH): quiénes están esperando aprobación de
// BOLT, para revisarlos a diario en la plataforma por si hay rechazados.
router.get('/', (req, res) => {
  res.render('pendientes-bolt', {
    titulo: 'Pendientes en BOLT',
    seccion: 'pendientes-bolt',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    const pendientes = lista.filter(t => t.estado === ESTADOS.PENDIENTE_BOLT);
    const aprobados = lista.filter(t => t.estado === ESTADOS.APROBADO_BOLT);
    const rechazados = lista.filter(t => t.estado === ESTADOS.RECHAZADO_BOLT);
    res.json({
      status: 'ok', pendientes, aprobados, rechazados,
      contadores: { pendientes: pendientes.length, aprobados: aprobados.length, rechazados: rechazados.length }
    });
  } catch (error) {
    console.error('❌ [Pendientes BOLT] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Fuerza la conciliación con el padrón (para probar sin esperar al cron).
router.post('/conciliar', async (req, res) => {
  try {
    const r = await conciliarTicketsBolt();
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [Pendientes BOLT] /conciliar:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Marca un candidato como rechazado por BOLT (revisado a mano en la plataforma).
router.post('/rechazar', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await marcarRechazadoBolt(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
