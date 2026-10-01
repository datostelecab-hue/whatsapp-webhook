// ============================================================
// INCORPORACIONES — la puerta para quien no es Selección
// ============================================================
// La incorporación nace de una VACANTE cumplida: alguien entra a cubrir unas
// plazas, y Tráfico tiene que colocarlo. Las vacantes son de Selección, así que
// las incorporaciones también (`incorporaciones.repo.js`, que hasta el
// 01/10/2026 vivía suelto en services/repo/ y entraba por la puerta de atrás en
// el repositorio de vacantes).
//
// Planificación las ve y las resuelve desde el tablero, y las notificaciones
// las cuentan: los dos entran por aquí, no por el repositorio. Dentro de
// Selección (el alta de la ETT, pasar a RRHH) se usa el repositorio directamente.
//
// No decide nada: es la puerta. Las reglas —qué foto se guarda, cuándo queda
// cubierta la vacante— están en el repositorio y en su cabecera.

const repo = require('./incorporaciones.repo');

module.exports = {
  crear: (...a) => repo.crear(...a),
  pendientes: (...a) => repo.pendientes(...a),
  viva: (...a) => repo.viva(...a),
  encargoDeColocar: (...a) => repo.encargoDeColocar(...a),
  encargoDeQuitar: (...a) => repo.encargoDeQuitar(...a),
  marcarColocada: (...a) => repo.marcarColocada(...a),
  marcarAceptada: (...a) => repo.marcarAceptada(...a),
  rechazar: (...a) => repo.rechazar(...a),
};
