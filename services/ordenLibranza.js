// ============================================================
// LOS COCHES DE UN CUADRANTE, POR SU LIBRANZA (23/11/2026)
// ============================================================
// Camilo: «los cuadrantes y el excel deben de ordenarse por día (…) hay
// cuadrantes con 2 o 3 coches que están desordenados, esto es más que todo
// para los fijos que coincidan con días de libranza (…) si ambos libran por
// ejemplo L M, esos serán los primeros, luego los que libran X J y así
// sucesivamente».
//
// Dentro de un cuadrante: primero los que libran antes en la semana (L M, luego
// M X, X J…), comparando los días en orden; los que no libran, al final. Madrid
// (el tablero y la parrilla) y Barcelona (su planificador y su Excel) usan esto.
// La pantalla de Madrid lleva la misma regla en
// public/assets/js/vistas/Planificacion/planificador/cuadrante.js.
'use strict';

/** Los días (1 = lunes … 7 = domingo), sin repetir y en orden. Puro. */
const normalizar = dias => [...new Set((dias || []).map(Number).filter(n => n >= 1 && n <= 7))].sort((a, b) => a - b);

/** Compara dos libranzas: la que empieza antes va antes; sin libranza, al final. Puro. */
function compararDias(a, b) {
  const x = normalizar(a), y = normalizar(b);
  if (!x.length || !y.length) return Number(!x.length) - Number(!y.length);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] == null) return -1;
    if (y[i] == null) return 1;
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/**
 * Compara dos coches por la libranza de sus fijos: la del de día y, si empata,
 * la del de noche; y si empatan las dos, por matrícula. `libranzas(coche)` da
 * { dia, noche } (los días de cada fijo).
 */
const porLibranza = libranzas => (a, b) => {
  const la = libranzas(a), lb = libranzas(b);
  return compararDias(la.dia, lb.dia) || compararDias(la.noche, lb.noche)
    || String(a.matricula || '').localeCompare(String(b.matricula || ''));
};

module.exports = { compararDias, porLibranza };
