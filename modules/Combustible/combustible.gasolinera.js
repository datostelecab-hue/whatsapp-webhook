// ============================================================
// COMBUSTIBLE · DE QUÉ GASOLINERA ES EL REPOSTAJE, Y A CUÁNTO ESTABA EL COCHE
// ============================================================
// Puro: ni base ni red. El nombre de la estación que trae el correo, con qué
// gasolinera de la lista casa (tabla `gasolinera`, db/213) y la distancia entre
// dos puntos.
//
// EL CORREO Y LA LISTA NO LLAMAN IGUAL A LA MISMA GASOLINERA. La lista es la de
// Ballenoil con sus «nombres de fantasía» (el Excel que pasó Camilo el
// 22/10/2026); el correo trae el nombre de la estación en su sistema:
//
//   correo                              lista
//   «COSLADA»                           «Ballenoil Coslada I»
//   «PRAT DE LLOBREGAT (EL)»            «Ballenoil El Prat»
//   «HOSPITALET DE LLOBREGAT (L´)»      «Ballenoil Hospitalet de Llobregat»
//   «CORNELLÀ DE LLOBREGAT II»          «Ballenoil Cornellà II»
//   «BARCELONA- ASUNCION»               «Ballenoil Barcelona - Asunción»
//   «BARCELONA - CLOT»                  «Ballenoil Clot»
//   «MONTMELÓ»                          «Ballenoil Montmeló»
//
// Así que se casa POR SUS PALABRAS, como el nombre de la tarjeta: sin
// «Ballenoil», sin tildes, mayúsculas ni signos, sin artículos ni preposiciones
// («de», «(EL)», «(L')» delante o detrás dan igual: se quitan) y con el número
// romano aparte. El número tiene que ser el mismo, y sin número es el I
// («COSLADA» es «Coslada I», no «Coslada III»). Luego:
//
//   · exacto    las mismas palabras («GALAPAGAR» y «Galapagar»).
//   · parecido  las palabras de uno están todas en el otro («PRAT DE
//               LLOBREGAT (EL)» → prat llobregat; «El Prat» → prat). Salvo
//               si al correo le SOBRA una palabra que señala a otra gasolinera
//               del mismo sitio: «ALCORCON - EL CANO» tiene todo lo de
//               «Alcorcón I», pero «cano» es de «Alcorcón II (El Cano)». Eso
//               es ambiguo (abajo, `laSenalaOtra`).
//   · ambiguo   vale para más de una gasolinera: NO se casa con ninguna.
//               Casar mal es peor que no casar: la distancia del GPS se
//               mediría contra la que no es y pintaría de rojo a quien repostó
//               donde decía. La sede del coche desempata, si la hay.
//   · ninguna   no se parece a ninguna. Se dice, y en la ficha se puede poner
//               a mano (y queda apuntada para los siguientes: `gasolinera_alias`).
//
// NUNCA SE CASA POR EL GPS. La auditoría mide si el coche estaba en la
// gasolinera del correo: elegir la gasolinera por dónde estaba el coche sería
// darle la razón antes de mirarlo. El GPS solo enseña, aparte, cuál de la lista
// tenía más cerca.

const ROMANOS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

// Lo que no distingue una gasolinera de otra: artículos y preposiciones, en
// castellano y en catalán («(EL)», «(L´)», «de», «del», «les»). La «i» NO va
// aquí aunque en catalán sea «y»: en los nombres siempre es el número romano
// («Mataró I», «Sant Boi I»).
const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'l', 'd', 'les', 'al', 'y', 'e', 'en', 'ballenoil', 'petroprix']);

// Abreviaturas que se han visto en los correos: «SANT BOI DE LL. NORTE».
const ABREVIATURAS = { ll: 'llobregat', sta: 'santa', sto: 'santo', avda: 'avenida' };

/**
 * Un nombre de estación, por sus palabras: { palabras, numero, clave }.
 * `palabras` va ordenada y sin repetir; `numero` es el romano (1 si no lleva).
 */
