// Se mudó a modules/Vehiculos/vehiculos.controller.js (Fase 2 de la
// reorganización: un módulo por negocio, con sus capas dentro).
//
// Esta línea existe para que una referencia que se haya escapado siga
// funcionando en vez de dar un 500 en producción. Se borra cuando
// `node scripts/inventario-muerto.js` diga que ya no la apunta nadie.
module.exports = require('../modules/Vehiculos/vehiculos.controller');
