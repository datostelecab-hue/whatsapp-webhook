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
// Y el 23/10/2026, de la boya: «En la auditoría, si subió tanto % por encima no
// importa, la auditoría va por debajo».
//
//   GPS   distancia del coche a la gasolinera:                       < 700 m · < 1600 m · ≥ 1600 m
//   Boya  DÉFICIT: max(0, litros pagados − boya) / litros pagados:   < 35 %  · < 65 %   · ≥ 65 %
//
// LA BOYA SOLO CUENTA LO QUE FALTA (combustible.boya.deficitPct). Hasta el
// 23/10/2026 era |boya − pagado| / pagado, por arriba y por abajo, y el 7909LRJ
// (su aforador marca 3-4 L de más) salía amarillo en dos repostajes pequeños
// sin que faltara gasolina. Si el depósito subió lo pagado o más, es 0 %: verde,
// suba lo que suba. La pantalla lo dice: «faltan X L (Y %)» o «subió X L más de
// lo pagado», sin penalizar.
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
// déficit con un decimal, y con eso se decide: 699,6 m son «700 m», amarillo, y
// un 34,96 % es «35,0 %», amarillo. Decidido así el 23/10/2026 para que lo que
// dice la pantalla y su color no se contradigan nunca («700 m» en verde no se
// entendería). La diferencia no significa nada: el GPS se mueve varios metros y
// el aforador va en litros enteros.
//
// UN MÍNIMO SOLO DICE VERDE O NADA. Si el aforador topó en su techo y no se pudo
// corregir, lo que subió es «como poco eso» (combustible.boya.esMinimo). Si ese
// mínimo ya llega a lo pagado, el déficit es 0 y es VERDE: como poco entró lo
// pagado. Si se queda corto, no se puede saber cuánto falta —puede ser solo el
// techo— y va SIN COLOR (la auditoría ni guarda el déficit). Hasta el 23/10/2026
// era al revés: con el error en valor absoluto, un mínimo por encima de lo
// pagado era «como poco ese error» y solo podía decir amarillo o rojo.

const UMBRALES = {
  gpsM: [700, 1600],        // verde por debajo del primero, amarillo del segundo, rojo desde ahí
  boyaPct: [35, 65],        // del déficit
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
 * El color de la boya por su DÉFICIT en % (null sin déficit). Con `minimo` (lo
 * que subió es como poco eso): 0 % es verde y cualquier otro, sin color.
 */
function colorBoya(pct, { minimo } = {}) {
  const c = tramo(pct, UMBRALES.boyaPct);
  if (!minimo || c == null) return c;
  return Number(pct) === 0 ? 'verde' : null;
}

/** El peor de varios colores; null si ninguno tiene. */
function peor(...colores) {
  return colores.reduce((a, c) => ((ORDEN[c] || 0) > (ORDEN[a] || 0) ? c : a), null);
}

module.exports = { UMBRALES, ORDEN, colorGps, colorBoya, peor };
