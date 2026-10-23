// ============================================================
// COMBUSTIBLE · LO QUE DICE LA BOYA DEL DEPÓSITO
// ============================================================
// Puro: ni base ni red. De la serie del aforador de Mapon (la boya del
// depósito, leída por el CAN) a cuántos litros subió el depósito en un
// repostaje, para compararlo con los litros del correo.
//
// LO QUE SE SABE DEL AFORADOR (docs/integraciones/Mapon.md, «Combustible»,
// medido del 14 al 21/10/2026):
//
//   · Litros ENTEROS, y baila ±1 L. Por eso se mira la mediana de 5 lecturas
//     antes y la de 5 después, nunca una lectura suelta.
//   · Solo lee con el coche encendido: mientras se reposta, con el coche
//     apagado, no hay lecturas. Las de antes son de cuando llegaba a la
//     gasolinera y las de después, de cuando arrancó. En los Ioniq la aguja
//     sube despacio (de 10 a 35 L en cuatro minutos tras arrancar, 8997LDK el
//     22/10), así que «después» se busca hasta 15 minutos más allá del primer
//     dato alto, no en el primero.
//   · Tiene TECHO: 31 Toyota no marcan nunca más de 40 L, 19 llegan a 45 y los
//     Ioniq a 43-44. Lo que se eche por encima no se ve. Si después del
//     repostaje el aforador está en el techo, se corrige como hizo el análisis
//     del 9001LWJ (Scripts de análisis/mapon-combustible/6-auditar-repostaje.js):
//     se busca cuándo vuelve a bajar de verdad del techo (mediana de 5 ≤ techo
//     − 2) y se le suma lo que el coche gastó hasta entonces —el gastado de la
//     centralita (`can.fuel_total`) si lo da, o los km a 4,77 L/100 km, la media
//     de la flota—. Lo repostado ≈ (nivel entonces + gastado) − nivel antes.
//   · Los Ford Mondeo dan el nivel en PORCENTAJE (otra serie). Sin la capacidad
//     del depósito no se pasa a litros: el salto se guarda en %, sin error.
//
// LA PARADA TIENE QUE SER DE VERDAD. Si dentro de una parada larga el aforador
// se mueve (`cambioDentro`), el coche estaba encendido y andando: es el GPS el
// que se quedó clavado, y esa parada no vale ni para el GPS ni para la boya.
//
// EL SALTO, ALREDEDOR DE LA HORA DEL CORREO. No hace falta encontrar el
// repostaje entre todos los de la semana (eso hacía 3-repostajes.js con su
// umbral de 10 L, que dejaría fuera los de 9 L de verdad): se sabe cuándo fue.
//
//   · Con la PARADA de Mapon que cubre esa hora (el coche apagado en el
//     surtidor): «antes» son las 5 últimas lecturas hasta que paró y
//     «después», las 5 primeras pasados 5 minutos desde que arrancó. Los 5
//     minutos son por la aguja de los Ioniq; en un Toyota la primera lectura ya
//     es la buena, y 5 minutos andando gastan unas décimas.
//   · Sin parada (el coche no se apagó, o Mapon no la vio): las 5 lecturas que
//     acaban 10 minutos antes de la hora del correo y las 5 que empiezan 10
//     minutos después. El correo da la hora en minutos y no se sabe si es el
//     principio o el final del surtidor: 10 minutos a cada lado lo cubren.
//
// NO se busca «la subida mayor» entre muchos cortes posibles: se probó el
// 22/10/2026 con los repostajes de verdad y, con el aforador bailando ±2 L
// mientras el coche anda, el máximo coge siempre el valle de antes y el pico
// de después (7909LRJ en el Clot: 13 L donde la subida era de 11). Y «después»
// tiene que ser DESPUÉS: el 3814KYG repostó a las 16:57 y Mapon aún no tenía
// lecturas de cuando arrancó; buscando la subida mayor salía «0 L», un rojo
// de mentira. Sin lecturas de después, se espera y se vuelve a mirar.
//
// Si no hubo repostaje en ese coche, la subida sale de 0-2 L y el déficit, cerca
// del 100 %: es justo lo que se quiere ver.
//
// SOLO CUENTA LO QUE FALTA (23/10/2026, `deficitPct`). Si subió lo pagado o
// más, no hay nada que auditar: el aforador de muchos coches marca de más.

