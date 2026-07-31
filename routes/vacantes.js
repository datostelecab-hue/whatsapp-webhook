const express = require('express');
const router = express.Router();
const { leerVacantesGuardadas } = require('../services/vacantes');
const { leerTickets } = require('../services/tickets');

// Vacantes que Tráfico guardó desde el generador. Son las que Selección recluta.
router.get('/', (req, res) => {
  res.render('vacantes', {
    titulo: 'Vacantes',
    seccion: 'vacantes',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const [todas, tickets] = await Promise.all([leerVacantesGuardadas(), leerTickets()]);
    // Pendientes = aún sin resolver (Abierta o En proceso de alta). Resueltas = Cerrada.
    const pendientes = todas.filter(v => v.estado !== 'Cerrada' && v.estado !== 'Cubierta');
    const resueltas = todas.filter(v => v.estado === 'Cerrada');

    // Candidatos que Selección enganchó a cada vacante, con su etapa actual.
    const porVac = new Map();
    (tickets.lista || []).forEach(t => {
      if (!t.vacante) return;
      if (!porVac.has(t.vacante)) porVac.set(t.vacante, []);
      porVac.get(t.vacante).push({ nombre: t.nombre || t.id, tel: t.id, estado: t.estado });
    });
    [...pendientes, ...resueltas].forEach(v => { v.candidatos = porVac.get(v.id) || []; });

    res.json({
      status: 'ok',
      vacantes: pendientes, resueltas,
      contadores: {
        abiertas: pendientes.filter(v => v.estado === 'Abierta').length,
        proceso: pendientes.filter(v => v.estado === 'En proceso de alta').length,
        resueltas: resueltas.length,
        dia: pendientes.filter(v => v.turno === 'Día').length,
        noche: pendientes.filter(v => v.turno === 'Noche').length
      }
    });
  } catch (error) {
    console.error('❌ [Vacantes] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
