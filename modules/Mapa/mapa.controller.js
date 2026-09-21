// ============================================================
// MAPA — rutas
// ============================================================
// Dos: la pantalla y el fotograma que pide cada 30 segundos.

const express = require('express');
const router = express.Router();
// Por el SERVICIO, que es la puerta del módulo. El repositorio no se toca
// desde aquí.
const mapa = require('./mapa.service');

router.get('/', (req, res) => {
  res.render('mapa', { titulo: 'Mapa de flota', seccion: 'mapa', layout: 'layout-gestion' });
});

/**
 * El fotograma. `?forzar=1` se salta la caché de diez segundos: lo manda el
 * botón de recargar, que se pulsa justo cuando alguien no se fía de lo que ve.
 */
router.get('/api/coches', async (req, res) => {
  try {
    const d = await mapa.frente({ forzar: req.query.forzar === '1' });
    res.json({ status: 'ok', ...d });
  } catch (e) {
    console.error('❌ [MAPA] coches:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
