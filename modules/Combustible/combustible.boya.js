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
//   · Litros ENTEROS, y baila ±1 L. Por eso, donde hay lecturas juntas, la
//     mediana de hasta 5, nunca una lectura suelta.
//   · Solo lee con el coche encendido: mientras se reposta, con el coche
//     apagado, no hay lecturas. En los Ioniq la aguja sube despacio (de 10 a 35
//     L en cuatro minutos tras arrancar, 8997LDK el 22/10; de 39 a 43 en nueve,
//     9775LRH el 10/10), y su aforador solo manda lectura cuando cambia.
//   · Tiene TECHO: 31 Toyota no marcan nunca más de 40 L, 19 llegan a 45 y los
//     Ioniq a 43-44. Lo que se eche por encima no se ve. Si después del
//     repostaje el aforador está en el techo, se corrige como hizo el análisis
//     del 9001LWJ (Scripts de análisis/mapon-combustible/6-auditar-repostaje.js):
//     se busca cuándo vuelve a bajar de verdad del techo (mediana de 5 ≤ techo
//     − 2) y se le suma lo que el coche gastó hasta entonces —los km a 4,77
//     L/100 km, la media de la flota, como lo de entre medias; el gastado de la
//     centralita (`can.fuel_total`) solo sin km y con lecturas a pocos minutos
//     de los dos instantes (revisión del 23/10/2026)—. Lo repostado ≈ (nivel
//     entonces + gastado) − nivel antes.
//   · Los Ford Mondeo dan el nivel en PORCENTAJE (otra serie). Sin la capacidad
//     del depósito no se pasa a litros: el salto se guarda en %, sin error.
//
// LA VENTANA FIJA (Camilo, 23/10/2026). El nivel ANTES es el del aforador 15
// minutos antes de la hora del repostaje (la del correo o la del Excel) y el
// DESPUÉS, el de 30 minutos después (`ventana`). Ya no se busca la parada.
// Camilo, con la ficha del 1212MJY delante: «dice que le falta el 100 % de
// gasolina, pero porque mapon dio los datos después de repostar». Ese coche
// marcaba 10 L hasta las 17:43:54, repostó apagado, y Mapon no vio la parada en
// el surtidor: la que dio, de 23 segundos a las 17:46:07, era el coche ya
// encendido y con el depósito lleno (la aguja subiendo de 25 a 39 L). «Antes de
// parar» salía 38 L, «al arrancar» 39, y un 95 % rojo de un repostaje de 29 L.
// Con la ventana fija: 11 L a las 17:31 y 39 a las 18:16, verde.
//
//   · 15 minutos antes, porque el repostaje acaba a la hora del Excel (o cae en
//     el minuto del correo) y dura unos minutos: a T − 15 el depósito todavía no
//     ha subido. 30 después, porque la aguja de los Ioniq tarda en llegar arriba
//     (hasta 16 minutos tras arrancar el 9775LRH, que con la regla vieja salía
//     −1 L de un repostaje bueno).
//   · «EL NIVEL A ESA HORA», CON LECTURAS QUE VAN A RATOS (`nivelEn`). Se mira
//     del lado bueno: para el antes, la última lectura a T − 15 o antes; para el
//     después, la primera a T + 30 o después. Con ella, las de los 10 minutos
//     de al lado hacia ese mismo lado (hasta 5), y la mediana si son 3 o más
//     (los litros enteros bailan ±1 L); si son 1 o 2, la más cercana. Dos clases
//     de aforador, medidas en la muestra del 23/10/2026: el de los Toyota lee
//     cada ~30 s con el coche encendido (5 lecturas juntas en 2-3 minutos), y el
//     de los Ioniq solo cuando cambia (el 9775LRH estuvo 6 h 30 min en 43 L sin
//     una lectura). Para los dos, la última o la primera lectura ES el nivel que
//     había: con el coche apagado el nivel no cambia (salvo repostando, y para
//     llegar al surtidor hay que andar), y con el de los Ioniq la lectura dura
//     hasta la siguiente. Por eso se busca EN TODA LA SERIE que se le pide a
//     Mapon (72 h antes y 48 h después; los Ford, 24 h antes): un coche aparcado
//     la noche entera tiene por la mañana el nivel con el que se quedó. Hasta la
//     revisión del 23/10/2026 se buscaba solo 12 h, y un coche que se aparcaba
//     justo antes o justo después de repostar se quedaba «sin medir» con la
//     lectura en la serie: el 0524MMZ del 05/10 a las 01:39 sube de 32 a 39 L y
//     no vuelve a leer hasta las 21:25 (19 h después), y era un rojo de verdad
//     (un 71 %) que desaparecía; el 1210MJY del 01/10, aparcado 13 h antes. Lo
//     que anduvo entre medias ya lo suman los km (abajo), y el aparcado no suma.
//     Si falta la de ANTES, no se reintenta: son horas del pasado, y si Mapon
//     ya tiene lecturas de después, las de antes no van a llegar.
//   · LA AGUJA AL ARRANCAR. Si la lectura de después es de cuando el coche
//     despierta (tras 5 minutos sin lecturas) y en sus 10 minutos la aguja SUBE
//     3 L o más, todavía estaba subiendo: el 0870MMZ marca 16, 16, 19, 28, 29,
//     29, 30, 31, 36, 38, 38, 39 en dos minutos al arrancar tras repostar, y la
//     mediana de las cinco primeras sería 19, un rojo de un repostaje bueno (lo
//     que denunció Camilo, por el otro lado). Entonces vale lo que marca cuando
//     se asienta: las de pasados 5 minutos, o la última de ese rato. SOLO si
//     sube: se probó a saltar siempre los 5 primeros minutos tras un hueco y,
//     en 108 repostajes con las series ya bajadas, cambiaban unos 30 y algunos
//     a peor —al despertar parado el aforador baila (el 3814KYG: 44, 43, 42,
//     nueve minutos sin nada, 38, 38, 39 y 43), y el de los Ioniq viene SIEMPRE
//     tras un hueco porque solo lee al cambiar—. Así no cambia ninguno de los
//     108 (en todos, el coche arrancó antes de las T + 30 o la aguja ya estaba
//     quieta) y la rampa se arregla.
//   · LO QUE GASTA ENTRE MEDIAS SE SUMA (`gastadoAndando`). Entre T − 15 y
//     T + 30 el coche anda —de mediana 23 km (1,1 L), y hasta 58—, y lo que gasta
//     hace que el salto salga corto: en un repostaje de 7 L, eso es un 15 %.
//     Medido en la muestra de 70 repostajes con aforador (23/10/2026): sin
//     sumarlo, la boya se quedaba de mediana 2,3 L por debajo de lo pagado y
//     salían 10 amarillos; sumando lo que gastó entre las dos lecturas con los
//     km de Mapon a 4,77 L/100 km, 0,3 L por debajo y 3 amarillos (los de
//     verdad). Los km, y no el gastado de la centralita: ese llega cada pocas
//     horas, y repartirlo en 45 minutos lo reparte también por el rato aparcado
//     (un 0454MMZ que anduvo 4 km salía con 0,8 L; y con él, 5 amarillos en vez
//     de 3). Entre las dos LECTURAS que se usaron, no entre los dos instantes:
//     es entre ellas donde se midió el nivel, y el aforador no siempre baja al
//     gastar (el 8930KVC marcaba 35 L a las 13:49 y otra vez 35 a las 14:49,
//     habiendo andado 36 km). Aparcado no hay km: el hueco no suma. Sin km, no
//     se suma y se dice. El análisis, en Scripts de análisis/combustible-boya-ventana.
//
// NO se busca «la subida mayor» entre muchos cortes posibles: se probó el
// 22/10/2026 con los repostajes de verdad y, con el aforador bailando ±2 L
// mientras el coche anda, el máximo coge siempre el valle de antes y el pico
// de después (7909LRJ en el Clot: 13 L donde la subida era de 11). Y «después»
// tiene que ser DESPUÉS: el 3814KYG repostó a las 16:57 y Mapon aún no tenía
// lecturas de cuando arrancó; buscando la subida mayor salía «0 L», un rojo
// de mentira. Sin lecturas de después de T + 30, se espera y se vuelve a mirar.
//
// Si no hubo repostaje en ese coche, la subida sale de 0-2 L y el déficit, cerca
// del 100 %: es justo lo que se quiere ver.
//
// SOLO CUENTA LO QUE FALTA (23/10/2026, `deficitPct`). Si subió lo pagado o
// más, no hay nada que auditar: el aforador de muchos coches marca de más.
//
// LA PARADA, SOLO PARA EL GPS. `subidaEnParada` y `cambioDentro` miran el
// aforador alrededor de una parada de Mapon, pero ya no para la boya: para
// saber si una parada larga es de verdad (combustible.auditoria, andaDentro y
// subeEnElla).

