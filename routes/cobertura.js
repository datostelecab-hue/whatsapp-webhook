const express = require('express');
const router = express.Router();
const { leerTablero, DIAS_SEM, TURNOS } = require('../services/planificadorV2');
const { instruccionesPorConductor } = require('../services/turnosConductor');

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
    // ?semana=N: 0 = actual, 1 = la que viene, etc. Para "ver el futuro".
    const offsetSemana = Math.max(0, Math.min(8, parseInt(req.query.semana) || 0));
    const t = await leerTablero({ offsetSemana });

    // Los relevos de todos los coches, en una sola lista para poder filtrarlos
    // por persona: cada conductor quiere saber a quién entrega y de quién recibe.
    const relevos = [];
    t.coches.forEach(c => (c.relevos || []).forEach(r => relevos.push(r)));

    res.json({
      semanaInfo: t.semanaInfo,
      cobertura: t.cobertura,
      ausentesEnPlaza: t.ausentesEnPlaza || [],
      relevos,
      porConductor: instruccionesPorConductor(t),
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