const L100_FLOTA = 4.77;        // L/100 km de los Corolla del 14 al 21/10/2026 (Mapon.md)
const TECHO_MINIMO = 38;        // por debajo, el máximo de la serie no es un techo: es que nunca llenó
const MAXIMO_POSIBLE_L = 80;    // más que esto no cabe en el depósito de un turismo: es una lectura rota
const VECES_TECHO = 3;          // un techo se repite; una lectura suelta no lo es
const ANTES_MAX_MS = 6 * 3600e3;      // la última lectura de antes, como mucho 6 h antes (parado no gasta)
const DESPUES_MAX_MS = 6 * 3600e3;    // la primera de después, como mucho 6 h después
const AGUJA_MS = 5 * 60e3;            // lo que tarda la aguja del Ioniq en llegar arriba tras arrancar
const SIN_PARADA_MS = 10 * 60e3;      // sin parada, el margen a cada lado de la hora del correo
const N = 5;                          // lecturas por lado, y como mínimo 3

/** La mediana como en los análisis: el del medio, o el de arriba de los dos del medio. */
function mediana(valores) {
  if (!valores.length) return null;
  const s = [...valores].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Las lecturas válidas, ordenadas: [{ t (ms), v }]. Un valor vacío se quita
 * ANTES de pasarlo a número: Number(null) es 0, y un 0 de mentira en mitad de
 * la serie sería un repostaje de 40 L al lado.
 */
const limpiar = lecturas => (lecturas || [])
  .filter(p => p && p.v !== null && p.v !== undefined && p.v !== '')
  .map(p => ({ t: Number(p.t), v: Number(p.v) }))
  .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
  .sort((a, b) => a.t - b.t);

/**
 * La subida del aforador en el repostaje de las `t` (ms). `parada`: la de
 * Mapon que cubre esa hora, { desde, hasta } en ms, si la hay.
 *
 * → { ok: true, antes, despues, salto, tAntes, tDespues, iDespues, conParada }
 * → { ok: false, motivo, reintentar, sinSerie }
 *     reintentar: las lecturas que faltan pueden llegar luego.
 *     sinSerie: no hay ni una lectura en días: el coche no da el nivel.
 */
function salto(lecturasCrudas, t, { parada } = {}) {
  const s = limpiar(lecturasCrudas);
  if (!s.length) return { ok: false, motivo: 'Mapon no tiene ni una lectura del aforador de este coche en esos días', reintentar: false, sinSerie: true };
  const conParada = !!(parada && Number.isFinite(parada.desde));
  if (conParada && parada.hasta == null) {
    return { ok: false, motivo: 'El coche sigue parado en la gasolinera según Mapon: falta el nivel de cuando arranque', reintentar: true };
  }
  // Hasta dónde llega «antes» y desde dónde empieza «después».
  const finAntes = conParada ? parada.desde + 60e3 : t - SIN_PARADA_MS;
  const arranque = conParada ? parada.hasta : t + SIN_PARADA_MS;

  const previas = s.filter(p => p.t <= finAntes && p.t >= finAntes - ANTES_MAX_MS).slice(-N);
  if (previas.length < 3) {
    return { ok: false, motivo: 'No hay lecturas del aforador en las 6 horas antes del repostaje', reintentar: true };
  }
  // Pasados los 5 minutos de la aguja; si en ese rato el coche volvió a parar,
  // valen las del principio (en un Toyota ya son las buenas).
  const enVentana = desdeMs => s.filter(p => p.t >= desdeMs && p.t <= arranque + DESPUES_MAX_MS);
  let siguientes = (conParada ? enVentana(arranque + AGUJA_MS) : enVentana(arranque)).slice(0, N);
  if (conParada && siguientes.length < 3) siguientes = enVentana(arranque).slice(0, N);
  if (siguientes.length < 3) {
    return { ok: false, reintentar: true,
      motivo: 'Todavía no hay lecturas del aforador de después del repostaje (el coche no ha vuelto a arrancar o Mapon aún no las tiene)' };
  }
  const antes = mediana(previas.map(p => p.v));
  const despues = mediana(siguientes.map(p => p.v));
  return {
    ok: true, antes, despues, salto: despues - antes, conParada,
    tAntes: previas[previas.length - 1].t, tDespues: siguientes[0].t,
    iDespues: s.indexOf(siguientes[0]),
  };
}

/**
 * El techo del aforador: el valor más alto que se REPITE en la serie (al menos
 * 3 lecturas), si llega a ser un techo (≥ 38 L).
 *
 * No el máximo a secas: una sola lectura disparatada del CAN (255 o 65535, los
 * «no válido» de siempre) lo fijaba ahí, `topa` no saltaba nunca y el salto de
 * un coche que de verdad topó en 40 L se quedaba corto, sin corregir (revisión
 * del 23/10/2026). Lo imposible para un depósito de turismo (más de 80 L o
 * menos de 0) ni se mira; y un techo de verdad se repite: el coche anda horas
 * con el depósito lleno, una lectura cada 30 segundos.
 */
function techo(lecturas) {
  const veces = new Map();
  for (const p of limpiar(lecturas)) {
    if (p.v >= 0 && p.v <= MAXIMO_POSIBLE_L) veces.set(p.v, (veces.get(p.v) || 0) + 1);
  }
  const repetidos = [...veces].filter(([, n]) => n >= VECES_TECHO).map(([v]) => v);
  if (!repetidos.length) return null;
  const max = Math.max(...repetidos);
  return max >= TECHO_MINIMO ? max : null;
}

/** Valor de una serie acumulada en un instante, interpolando entre las dos lecturas que lo rodean. */
function enInstante(serie, t) {
  const s = limpiar(serie);
  if (s.length < 2) return null;
  const d = s.findIndex(p => p.t >= t);
  if (d === 0) return s[0].t === t ? s[0].v : null;
  if (d < 0) return null;
  const a = s[d - 1], b = s[d];
  return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
}

/**
 * ¿Topó el aforador? Si después del repostaje marca el techo (o uno menos), lo
 * que se echó por encima no se vio.
 */
const topa = (m, techoL) => !!(m && m.ok && techoL != null && m.despues >= techoL - 1);

/**
 * ¿Lo guardado de un repostaje es un MÍNIMO? Lo es cuando el aforador topó en
 * su techo y no se pudo corregir: lo que entró por encima no se vio, así que
 * los litros de la boya son «como poco esos». Si ya llegan a lo pagado, el
 * déficit es 0 (verde: como poco entró lo pagado); si se quedan cortos, no se
 * puede saber cuánto falta y no se compara. Se deduce de las columnas (la misma
 * cuenta que `topa`), sin guardar nada más: `fila` es la del repostaje
 * (boya_tipo, boya_corregida, boya_techo, boya_despues).
 */
const esMinimo = fila => !!fila && fila.boya_tipo === 'litros' && fila.boya_corregida === false
  && fila.boya_techo != null && fila.boya_despues != null && Number(fila.boya_despues) >= Number(fila.boya_techo) - 1;

/**
 * Cuándo vuelve a bajar del techo de verdad, después del repostaje:
 * → { t2, v2 } o null si todavía no ha bajado (se vuelve a mirar más tarde).
 */
function bajaDelTecho(lecturasCrudas, m, techoL) {
  const s = limpiar(lecturasCrudas);
  for (let k = Math.max(0, s.findIndex(p => p.t >= m.tDespues)) + N; k + N <= s.length; k++) {
    const v = mediana(s.slice(k, k + N).map(p => p.v));
    if (v <= techoL - 2) return { t2: s[k].t, v2: v };
  }
  return null;
}

/**
 * Lo repostado según la boya, corrigiendo el techo con lo gastado mientras el
 * aforador no podía bajar. `gastado`: la serie de `can.fuel_total` (L); `km`:
 * la del odómetro (km). Una de las dos basta.
 *
 * → { litros, corregido: true, gastadoEntre, como, t2, v2 }
 * → { litros: salto, corregido: false, motivo }   sin corregir, y por qué
 */
function corregirTecho(m, { t2, v2 }, { gastado, km } = {}) {
  const a = enInstante(gastado, m.tDespues), b = enInstante(gastado, t2);
  let gastadoEntre = null, como = '';
  if (a != null && b != null && b >= a) {
    gastadoEntre = b - a;
    como = 'gastado de la centralita';
  } else {
    const ka = enInstante(km, m.tDespues), kb = enInstante(km, t2);
    if (ka != null && kb != null && kb >= ka) {
      gastadoEntre = (kb - ka) * L100_FLOTA / 100;
      como = `${Math.round(kb - ka)} km a ${String(L100_FLOTA).replace('.', ',')} L/100 km`;
    }
  }
  if (gastadoEntre == null) return { litros: m.salto, corregido: false, motivo: 'El aforador topó en el techo y no hay gastado ni km de Mapon para corregirlo' };
  const litros = Math.round((v2 + gastadoEntre - m.antes) * 10) / 10;
  return { litros, corregido: true, gastadoEntre: Math.round(gastadoEntre * 10) / 10, como, t2, v2 };
}

/**
 * LO QUE FALTA: el déficit de la boya frente a los litros pagados, en %, con un
 * decimal. null si no se puede.
 *
 *   déficit % = max(0, litros pagados − litros de la boya) / litros pagados × 100
 *
 * Camilo, 23/10/2026: «En la auditoría, si subió tanto % por encima no importa,
 * la auditoría va por debajo». Hasta entonces era |boya − pagado| / pagado, y un
 * aforador que marca de más (el 7909LRJ, 3-4 L de más en tres de cuatro
 * repostajes) salía amarillo en los repostajes pequeños sin que faltara nada.
 * Lo que se audita es que NO falte gasolina: si el depósito subió lo pagado o
 * más, es 0 %, suba lo que suba por encima.
 *
 * Si el depósito bajó (−1 L), el déficit pasa del 100 %: faltan los litros
 * pagados y uno más. Es la fórmula tal cual, y es rojo de todas formas.
 *
 * El color se decide con esta cifra ya redondeada, la que se ve
 * (combustible.semaforo.js): un 34,96 % se guarda y se lee «35,0 %», amarillo.
 */
function deficitPct(litrosBoya, litrosPagados) {
  // Sin boya no hay déficit: Number(null) es 0, y saldría un 100 % (un rojo) de nada.
  if (litrosBoya == null || litrosBoya === '' || litrosPagados == null || litrosPagados === '') return null;
  const b = Number(litrosBoya), c = Number(litrosPagados);
  if (!Number.isFinite(b) || !Number.isFinite(c) || c <= 0) return null;
  return Math.min(Math.round(Math.max(0, c - b) / c * 1000) / 10, 99999);
}

/**
 * Lo que dice la boya frente a lo pagado, en litros, para escribirlo:
 * → { faltan, deMas } (uno de los dos es 0), con un decimal; null sin boya.
 * «faltan 3,1 L (12,4 %)» o «subió 3,5 L más de lo pagado» (sin penalizar).
 *
 * LOS LITROS Y EL % NO SE CONTRADICEN NUNCA (revisión del 23/10/2026). Se
 * redondeaban por separado: con la boya en 46 L y 46,04 L pagados, el déficit
 * es un 0,1 % y «faltan» salía 0,0 L, y la ficha escribía «no falta nada» al
 * lado de un 0,1 %. Ahora manda el % que se ve: si es más de 0, lo que falta
 * nunca es 0 (con dos decimales si con uno saldría 0,0: «faltan 0,04 L»); si
 * es 0, no falta nada aunque falten unas milésimas.
 */
function diferencia(litrosBoya, litrosPagados) {
  const pct = deficitPct(litrosBoya, litrosPagados);
  if (pct == null) return null;
  const d = Number(litrosBoya) - Number(litrosPagados);
  const uno = v => Math.round(v * 10) / 10, dos = v => Math.round(v * 100) / 100;
  if (pct > 0) return { faltan: uno(-d) > 0 ? uno(-d) : Math.max(0.01, dos(-d)), deMas: 0 };
  return { faltan: 0, deMas: d > 0 ? uno(d) : 0 };
}

/**
 * ¿SE MOVIÓ EL AFORADOR DENTRO DE UNA PARADA? Lo que va de la mediana de 5 más
 * baja a la más alta entre `desde` y `hasta` (ms), dejando 2 minutos en cada
 * borde (las de cuando paraba y arrancaba). → { lecturas, min, max } o null si
 * no hay 5 lecturas dentro.
 *
 * Para la parada «de 24 horas» de un coche con el GPS roto (el 9521MMX, el
 * 12/10/2026): el aforador solo lee con el coche encendido, y dentro de esa
 * «parada» bajó de 31 a 17 L y subió en un repostaje. Un coche aparcado no
 * gasta ni reposta: si el nivel se mueve, el coche andaba y Mapon no lo vio
 * (combustible.auditoria).
 */
function cambioDentro(lecturasCrudas, desde, hasta) {
  const s = limpiar(lecturasCrudas).filter(p => p.t > desde + 2 * 60e3 && p.t < hasta - 2 * 60e3);
  if (s.length < N) return null;
  let min = Infinity, max = -Infinity;
  for (let k = 0; k + N <= s.length; k++) {
    const v = mediana(s.slice(k, k + N).map(p => p.v));
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { lecturas: s.length, min, max };
}

module.exports = {
  mediana, salto, techo, topa, esMinimo, bajaDelTecho, corregirTecho, enInstante, deficitPct, diferencia, cambioDentro,
};