const L100_FLOTA = 4.77;        // L/100 km de los Corolla del 14 al 21/10/2026 (Mapon.md)
const TECHO_MINIMO = 38;        // por debajo, el máximo de la serie no es un techo: es que nunca llenó
const MAXIMO_POSIBLE_L = 80;    // más que esto no cabe en el depósito de un turismo: es una lectura rota
const VECES_TECHO = 3;          // un techo se repite; una lectura suelta no lo es
const ANTES_MIN = 15;                 // el nivel ANTES: a T − 15 min (Camilo, 23/10/2026)
const DESPUES_MIN = 30;               // el nivel DESPUÉS: a T + 30 min
const JUNTAS_MS = 10 * 60e3;          // las lecturas de al lado que cuentan como el mismo momento
const KM_JUNTO_MS = 5 * 60e3;         // un km leído a esto de un instante vale para él (el coche acababa de arrancar)
const HUECO_MS = 5 * 60e3;            // sin lecturas en esto, el coche estaba dormido (encendido, un Toyota lee cada ~30 s-2 min)
const AGUJA_MS = 5 * 60e3;            // lo que tarda la aguja en llegar arriba tras arrancar con el depósito lleno
const SUBE_AGUJA_L = 3;               // subir esto en los 10 min de después de despertar no es baile (±1 L): es la aguja
// LA PARADA, SOLO PARA EL GPS (subidaEnParada): lo de la regla de antes de la boya.
const PARADA_MAX_MS = 6 * 3600e3;     // la última lectura antes de parar o la primera tras arrancar, como mucho a 6 h
const N = 5;                          // lecturas por lado, y la mediana con 3 o más
const H = 3600e3;

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

