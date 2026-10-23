// ============================================================
// COMBUSTIBLE · DE QUÉ COLOR SE PINTA UN REPOSTAJE
// ============================================================
// Puro. Los dos criterios de la auditoría con Mapon y sus umbrales, tal como los
// puso Camilo el 22/10/2026:
//
//   «Con el criterio del GPS con un margen de error de menos de 700 m de verde,
//   menos de 1600 m de amarillo y más de 1600 m de rojo. Para lo de la boya
//   como me dijiste que llegaba hasta un 33% de error, entonces de verde < 35%,
//   de amarillo <65% y rojo >= 65%.»
//
//   GPS   distancia del coche a la gasolinera del correo:  < 700 m · < 1600 m · ≥ 1600 m
//   Boya  |litros de la boya − litros del correo| / litros: < 35 %  · < 65 %   · ≥ 65 %
//
// El 33 % es lo que se equivoca el aforador coche a coche sin calibrar (de un
// 33 % menos en el 0802MJY a un 13 % más en el 1085MJY; Mapon.md). Por eso el
// verde de la boya es tan ancho: por debajo de eso no se puede acusar a nadie.
//
// LA FILA SE PINTA POR EL PEOR de los dos que tengan color: rojo > amarillo >
// verde. Sin dato en uno, manda el otro; sin dato en los dos, sin color. Los
// colores se calculan al leer, no se guardan: si un día cambian los umbrales,
// cambia todo el histórico con ellos.
//
// EL UMBRAL SE APLICA A LA CIFRA QUE SE VE. Los metros se guardan enteros y el
// error con un decimal, y con eso se decide: 699,6 m son «700 m», amarillo, y
// un 34,96 % es «35,0 %», amarillo. Decidido así el 23/10/2026 para que lo que
// dice la pantalla y su color no se contradigan nunca («700 m» en verde no se
// entendería). La diferencia no significa nada: el GPS se mueve varios metros y
// el aforador va en litros enteros.
//
// UN MÍNIMO NO DA VERDE. Si el aforador topó en su techo y no se pudo corregir,
// el error guardado es «como poco ese» (combustible.boya.esMinimo): basta para
// decir amarillo o rojo, pero no para decir verde, porque el de verdad puede
// ser mayor. Un mínimo por debajo del 35 % queda sin color (revisión del
// 23/10/2026: el 3814KYG salía verde con «13,6 %» cuando eran al menos 29 L).

const UMBRALES = {
  gpsM: [700, 1600],        // verde por debajo del primero, amarillo del segundo, rojo desde ahí
  boyaPct: [35, 65],
};

const ORDEN = { verde: 1, amarillo: 2, rojo: 3 };

function tramo(valor, [verde, amarillo]) {
  if (valor === null || valor === undefined || valor === '' || !Number.isFinite(Number(valor))) return null;
  const v = Number(valor);
  return v < verde ? 'verde' : v < amarillo ? 'amarillo' : 'rojo';
}

/** El color del GPS por los metros a la gasolinera (null sin distancia). */
const colorGps = metros => tramo(metros, UMBRALES.gpsM);

/**
 * El color de la boya por su error en % (null sin error). Con `minimo` (el
 * error es como poco ese), solo amarillo o rojo: un verde no se puede afirmar.
 */
function colorBoya(pct, { minimo } = {}) {
  const c = tramo(pct, UMBRALES.boyaPct);
  return minimo && c === 'verde' ? null : c;
}

/** El peor de varios colores; null si ninguno tiene. */
function peor(...colores) {
  return colores.reduce((a, c) => ((ORDEN[c] || 0) > (ORDEN[a] || 0) ? c : a), null);
}

module.exports = { UMBRALES, ORDEN, colorGps, colorBoya, peor };
