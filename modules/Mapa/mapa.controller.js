// ============================================================
// MAPA — rutas
// ============================================================
// Dos: la pantalla y el fotograma que pide cada 30 segundos.

const express = require('express');
const router = express.Router();
// Por el SERVICIO, que es la puerta del módulo. El repositorio no se toca
// desde aquí. Y `facturas.service` es la puerta del módulo de al lado: de ahí
// salen las sedes, que no se escriben a mano en ningún sitio.
const mapa = require('./mapa.service');
const veh = require('../Vehiculos/facturas.service');

router.get('/', (req, res) => {
  res.render('mapa', { titulo: 'Mapa de flota', seccion: 'mapa', layout: 'layout-gestion' });
});

/**
 * El fotograma. `?forzar=1` se salta la caché de diez segundos: lo manda el
 * botón de recargar, que se pulsa justo cuando alguien no se fía de lo que ve.
 */
router.get('/api/coches', async (req, res) => {
  try {
    // SOLO MADRID, para todo el mundo (24/09/2026). Lo pidio Camilo: la flota
    // del mapa es la que tiene a su cargo Oscar, que es la de Madrid, y la
    // misma que sale en Mantenimientos. Antes dependia de la llave
    // '/vehiculos/sedes' -quien la tenia veia tambien Barcelona- y por eso el
    // mapa y Mantenimientos no contaban los mismos coches.
    const sedes = [veh.SEDE_POR_DEFECTO];
    const d = await mapa.frente({ forzar: req.query.forzar === '1', sedes });
    res.json({ status: 'ok', sedes, ...d });
  } catch (e) {
    console.error('❌ [MAPA] coches:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
