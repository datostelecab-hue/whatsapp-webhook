// ============================================================
// BARCELONA · RECAUDACIÓN — rutas, en /barcelona/recaudacion
// ============================================================
// Las mismas rutas que la recaudación de Madrid (el mismo controlador, armado
// sobre el servicio de Barcelona) y la misma pantalla, con su base, su nombre y
// que la gente es su cuenta de BOLT. La llave la pide services/sesion.js por la
// ruta: /barcelona/recaudacion está en el catálogo de permisos.

const { crear } = require('../Administracion/recaudacion.controller');
const servicio = require('./recaudacion.service');

module.exports = crear(servicio, {
  titulo: 'Recaudación · Barcelona',
  seccion: 'bcn-recaudacion',
  etiqueta: 'Recaudación Barcelona',
  vista: { base: '/barcelona/recaudacion', sedeNombre: 'Barcelona', soloCuentas: true },
});