function normalizar(texto) {
  const t = String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');                       // apóstrofos, guiones, paréntesis, puntos
  let numero = null;
  const palabras = new Set();
  for (let p of t.split(' ')) {
    if (!p) continue;
    p = ABREVIATURAS[p] || p;
    if (VACIAS.has(p)) continue;
    // El primer romano es el número de la estación; si hubiera otro, es parte
    // del nombre («Móstoles VI - Aidater I»). Un correo que solo lo lleve en
    // el subnombre («MOSTOLES - AIDATER II») lo toma por el número —sería el
    // II—, pero «aidater» le sobra a «Móstoles II» y señala a las VI y VII:
    // sale ambiguo, no la que no es (`laSenalaOtra`).
    if (numero === null && ROMANOS[p]) { numero = ROMANOS[p]; continue; }
    palabras.add(p);
  }
  const lista = [...palabras].sort();
  return { palabras: lista, numero: numero || 1, clave: lista.join(' ') + (numero && numero > 1 ? ' #' + numero : '') };
}

/** Las formas de llamar a una gasolinera de la lista: «Cerdanyola del Vallès / Sardañola del Vallés» son dos. */
const formas = nombre => String(nombre || '').split('/').map(normalizar).filter(n => n.palabras.length);

/** 'exacto', 'parecido' o null: si dos nombres ya normalizados son la misma estación. */
function comoCasan(a, b) {
  if (!a.palabras.length || !b.palabras.length || a.numero !== b.numero) return null;
  if (a.palabras.join(' ') === b.palabras.join(' ')) return 'exacto';
  const [corto, largo] = a.palabras.length <= b.palabras.length ? [a.palabras, new Set(b.palabras)] : [b.palabras, new Set(a.palabras)];
  return corto.every(p => largo.has(p)) ? 'parecido' : null;
}

/**
 * LO QUE SOBRA EN EL CORREO PUEDE SEÑALAR A OTRA. «Parecido» acepta que todas
 * las palabras de la lista estén en el correo, y no miraba las que sobraban:
 * «ALCORCON - EL CANO» casaba con «Alcorcón I» (sin número es el I) aunque
 * «cano» es de «Alcorcón II (El Cano)». Lo mismo «LEGANES - LA FORTUNA»
 * (Leganés III), «MATARO PARK» (Mataró II), «MOSTOLES - AIDATER» (Móstoles VI
 * o VII)… Con la que no es, el GPS mediría contra otra estación y pintaría de
 * amarillo o rojo a quien repostó donde decía el correo (revisión del
 * 23/10/2026).
 *
 * Así que, si al correo le sobran palabras, se buscan las OTRAS gasolineras
 * que tengan todo lo de esta Y alguna de las que sobran: si hay, es ambiguo.
 * Tienen que tener todo lo de esta, no basta con la palabra que sobra: en
 * «BARCELONA - CLOT» sobra «barcelona», que está en otras cuatro de la lista,
 * pero ninguna es «Clot»; y en «PRAT DE LLOBREGAT (EL)» sobra «llobregat», que
 * es de Hospitalet, no de otro Prat. Esos casan bien y siguen casando.
 *
 * → las otras gasolineras que señala (vacío si ninguna).
 */
function laSenalaOtra(n, g, gasolineras) {
  const f = formas(g.nombre).find(x => comoCasan(n, x));
  if (!f) return [];
  const sobran = n.palabras.filter(p => !f.palabras.includes(p));
  if (!sobran.length) return [];
  return (gasolineras || []).filter(h => h !== g && h.id !== g.id && formas(h.nombre).some(fh =>
    f.palabras.every(p => fh.palabras.includes(p)) && sobran.some(p => fh.palabras.includes(p))));
}

/**
 * Con qué gasolinera de la lista casa la estación del correo.
 *
 * `gasolineras`: [{ id, nombre, sede, ... }] del mismo proveedor.
 * `sede`: la del coche, solo para desempatar.
 *
 * → { como: 'exacto' | 'parecido' | 'ambiguo' | 'ninguna', gasolinera, candidatas }
 *   `gasolinera` solo si es exacto o parecido; `candidatas` dice entre cuáles
 *   dudaba cuando es ambiguo (para enseñarlo).
 */
