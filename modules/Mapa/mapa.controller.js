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
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

/**
 * QUÉ SEDES PUEDE VER QUIEN MIRA.
 *
 * El mapa se recorta igual que Vehículos, Mantenimientos y Facturas: quien no
 * tenga la llave `/vehiculos/sedes` ve SOLO Madrid, que es lo que se pidió. Se
 * hace por el permiso y no fijando 'madrid' a secas para no dejar a Óscar sin
 * sus coches de Barcelona el día que abra el mapa.
 *
 * Ante CUALQUIER fallo, Madrid. Fallar hacia cerrado: nunca de más.
 */
async function todasLasSedes(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = (u && u.id) || await actor.idDe(req);
    return id ? (await permisos.clavesDe(id)).has('/vehiculos/sedes') : false;
  } catch (_) { return false; }
}

router.get('/', (req, res) => {
  res.render('mapa', { titulo: 'Mapa de flota', seccion: 'mapa', layout: 'layout-gestion' });
});

/**
 * El fotograma. `?forzar=1` se salta la caché de diez segundos: lo manda el
 * botón de recargar, que se pulsa justo cuando alguien no se fía de lo que ve.
 */
router.get('/api/coches', async (req, res) => {
  try {
    const sedes = veh.sedesDe({ todasLasSedes: await todasLasSedes(req) });
    const d = await mapa.frente({ forzar: req.query.forzar === '1', sedes });
    res.json({ status: 'ok', sedes, ...d });
  } catch (e) {
    console.error('❌ [MAPA] coches:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