const horaCorta = ms => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(ms);

/**
 * EL NIVEL A UNA HORA `x` (ms), mirado de un lado: `lado` 'antes' (la última
 * lectura a esa hora o antes) o 'despues' (la primera a esa hora o después),
 * en toda la serie `s` (la que se le pidió a Mapon). Con ella, las que caen en
 * sus 10 minutos hacia ese mismo lado (hasta 5): la mediana si son 3 o más —los
 * litros enteros bailan ±1 L—, y si son 1 o 2, la más cercana —el aforador de
 * los Ioniq solo lee cuando cambia, y su última lectura es el nivel que había—.
 *
 * DESPUÉS, SI EL COCHE DESPIERTA CON LA AGUJA SUBIENDO (la lectura viene tras 5
 * minutos sin ninguna y en sus 10 minutos sube 3 L o más), vale lo que marca
 * cuando se asienta: las de pasados 5 minutos (la mediana si son 3), o la
 * última de ese rato.
 * → { v, t: la hora de la lectura que vale, n: cuántas se juntaron,
 *     arranque: cuándo despertó, si se esperó a la aguja } o null.
 */
function nivelEn(s, x, lado) {
  const antes = lado === 'antes';
  // `s` va ordenada: para el antes, la última a esa hora o antes.
  const primeraDespues = s.findIndex(p => (antes ? p.t > x : p.t >= x));
  const i = antes ? (primeraDespues < 0 ? s.length : primeraDespues) - 1 : primeraDespues;
  if (i < 0) return null;
  const ref = s[i];
  if (!antes && (i === 0 || ref.t - s[i - 1].t >= HUECO_MS)) {
    const bloque = s.filter(p => p.t >= ref.t && p.t <= ref.t + JUNTAS_MS);
    const u = bloque[bloque.length - 1];
    if (bloque.length >= 2 && u.v - bloque[0].v >= SUBE_AGUJA_L) {
      const tarde = bloque.filter(p => p.t >= ref.t + AGUJA_MS).slice(0, N);
      return tarde.length >= 3
        ? { v: mediana(tarde.map(p => p.v)), t: tarde[0].t, n: tarde.length, arranque: ref.t }
        : { v: u.v, t: u.t, n: 1, arranque: ref.t };
    }
  }
  const juntas = antes ? s.filter(p => p.t <= ref.t && p.t >= ref.t - JUNTAS_MS).slice(-N) : s.filter(p => p.t >= ref.t && p.t <= ref.t + JUNTAS_MS).slice(0, N);
  return { v: juntas.length >= 3 ? mediana(juntas.map(p => p.v)) : ref.v, t: ref.t, n: juntas.length, arranque: null };
}

