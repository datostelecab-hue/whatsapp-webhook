// Se mudó a modules/Vehiculos/vehiculos.service.js: enlazar coches con Mapon y
// refrescar odómetros es el servicio de dominio de Vehículos, no un servicio
// suelto. Reexportador temporal.
module.exports = require('../modules/Vehiculos/vehiculos.service');
