const express = require('express');
const router = express.Router();
const { leerTablero, guardarCambios } = require('../services/planificadorV2');

router.get('/', (req, res) => {
  res.render('matching', { titulo: 'Matching', seccion: 'matching', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    const t = await leerTablero();
    res.json({
      sugerencias: t.sugerencias,
      pendientes: t.pendientes,
      bases: t.bases,
      demandaPorZona: t.resumen.demandaPorZona
    });
  } catch (error) {
    console.error('❌ [MATCHING] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

/**
 * Asigna a un conductor la plaza sugerida.
 * Reutiliza el mismo guardado que el planificador: relee la hoja, aplica el
 * cambio encima y recalcula, así que pasa por todas las validaciones (turno
 * cruzado, solapes, libranza…) igual que si se hubiera hecho a mano allí.
 */
router.post('/api/asignar', async (req, res) => {
  try {
    const { id, coche, slot, dias } = req.body || {};
    if (!id) return res.status(400).json({ status: 'error', msg: 'Falta el conductor' });
    if (coche === undefined || slot === undefined) {
      return res.status(400).json({ status: 'error', msg: 'Falta la plaza de destino' });
    }

    const cambio = { coche, slots: [{ slot, id }] };
    if (dias !== undefined && dias !== '') cambio.slots[0].dias = dias;

    const r = await guardarCambios([cambio]);
    const destino = r.tablero.coches[coche];
    const persona = destino.personas[slot];

    console.log(`🎯 [MATCHING] ${id} → ${destino.matricula} (${persona.etiqueta})`);

    res.json({
      status: 'ok',
      matricula: destino.matricula,
      plaza: persona.etiqueta,
      conflictos: destino.conflictos || [],
      huecosRestantes: destino.numLibres
    });
  } catch (error) {
    console.error('❌ [MATCHING] /api/asignar:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