/**
 * LO QUE SUBIÓ EL AFORADOR EN EL REPOSTAJE de las `t` (ms): el nivel a T − 15
 * min y a T + 30 min (`nivelEn`). `ahora` (ms): para decir, si aún no se puede,
 * que todavía no son las T + 30. `desde` (ms): desde cuándo se le pidió la
 * serie a Mapon, para decirlo si no hay lecturas de antes.
 *
 * → { ok: true, antes, despues, salto, tAntes, tDespues, instAntes, instDespues, nAntes, nDespues, arranque }
 *     tAntes y tDespues: la hora de las lecturas que se usaron (con el coche
 *     aparcado pueden ser de horas antes o después de los instantes, que van en
 *     instAntes e instDespues). Lo gastado se cuenta entre las dos lecturas.
 *     arranque: si la de después se esperó a que subiera la aguja, cuándo arrancó.
 * → { ok: false, motivo, reintentar, sinSerie }
 *     reintentar: las lecturas que faltan pueden llegar luego (las de después).
 *     sinSerie: no hay ni una lectura en días: el coche no da el nivel.
 */
function ventana(lecturasCrudas, t, { ahora = Date.now(), desde = null } = {}) {
  const s = limpiar(lecturasCrudas);
  if (!s.length) return { ok: false, motivo: 'Mapon no tiene ni una lectura del aforador de este coche en esos días', reintentar: false, sinSerie: true };
  const instAntes = t - ANTES_MIN * 60e3, instDespues = t + DESPUES_MIN * 60e3;
  const a = nivelEn(s, instAntes, 'antes');
  if (!a) {
    // Son horas del pasado, y la serie tiene lecturas de después: el equipo ya
    // mandó lo que tenía de antes. No se reintenta (la revisión del 23/10/2026:
    // el 1210MJY se reintentaba esperando unos datos que no iban a llegar).
    const horas = desde != null && instAntes > desde ? Math.round((instAntes - desde) / H) : null;
    return { ok: false, reintentar: false,
      motivo: `No hay lecturas del aforador ${horas ? `en las ${horas} horas antes de` : 'de antes de'} las ${horaCorta(instAntes)} ` +
        '(15 minutos antes del repostaje): no se sabe con qué nivel llegó el coche' };
  }
  const d = nivelEn(s, instDespues, 'despues');
  if (!d) {
    return { ok: false, reintentar: true,
      motivo: ahora < instDespues
        ? `Todavía no son las ${horaCorta(instDespues)} (30 minutos después del repostaje): el nivel de después se mira a esa hora`
        : `Todavía no hay lecturas del aforador de después de las ${horaCorta(instDespues)} (30 minutos después del repostaje): el coche no ha vuelto a arrancar o Mapon aún no las tiene` };
  }
  return { ok: true, antes: a.v, despues: d.v, salto: d.v - a.v, tAntes: a.t, tDespues: d.t, instAntes, instDespues, nAntes: a.n, nDespues: d.n,
    arranque: d.arranque };
}

/**
 * Los km de una serie acumulada en un instante: interpolando entre las dos
 * lecturas que lo rodean (`enInstante`) o, si el instante cae justo antes de la
 * primera o justo después de la última (a 5 minutos), esa. Las lecturas de km
 * llegan con el coche encendido: si acababa de arrancar, la anterior es de antes
 * de aparcar y puede no estar en lo pedido, pero en esos segundos no anduvo.
 */
function kmEn(serie, t) {
  const v = enInstante(serie, t);
  if (v != null) return v;
  const s = limpiar(serie);
  if (!s.length) return null;
  if (t < s[0].t && s[0].t - t <= KM_JUNTO_MS) return s[0].v;
  const u = s[s.length - 1];
  return t > u.t && t - u.t <= KM_JUNTO_MS ? u.v : null;
}

/**
 * LO QUE GASTÓ ANDANDO entre dos lecturas del aforador (ms): los km de Mapon
 * (`can.total_distance`) a 4,77 L/100 km, la media de la flota. Aparcado no hay
 * km, así que un hueco de horas sin lecturas no suma nada.
 * → { km, litros } (con un decimal) o null si no hay km de esos instantes.
 */
function gastadoAndando(km, t1, t2) {
  const a = kmEn(km, t1), b = kmEn(km, t2);
  if (a == null || b == null || b < a) return null;
  return { km: Math.round((b - a) * 10) / 10, litros: Math.round((b - a) * L100_FLOTA / 100 * 10) / 10 };
}

/**
 * PARA EL GPS, NO PARA LA BOYA: lo que subió el aforador a través de una parada
 * de Mapon, { desde, hasta } en ms. «Antes», las 5 últimas lecturas hasta que
 * paró; «después», las 5 primeras pasados 5 minutos desde que arrancó (la aguja
 * de los Ioniq), o las del principio si volvió a parar. Es la regla de la boya
 * de antes del 23/10/2026; se queda para `subeEnElla` (combustible.auditoria):
 * una parada larga lejos de la gasolinera tras la cual el depósito tiene 5 L
 * más no es de verdad. → { ok: true, antes, despues, salto } o { ok: false }.
 */