function casar(estacion, gasolineras, { sede } = {}) {
  const n = normalizar(estacion);
  const nada = { como: 'ninguna', gasolinera: null, candidatas: [] };
  if (!n.palabras.length) return nada;
  for (const nivel of ['exacto', 'parecido']) {
    let vale = (gasolineras || []).filter(g => formas(g.nombre).some(f => {
      const c = comoCasan(n, f);
      return c && (nivel === 'parecido' || c === 'exacto');
    }));
    if (!vale.length) continue;
    if (vale.length > 1 && sede) {
      const deLaSede = vale.filter(g => g.sede === sede);
      if (deLaSede.length) vale = deLaSede;
    }
    if (vale.length > 1) return { como: 'ambiguo', gasolinera: null, candidatas: vale };
    // Con las mismas palabras y el mismo número no hay duda; «parecido», sí.
    if (nivel === 'parecido') {
      const otras = laSenalaOtra(n, vale[0], gasolineras);
      if (otras.length) return { como: 'ambiguo', gasolinera: null, candidatas: [vale[0], ...otras] };
    }
    return { como: nivel, gasolinera: vale[0], candidatas: [] };
  }
  return nada;
}

/**
 * La gasolinera de un repostaje: primero lo que alguien casó a mano para ese
 * nombre de estación (`alias`: Map 'proveedor|clave' → id), y si no, por el
 * nombre entre las del mismo proveedor.
 *
 * → { como, gasolinera, gasolineraId, candidatas (ids) }
 */
function elegir(estacion, { proveedor, sede, gasolineras, alias }) {
  const delProveedor = (gasolineras || []).filter(g => g.proveedor === proveedor);
  const aMano = alias && alias.get(`${proveedor}|${normalizar(estacion).clave}`);
  const puesta = aMano && delProveedor.find(g => g.id === aMano);
  if (puesta) return { como: 'alias', gasolinera: puesta, gasolineraId: puesta.id, candidatas: [] };
  const r = casar(estacion, delProveedor, { sede });
  return { como: r.como, gasolinera: r.gasolinera, gasolineraId: r.gasolinera ? r.gasolinera.id : null,
    candidatas: r.candidatas.map(g => g.id) };
}

// ── LA DISTANCIA ────────────────────────────────────────────────────────────

const RADIO_TIERRA_M = 6371008.8;
const rad = x => x * Math.PI / 180;
const tieneCoordenadas = g => !!g && Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lng)) && g.lat !== null && g.lng !== null;

/** Metros entre dos puntos {lat, lng} (haversine), redondeados; null si falta uno. */
function metros(a, b) {
  if (!tieneCoordenadas(a) || !tieneCoordenadas(b)) return null;
  const la1 = rad(Number(a.lat)), la2 = rad(Number(b.lat));
  const dLat = la2 - la1, dLng = rad(Number(b.lng) - Number(a.lng));
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(q))));
}

/** La gasolinera de la lista (con coordenadas) más cercana a un punto: { gasolinera, metros } o null. */
function masCercana(punto, gasolineras) {
  let mejor = null;
  for (const g of gasolineras || []) {
    const m = metros(punto, g);
    if (m != null && (!mejor || m < mejor.metros)) mejor = { gasolinera: g, metros: m };
  }
  return mejor;
}

/**
 * A cuántos metros estaba el coche de la gasolinera casada, o por qué no se
 * puede decir. Sin distancia, la fila no lleva color por el GPS.
 * → { distancia, motivo }
 */
function distanciaA({ posicion, gasolinera, como, estacion, sinPosicion }) {
  if (!posicion) return { distancia: null, motivo: sinPosicion || 'No se sabe dónde estaba el coche a esa hora' };
  if (!gasolinera) {
    return { distancia: null, motivo: como === 'ambiguo'
      ? `«${estacion || ''}» vale para varias gasolineras de la lista: no se casa con ninguna (se puede poner a mano)`
      : `«${estacion || ''}» no casa con ninguna gasolinera de la lista (se puede poner a mano)` };
  }
  if (!tieneCoordenadas(gasolinera)) return { distancia: null, motivo: `${gasolinera.nombre} no tiene coordenadas en la lista` };
  return { distancia: metros(posicion, gasolinera), motivo: null };
}

module.exports = { normalizar, casar, elegir, metros, masCercana, distanciaA };
