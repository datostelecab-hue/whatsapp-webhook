const express = require('express');
const router = express.Router();
const { leerTablero, DIAS_SEM, TURNOS } = require('../services/planificadorV2');

router.get('/', (req, res) => {
  res.render('cobertura', {
    titulo: 'Cobertura',
    seccion: 'cobertura',
    layout: 'layout-gestion',
    diasSem: DIAS_SEM,
    turnos: TURNOS
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const t = await leerTablero();

    // Los relevos de todos los coches, en una sola lista para poder filtrarlos
    // por persona: cada conductor quiere saber a quién entrega y de quién recibe.
    const relevos = [];
    t.coches.forEach(c => (c.relevos || []).forEach(r => relevos.push(r)));

    res.json({
      cobertura: t.cobertura,
      relevos,
      coches: t.coches
        .filter(c => c.matricula && c.operativo)
        .map(c => ({
          matricula: c.matricula, zona: c.zona,
          semana: c.semana, relevos: c.relevos,
          numLibres: c.numLibres, hayError: c.hayError
        })),
      resumen: t.resumen
    });
  } catch (error) {
    console.error('❌ [COBERTURA] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
