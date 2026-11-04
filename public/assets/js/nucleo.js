// ============================================================
// EL NÚCLEO DEL FRONT — lo que cada pantalla escribía a su manera
// ============================================================
// Cada vista traía su propio `esc` (35 copias, no todas iguales). Ahora es uno.
// Se carga el PRIMERO del layout, porque las vistas lo toman al arrancar
// (`const esc = Casa.esc;`).
//
//   Casa.esc(texto)              para meter un dato en HTML (los cinco: & < > " ')
//   Casa.tonoEstadoCoche(codigo) el color del estado de un coche (cat_estado_vehiculo)
//
// Hablar con el servidor es Api (api.js); los formatos de una lista, Listado.fmt.

(function (global) {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESCAPES[c]);

  // EL COLOR DE CADA ESTADO DEL COCHE. El catálogo solo guarda el código («el
  // icono lo decide la interfaz»), y estaba copiado en el Planificador y en
  // Vehículos; en Vehículos faltaba Emergencia (E) y salía en gris.
  const TONO_ESTADO_COCHE = { O: 'green', R: 'gold', T: 'violet', X: 'warn', S: 'red', E: 'gold', B: 'muted', P: 'azul' };
  const tonoEstadoCoche = cod => TONO_ESTADO_COCHE[cod] || 'muted';

  global.Casa = { esc, TONO_ESTADO_COCHE, tonoEstadoCoche };
})(window);