function subidaEnParada(lecturasCrudas, parada) {
  const s = limpiar(lecturasCrudas);
  if (!s.length || !parada || !Number.isFinite(parada.desde) || parada.hasta == null) return { ok: false };
  const finAntes = parada.desde + 60e3, arranque = parada.hasta;
  const previas = s.filter(p => p.t <= finAntes && p.t >= finAntes - PARADA_MAX_MS).slice(-N);
  const enVentana = desdeMs => s.filter(p => p.t >= desdeMs && p.t <= arranque + PARADA_MAX_MS);
  let siguientes = enVentana(arranque + AGUJA_MS).slice(0, N);
  if (siguientes.length < 3) siguientes = enVentana(arranque).slice(0, N);
  if (previas.length < 3 || siguientes.length < 3) return { ok: false };
  const antes = mediana(previas.map(p => p.v)), despues = mediana(siguientes.map(p => p.v));
  return { ok: true, antes, despues, salto: despues - antes };
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
 * El valor de una serie acumulada en `t`, solo si tiene lecturas a menos de 10
 * minutos a cada lado: interpolar un hueco de horas reparte lo que se gastó
 * también por el rato que el coche estuvo aparcado.
 */
function enInstanteJunto(serie, t) {
  const s = limpiar(serie);
  const d = s.findIndex(p => p.t >= t);
  if (d < 0) return null;
  if (s[d].t === t) return s[d].v;
  if (d === 0 || t - s[d - 1].t > JUNTAS_MS || s[d].t - t > JUNTAS_MS) return null;
  return enInstante(s, t);
}

/**
 * Lo repostado según la boya, corrigiendo el techo con lo gastado mientras el
 * aforador no podía bajar. `km`: la serie del odómetro (km); `gastado`: la de
 * `can.fuel_total` (L).
 *
 * POR KM, COMO LO DE ENTRE MEDIAS (revisión del 23/10/2026). Hasta entonces
 * mandaba el gastado de la centralita, interpolado; pero lo de entre las dos
 * lecturas se cuenta por km (gastadoAndando: la centralita llega cada pocas
 * horas, y repartida en un rato reparte también lo aparcado), y en una misma
 * cuenta salían las dos fuentes según qué lecturas cayeran en la pregunta. El
 * 1090MJY del 02/10: de 21:46 a 23:23, con 67 km, la centralita daba 1,2 L y
 * los km 3,2. Ahora, los km; la centralita solo si no hay km y tiene lecturas
 * a pocos minutos de los dos instantes (`enInstanteJunto`).
 *
 * → { litros, corregido: true, gastadoEntre, como, kmEntre, t2, v2 }
 * → { litros: salto, corregido: false, motivo }   sin corregir, y por qué
 */
function corregirTecho(m, { t2, v2 }, { gastado, km } = {}) {
  let gastadoEntre = null, como = '', kmEntre = null;
  const ka = kmEn(km, m.tDespues), kb = kmEn(km, t2);
  if (ka != null && kb != null && kb >= ka) {
    kmEntre = kb - ka;
    gastadoEntre = kmEntre * L100_FLOTA / 100;
    como = `${Math.round(kmEntre)} km a ${String(L100_FLOTA).replace('.', ',')} L/100 km`;
  } else {
    const a = enInstanteJunto(gastado, m.tDespues), b = enInstanteJunto(gastado, t2);
    if (a != null && b != null && b >= a) {
      gastadoEntre = b - a;
      como = 'gastado de la centralita';
    }
  }
  if (gastadoEntre == null) return { litros: m.salto, corregido: false, motivo: 'El aforador topó en el techo y no hay km ni gastado de Mapon para corregirlo' };
  const litros = Math.round((v2 + gastadoEntre - m.antes) * 10) / 10;
  return { litros, corregido: true, gastadoEntre: Math.round(gastadoEntre * 10) / 10, como,
    kmEntre: kmEntre == null ? null : Math.round(kmEntre * 10) / 10, t2, v2 };
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
  ANTES_MIN, DESPUES_MIN, L100_FLOTA,
  mediana, ventana, gastadoAndando, techo, topa, esMinimo, bajaDelTecho, corregirTecho, enInstante, deficitPct, diferencia,
  // Para el GPS (¿la parada es de verdad?), no para la boya.
  subidaEnParada, cambioDentro,
};
