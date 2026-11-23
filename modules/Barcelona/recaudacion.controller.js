// ============================================================
// BARCELONA · RECAUDACIÓN — rutas, en /barcelona/recaudacion
// ============================================================
// Las mismas rutas que la recaudación de Madrid (el mismo controlador, armado
// sobre el servicio de Barcelona) y la misma pantalla, con su base, su nombre y
// que la gente es su cuenta de BOLT. La llave la pide services/sesion.js por la
// ruta: /barcelona/recaudacion está en el catálogo de permisos.

const { crear } = require('../Administracion/recaudacion.controller');
const servicio = require('./recaudacion.service');

const router = crear(servicio, {
  titulo: 'Recaudación · Barcelona',
  seccion: 'bcn-recaudacion',
  etiqueta: 'Recaudación Barcelona',
  // conFechas: la pestaña «Por fechas», solo de Barcelona (23/11/2026).
  vista: { base: '/barcelona/recaudacion', sedeNombre: 'Barcelona', soloCuentas: true, conFechas: true },
});

// POR FECHAS, DE X A Y (23/11/2026): lo cobrado, entregado y dado de cada cuenta
// en esos días. Una consulta: no congela ni cambia nada. La llave, la de la ruta.
router.get('/api/fechas', async (req, res) => {
  try { res.json({ status: 'ok', ...(await servicio.porFechas({ desde: req.query.desde, hasta: req.query.hasta })) }); }
  catch (e) {
    console.error('❌ [Recaudación Barcelona] por fechas:', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
