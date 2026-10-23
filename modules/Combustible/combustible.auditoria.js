// ============================================================
// COMBUSTIBLE · LA AUDITORÍA DE CADA REPOSTAJE CON MAPON
// ============================================================
// Cada repostaje leído del correo se mira contra Mapon, EN SOLO LECTURA (todo
// son GET de services/mapon; ninguna orden, ningún relé). Dos preguntas, con
// los umbrales de Camilo (combustible.semaforo.js):
//
//   · GPS: ¿estaba el coche en la gasolinera del correo (o del Excel) a esa
//     hora? Metros de su posición a la gasolinera casada (verde < 700,
//     amarillo < 1600).
//   · BOYA: ¿subió el depósito lo pagado? El DÉFICIT: lo que le falta al salto
//     del aforador para llegar a los litros pagados, en % (verde < 35,
//     amarillo < 65). Subir de más no cuenta, y un mínimo (el aforador en su
//     techo) que ya llega a lo pagado es verde.
//
// DÓNDE ESTABA EL COCHE. La parada de Mapon (route/list) que CUBRE la hora del
// repostaje —el correo da el minuto, así que vale una que empiece dentro de ese
// minuto—: es donde estuvo apagado en el surtidor, y su posición es la de un
// coche quieto. Si no hay ninguna (el coche no se apagó, o Mapon no la cortó),
// su posición en ese instante (history_point), que Mapon da como el punto más
// cercano: si ese punto está a más de 20 minutos, no vale, y se dice.
//
// UNA PARADA DE AL LADO NO VALE POR SÍ SOLA. Hasta el 23/10/2026 se aceptaba
// una que acabara 5 minutos antes o empezara 5 después, y se usaba sin mirar
// más. El n.º 16 (8997LDK, 00:05) cogió la de 23:14 a 00:00 en la Av. de Burgos
// y la ficha decía «parado allí», cuando a las 00:04:59 el coche ya iba a
// 1.676 m de allí. Y el 7909LRJ suele aparcar en Fernando Pessoa, a 1 km de
// Asunción, minutos después de repostar sin apagar el coche: medido desde ese
// aparcamiento saldría amarillo o rojo sin motivo. Ahora, si la parada no cubre
// la hora, manda su posición a esa hora; la parada de al lado solo se usa si el
// coche seguía a menos de 100 m de ella (el reloj del correo y el de Mapon no
// son el mismo) o si Mapon no da su posición. Y la ficha dice qué pasó.
//
// LA HORA DEL CORREO, EL DÍA DEL CAMBIO DE HORA. El último domingo de octubre,
// de 02:00 a 02:59 cada hora pasa dos veces, y la base se queda con la segunda
// (lector.comun: `AT TIME ZONE 'Europe/Madrid'`). Si el correo llegó ANTES de
// esa segunda, el repostaje fue en la primera: se audita una hora antes
// (`instante`). Lo guardado no se toca.
//
// CUÁNDO. Después de cada lectura del buzón (el cron de app.js), los que ya
// tienen Mapon detrás: 45 minutos después del repostaje, para que haya lecturas
// del aforador de cuando arrancó. Lo que se queda a medias (Mapon no contestó,
// aún no hay lecturas de después, el aforador sigue en su techo) se vuelve a
// mirar, cada vez más espaciado (30 min, 1, 2, 4, 8 y 12 h); a las 48 horas
// del repostaje (con tres intentos al menos) o a los ocho intentos se cierra
// «sin datos», con lo que tuviera. Y uno a mano, desde su ficha.
//
// NUNCA LANZA NI PARA LO DEMÁS. Un repostaje que revienta se cuenta, se le
// apunta el intento (si no, sería el primero de todas las pasadas para siempre
// y taparía a los demás) y sigue el siguiente; Mapon caído (cuenta suspendida,
// sin clave) salta la pasada entera sin gastar intentos; y la lectura del
// correo ya terminó antes de empezar esto.
//
// UN REINTENTO NO BORRA LO QUE YA SE MIDIÓ. Si en un intento Mapon no contesta
// a una de las dos preguntas, esa se queda con lo de la vez anterior (y la boya,
// con la parada que se guardó): el n.º 20 tenía el GPS a 12 m y esperaba a la
// boya; un tiempo agotado en las paradas lo dejaba sin GPS (revisión del
// 23/10/2026).
//
// LA BOYA SOLO CUENTA LO QUE FALTA (23/10/2026): el déficit frente a lo pagado
// (combustible.boya.deficitPct). Subir de más no penaliza; un mínimo (el
// aforador en su techo, sin corregir) que ya llega a lo pagado es verde, y uno
// que se queda corto no se compara.
//
// UNA PARADA DE MAPON TIENE QUE SER DE VERDAD (revisión del 23/10/2026). El
// 9521MMX tiene el GPS roto: Mapon le daba una «parada» de 00:00 a 00:00 en San
// Fernando el día que repostó en Torrejón, y salía rojo por los dos lados (a
// 5.443 m, y la boya medida de un día al siguiente: −14 L). El aforador solo lee
// con el coche encendido, y dentro de esa «parada» bajó de 31 a 17 L: el coche
// andaba. Así que una parada de más de una hora en la que el aforador se mueve 3
// litros o más no vale; ni una lejos de la gasolinera tras la cual el depósito
// tiene 5 L o más (un coche aparcado no reposta: es el equipo de Mapon sin
// señal, el 0454MMZ). Sin GPS de fiar, el GPS va sin color (y se dice), y la
// boya se mide sin parada. Una parada larga con el depósito quieto sí vale: un
// coche aparcado de verdad a esa hora es justo lo que hay que ver.
//
// PETROPRIX, POR EXCEL (db/215). Lo mismo que Ballenoil, con dos diferencias:
//
//   · LA HORA DEL EXCEL ES LA DEL FINAL DEL REPOSTAJE, con segundos. En 247
//     paradas medidas (Scripts de análisis/petroprix-gasolineras) cae una
//     mediana de 152 s después de parar y 20 s antes de arrancar, y en 64 cae
//     ya con el coche andando: hasta 192 s después de arrancar, y el 9528MMX a
//     127 s y 241 m de la gasolinera. Así que, para una fila del Excel, la
//     parada que acabó como mucho 5 minutos ANTES de su hora es la del
//     repostaje, esté donde esté el coche a esa hora (se mide desde la parada).
//     Y la que EMPIEZA después ya no lo es: con la regla del minuto del correo,
//     el 1073MJY cogía la parada siguiente, que empezaba 46 s después, a 306 m.
//     Si esa parada de antes queda lejos de la gasolinera (no saldría verde),
//     quizá Mapon no apuntó la del surtidor (el coche no se apagó) y esa es la
//     de antes, la de dejar a un pasajero: entonces se mira también dónde
//     estaba el coche a esa hora, y vale lo que quede más cerca. Nunca acusa
//     más que la parada sola.
//
//   · LLEGAN DE GOLPE: 1.866 de un Excel, unos 85 al día. Cada pasada coge hasta
//     60 (los de los dos últimos días primero), agrupados por coche y por
//     tramos de 4 días, y pide a Mapon el aforador y las paradas de cada grupo
//     UNA vez (combustible.memoria), de una en una y con una pausa de 150 ms.
//     Con 60 cada 10 minutos, el atraso de un Excel de tres semanas se pone al
//     día en unas 5 horas sin quitarle hueco a la ingesta ni a las sanciones.
//     Medido: docs/modulos/Combustible.md, «El ritmo de la auditoría».

const repo = require('./combustible.repo');
const G = require('./combustible.gasolinera');
const B = require('./combustible.boya');
const { UMBRALES } = require('./combustible.semaforo');
const { conMemoria } = require('./combustible.memoria');
const mapon = require('../../services/mapon');

const MARGEN_MIN = 45;                          // tras el repostaje, para que haya lecturas de después
const ESPERAS_MIN = [30, 60, 120, 240, 480, 720];  // entre intentos de los que quedaron a medias
const CIERRE = { horas: 48, minIntentos: 3, maxIntentos: 8 };
const POR_PASADA = 60;                          // repostajes por pasada, uno detrás de otro
const RECIENTES_HORAS = 48;                     // los de estos días, antes que el atraso de un Excel
const AGRUPAR_DIAS = 4;                         // los de un coche en estos días, con una lectura de Mapon
const PAUSA_MAPON_MS = 150;                     // entre pregunta y pregunta a Mapon
const TOPE_PASADA_MS = 4 * 60 * 1000;           // y no más de esto: el cron salta cada 10 minutos
const MINUTO_MS = 59e3;                         // el correo da el minuto: de hh:mm:00 a hh:mm:59
const MARGEN_PARADA_MS = 5 * 60e3;              // una parada «de al lado», para decirlo en la ficha
const PAGO_TRAS_ARRANCAR_MS = 5 * 60e3;         // el Excel apunta el final: hasta 192 s tras arrancar (medido)
const JUNTO_A_LA_PARADA_M = 100;                // a esa hora seguía allí: es esa parada (relojes distintos)
const PUNTO_MAX_MS = 20 * 60e3;
const LECTURAS_FICHA = 90;                      // las del aforador que se guardan para dibujarlas en la ficha
const PARADA_LARGA_MS = 60 * 60e3;              // una parada de más de esto se mira por dentro (¿andaba?)
const ANDA_L = 3;                               // si dentro el aforador se mueve esto, el coche andaba
const SUBE_L = 5;                               // si al acabar la parada tiene esto más, repostó en ella
const VERDE_M = UMBRALES.gpsM[0];               // desde la parada de antes, ¿saldría verde?

const FALTA_DB213 = 'Falta aplicar la migración db/213 (auditoría de repostajes) desde /migraciones';
const FALTA_DB215 = 'Falta aplicar la migración db/215 (el Excel de Petroprix, el bot y la boya por debajo) desde /migraciones';
const H = 3600e3;
const iso = ms => (ms == null ? null : new Date(ms).toISOString());
const minutos = ms => Math.round(Math.abs(ms) / 60e3);

// ── LA GASOLINERA ───────────────────────────────────────────────────────────

/**
 * Casa con la lista los leídos que aún no tienen gasolinera (o que no casaron:
 * la lista o los alias pueden haber cambiado). Solo base, sin Mapon: así un
 * repostaje recién llegado ya enseña su gasolinera antes de auditarse. Si ya se
 * sabía dónde estaba el coche, la distancia se rehace con la gasolinera nueva.
 */
async function casarGasolineras({ filas } = {}) {
  const { lista, alias, textos } = await cargarGasolineras();
  let cambiados = 0;
  for (const x of filas || await repo.paraCasarGasolinera()) {
    const e = G.elegir(x.estacion, { proveedor: x.proveedor, sede: x.sede, gasolineras: lista, alias, textos });
    if (e.gasolineraId === x.gasolinera_id && e.como === x.gasolinera_como) continue;
    const posicion = x.gps_lat != null && x.gps_lng != null ? { lat: x.gps_lat, lng: x.gps_lng } : null;
    const d = posicion ? G.distanciaA({ posicion, gasolinera: e.gasolinera, como: e.como, estacion: x.estacion }) : null;
    await repo.ponerGasolinera(x.id, { gasolineraId: e.gasolineraId, como: e.como, candidatas: e.candidatas,
      conDistancia: !!posicion, distancia: d && d.distancia, motivo: d && d.motivo });
    cambiados++;
  }
  return cambiados;
}

// ── UN REPOSTAJE ────────────────────────────────────────────────────────────

/**
 * Mapon parte una parada en dos a medianoche (el 8997LDK el 23/10/2026: de
 * 23:27 a 00:00 y de 00:00 a 00:00:10, y la ficha decía «parado de 00:00 a
 * 00:00»), y a veces la corta con un «trayecto» de segundos y 0 km. Las que se
 * tocan (menos de un minuto entre una y otra) en el mismo sitio (a menos de
 * 100 m) son una sola: la de verdad, con su principio y su fin.
 */
function unirParadas(paradas) {
  const juntas = [];
  for (const p of [...(paradas || [])].sort((a, b) => a.desde - b.desde)) {
    const u = juntas[juntas.length - 1];
    const m = u ? G.metros(u, p) : null;
    if (u && u.hasta != null && p.desde - u.hasta <= 60e3 && m != null && m <= 100) juntas[juntas.length - 1] = { ...u, hasta: p.hasta };
    else juntas.push({ ...p });
  }
  return juntas;
}

/**
 * Las paradas alrededor de la hora `t`: la que la CUBRE (empieza como tarde en
 * ese minuto y no ha acabado antes de él) y, si ninguna la cubre, la que cae a
 * menos de 5 minutos (`cerca`), para mirar si el coche seguía junto a ella.
 *
 * `delExcel` (Petroprix): la hora va con segundos y es la del FINAL del
 * repostaje. Cubre la que contiene ese segundo, sin el minuto de margen hacia
 * delante (la que empieza después es la parada siguiente: el 1073MJY), y la que
 * acabó como mucho 5 minutos antes es la del repostaje (`antes`): Petroprix lo
 * apunta al cerrarlo, a veces con el coche ya andando.
 * → { cubre, cerca, antes }
 */
function paradaDe(paradas, t, { delExcel } = {}) {
  const lejos = p => (t < p.desde ? p.desde - t : p.hasta != null && t > p.hasta ? t - p.hasta : 0);
  const ps = [...(paradas || [])].sort((a, b) => lejos(a) - lejos(b));
  const adelante = delExcel ? 0 : MINUTO_MS;
  const cubre = ps.find(p => p.desde <= t + adelante && (p.hasta == null || p.hasta >= t)) || null;
  const antes = !cubre && delExcel ? ps.find(p => p.hasta != null && p.hasta < t && t - p.hasta <= PAGO_TRAS_ARRANCAR_MS) || null : null;
  const cerca = cubre || antes ? null : ps.find(p => lejos(p) <= MARGEN_PARADA_MS) || null;
  return { cubre, cerca, antes };
}

const relojMadrid = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * El instante del repostaje. La base guarda la hora del correo leída en Madrid,
 * y el día del cambio de hora de octubre las de 02:00 a 02:59 pasan dos veces:
 * PostgreSQL se queda con la segunda (horario de invierno). Si el correo llegó
 * antes de esa segunda, el repostaje fue en la primera, una hora antes. Sin
 * esto se auditaba una hora tarde —el coche en otro sitio, el depósito ya sin
 * subir— y salía rojo por los dos lados sin haber nada raro (revisión del
 * 23/10/2026; el turno de noche de Barcelona reposta a esas horas).
 * → { t (ms), repite: la hora pasa dos veces, primera: se eligió la primera }
 *
 * Una fila del Excel ya se guardó con su instante decidido (lector.petroprixExcel,
 * por el orden del fichero): aquí no se mueve, solo se dice en qué pasada cae.
 */
function instante(rep) {
  const t = new Date(rep.repostaje_at).getTime();
  if (rep.origen === 'excel') {
    const primera = Number.isFinite(t) && relojMadrid.format(t + H) === relojMadrid.format(t);
    const segunda = Number.isFinite(t) && relojMadrid.format(t - H) === relojMadrid.format(t);
    return { t, repite: primera || segunda, primera };
  }
  const repite = Number.isFinite(t) && relojMadrid.format(t - H) === relojMadrid.format(t);
  const recibido = rep.recibido_at ? new Date(rep.recibido_at).getTime() : NaN;
  if (repite && Number.isFinite(recibido) && recibido < t) return { t: t - H, repite, primera: true };
  return { t, repite, primera: false };
}

/** Las lecturas del aforador alrededor del repostaje, como mucho LECTURAS_FICHA, para la ficha. */
function lecturasParaFicha(serie, desde, hasta) {
  const s = serie.filter(p => p.t >= desde && p.t <= hasta && p.v != null);
  if (s.length <= LECTURAS_FICHA) return s.map(p => [p.t, Number(p.v)]);
  const paso = s.length / LECTURAS_FICHA;
  return Array.from({ length: LECTURAS_FICHA }, (_, i) => s[Math.floor(i * paso)]).map(p => [p.t, Number(p.v)]);
}

/**
 * La unidad de Mapon del coche: la de Vehículos o Flota viva y, si no, la del
 * padrón de Mapon por la matrícula (con su regla para las matrículas con dos
 * equipos, mapon.elegirEquipo).
 */
async function unidadDe(rep, m = mapon) {
  const enBase = await repo.unidadMapon(rep.vehiculo_id, rep.matricula_norm);
  if (enBase) return enBase;
  const u = await m.unidadPorMatricula(rep.matricula);
  return u ? { unitId: String(u.unitId), como: 'padron' } : null;
}

// ── LO DE LA VEZ ANTERIOR ───────────────────────────────────────────────────
// Si Mapon no contesta a una de las dos preguntas, esa se queda como estaba.

const ms = v => (v == null ? null : new Date(v).getTime());

/** Lo que el GPS ya tenía de una vez anterior, o null. */
function gpsAnterior(rep) {
  if (rep.gps_lat == null || rep.gps_lng == null) return null;
  const d = rep.auditoria_detalle || {};
  const detalle = {};
  for (const k of ['parada', 'punto', 'paradaCerca']) if (d[k]) detalle[k] = d[k];
  return {
    posicion: { lat: Number(rep.gps_lat), lng: Number(rep.gps_lng) },
    campos: { gpsFuente: rep.gps_fuente || null, gpsAt: ms(rep.gps_at), gpsHasta: ms(rep.gps_hasta), gpsDireccion: rep.gps_direccion || null },
    detalle,
    // La parada que se guardó, para medir la boya con ella.
    parada: rep.gps_fuente === 'parada' && rep.gps_at ? { desde: ms(rep.gps_at), hasta: ms(rep.gps_hasta) } : null,
  };
}

const CAMPOS_BOYA = [['boyaTipo', 'boya_tipo'], ['boyaAntes', 'boya_antes'], ['boyaDespues', 'boya_despues'], ['boyaSalto', 'boya_salto'],
  ['boyaTecho', 'boya_techo'], ['boyaCorregida', 'boya_corregida'], ['boyaLitros', 'boya_litros'], ['boyaErrorPct', 'boya_error_pct'],
  ['boyaMotivo', 'boya_motivo']];

/** Deja la boya sin nada (lo que hubiera quedado a medias de este intento). */
function limpiarBoya(a) {
  for (const [k] of CAMPOS_BOYA) delete a[k];
  delete a.detalle.boya;
}

/** La boya de la vez anterior, tal cual estaba. */
function restaurarBoya(a, rep) {
  for (const [k, col] of CAMPOS_BOYA) a[k] = rep[col] == null ? undefined : rep[col];
  if (rep.auditoria_detalle && rep.auditoria_detalle.boya) a.detalle.boya = rep.auditoria_detalle.boya;
  else delete a.detalle.boya;
}

// ── LAS DOS PREGUNTAS ───────────────────────────────────────────────────────

/** La distancia a la gasolinera y la más cercana, desde la posición que haya. Rellena `a`. */
function medirDesde(a, rep, posicion, gas, sinPosicion) {
  if (posicion) {
    a.gpsLat = Math.round(posicion.lat * 1e6) / 1e6;
    a.gpsLng = Math.round(posicion.lng * 1e6) / 1e6;
    const cerca = G.masCercana(posicion, gas.lista.filter(g => g.proveedor === rep.proveedor));
    if (cerca) { a.cercanaId = cerca.gasolinera.id; a.cercanaM = cerca.metros; }
  }
  const d = G.distanciaA({ posicion, gasolinera: gas.elegida.gasolinera, como: gas.elegida.como, estacion: rep.estacion, sinPosicion });
  a.distancia = d.distancia;
  a.gpsMotivo = d.motivo;
}

/** Pone en `a` el GPS de la vez anterior; → la parada guardada (para la boya), o null si no había GPS. */
function gpsDeAntes(a, rep, gas, motivo) {
  const antes = gpsAnterior(rep);
  if (!antes) {
    // Una parada que andaba (el GPS clavado) no dejó posición, pero sí su porqué: se queda.
    const rota = rep.auditoria_detalle && rep.auditoria_detalle.paradaRota;
    if (rota) a.detalle.paradaRota = rota;
    medirDesde(a, rep, null, gas, rota && rep.gps_motivo ? rep.gps_motivo : motivo);
    return null;
  }
  Object.assign(a, antes.campos);
  Object.assign(a.detalle, antes.detalle);
  medirDesde(a, rep, antes.posicion, gas, null);
  return antes.parada;
}

const horaCorta = ms => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(ms);

/**
 * ¿LA PARADA ES DE VERDAD? (andaDentro y subeEnElla.) Una de más
 * de una hora no lo es si:
 *
 *   · DENTRO, el aforador se mueve 3 L o más (`como: 'dentro'`): solo lee con el
 *     coche encendido, así que el coche andaba y el GPS se había quedado
 *     clavado (el 9521MMX, «parado» 24 h en San Fernando con el aforador de 31 a
 *     17 L);
 *   · o, lejos de la gasolinera, AL ACABAR el depósito tiene 5 L o más que al
 *     empezar (`como: 'sube'`): un coche aparcado no reposta. Es el equipo de
 *     Mapon que no dio señal en ese rato, y Mapon lo pinta como una parada en el
 *     último sitio que vio (el 0454MMZ, el 04/10: «parado» 5,8 h en el Paseo de
 *     Extremadura, a 9,6 km de Alcorcón, y al arrancar con 13 L más). Si la
 *     parada está en la gasolinera, repostar en ella es lo normal: vale.
 *
 * Una parada larga en la que el depósito no se mueve sí vale: un coche aparcado
 * de verdad lejos del surtidor es justo lo que hay que ver (el 8512LDS en
 * L'Hospitalet, el 8997LDK en Madrid, los dos sin subir el depósito).
 *
 * `subeEnElla` solo se mira en la parada que se toma como el sitio del
 * repostaje (la que cubre la hora, o la de antes del Excel si no hay nada más
 * cerca): una parada «de al lado» larga es la de un coche que estuvo aparcado
 * horas y luego fue a repostar, y ahí el depósito sube después, en la gasolinera.
 * → null si vale (o no se puede saber); si no, { como, horas, min, max } o
 *   { como, horas, antes, despues, metros }.
 */
const larga = (p, ctx) => !!p && p.hasta != null && p.hasta - p.desde >= PARADA_LARGA_MS && !!ctx.aforador;
const horasDe = p => Math.round((p.hasta - p.desde) / H * 10) / 10;
async function aforadorDe(ctx) {
  try { return await ctx.aforador(); } catch (_) { return null; }   // sin aforador no se sabe: la parada vale
}
async function andaDentro(p, ctx) {
  if (!larga(p, ctx)) return null;
  const x = B.cambioDentro(await aforadorDe(ctx), p.desde, p.hasta);
  return x && x.max - x.min >= ANDA_L ? { como: 'dentro', horas: horasDe(p), min: x.min, max: x.max } : null;
}
async function subeEnElla(p, ctx, gasolinera) {
  if (!larga(p, ctx)) return null;
  const metros = G.metros(p, gasolinera);
  if (metros == null || metros < VERDE_M) return null;
  const serie = await aforadorDe(ctx);
  if (!serie) return null;
  const m = B.salto(serie, p.desde, { parada: p });
  return m.ok && m.salto >= SUBE_L ? { como: 'sube', horas: horasDe(p), antes: m.antes, despues: m.despues, metros } : null;
}

/** Lo que se dice de una parada que no es de verdad (cabe en los 300 de gps_motivo). */
function motivoParadaRota(p, anda) {
  const h = `${String(anda.horas).replace('.', ',')} h (de ${horaCorta(p.desde)} a ${horaCorta(p.hasta)})${p.direccion ? ` en ${p.direccion}` : ''}`;
  return anda.como === 'dentro'
    ? `Mapon da el coche parado ${h}, pero dentro el aforador fue de ${anda.min} a ${anda.max} L: el coche andaba y su GPS no lo vio`
    : `Mapon da el coche parado ${h}, a ${Number(anda.metros).toLocaleString('es-ES')} m, pero al arrancar tenía ${anda.despues - anda.antes} L más ` +
      `(${anda.antes} → ${anda.despues}): repostó en ese rato y su GPS no lo vio`;
}

/**
 * Dónde estaba el coche y a cuánto de la gasolinera. Rellena `a`; devuelve la
 * parada en la que repostó (la usa la boya), o null si a esa hora no estaba
 * parado. `ctx`: { mapon (con memoria, en una pasada), ahora, aforador }.
 */
async function mirarGps(a, rep, unidad, t, gas, ctx) {
  const m = ctx.mapon;
  const delExcel = rep.origen === 'excel';
  let cubre, cerca, antes, punto = null, sinPosicion = null;
  try {
    ({ cubre, cerca, antes } = paradaDe(unirParadas(await m.paradasUnidad(unidad.unitId, t - 3 * H, Math.min(ctx.ahora, t + H))), t, { delExcel }));

    // UNA PARADA QUE NO ES DE VERDAD: el GPS no vale para decir dónde estaba.
    // Sin color por el GPS (ni su posición a esa hora, que es la del sitio
    // donde se quedó clavado), y la boya, sin parada (andaDentro y subeEnElla, arriba).
    const rota = (p, anda) => {
      a.detalle.paradaRota = { desde: iso(p.desde), hasta: iso(p.hasta), direccion: p.direccion || null, ...anda };
      medirDesde(a, rep, null, gas, motivoParadaRota(p, anda));
      return null;
    };
    const candidata = cubre || antes || cerca;
    const dentro = await andaDentro(candidata, ctx);
    if (dentro) return rota(candidata, dentro);
    const sube = cubre ? await subeEnElla(cubre, ctx, gas.elegida.gasolinera) : null;
    if (sube) return rota(cubre, sube);

    if (antes) {
      // LA PARADA DE ANTES, LEJOS: quizá Mapon no apuntó la del surtidor (el
      // coche no se apagó) y esta es la de antes, la de dejar a un pasajero.
      // Si desde ella no sale verde, se mira dónde estaba a esa hora y vale lo
      // que quede más cerca: así nunca acusa más que la parada sola.
      const lejos = G.metros(antes, gas.elegida.gasolinera);
      if (lejos != null && lejos >= VERDE_M) {
        let p = null;
        try { p = await m.posicionEn(unidad.unitId, t); }
        catch (e) {
          a.detalle.fallos.gps = `Mapon no contestó al preguntar dónde estaba el coche a esa hora: ${e.message}`;
          a.reintentar = true;
        }
        const mPunto = p && Math.abs(p.t - t) <= PUNTO_MAX_MS ? G.metros(p, gas.elegida.gasolinera) : null;
        if (mPunto != null && mPunto < lejos) {
          Object.assign(a, { gpsFuente: 'punto', gpsAt: p.t });
          a.detalle.punto = { t: iso(p.t) };
          a.detalle.paradaCerca = { desde: iso(antes.desde), hasta: iso(antes.hasta), direccion: antes.direccion, metros: G.metros(antes, p),
            aLaGasolinera: lejos };
          medirDesde(a, rep, { lat: p.lat, lng: p.lng }, gas, null);
          return null;
        }
      }
      // No hay nada más cerca: esa parada es el sitio del repostaje, si es de verdad.
      const subeAntes = await subeEnElla(antes, ctx, gas.elegida.gasolinera);
      if (subeAntes) return rota(antes, subeAntes);
      // Fila del Excel: la parada que acaba de acabar es la del repostaje, y
      // se mide desde ella. No hace falta saber dónde iba ya el coche.
      Object.assign(a, { gpsFuente: 'parada', gpsAt: antes.desde, gpsHasta: antes.hasta, gpsDireccion: antes.direccion });
      a.detalle.parada = { desde: iso(antes.desde), hasta: iso(antes.hasta), direccion: antes.direccion,
        trasArrancar: { segundos: Math.round((t - antes.hasta) / 1000) } };
      medirDesde(a, rep, { lat: antes.lat, lng: antes.lng }, gas, null);
      return antes;
    }
    if (!cubre) {
      const p = await m.posicionEn(unidad.unitId, t);
      if (p && Math.abs(p.t - t) <= PUNTO_MAX_MS) punto = p;
      else {
        sinPosicion = p
          ? `Mapon no tiene al coche parado a esa hora, y su posición más cercana es de ${minutos(p.t - t)} min ${p.t < t ? 'antes' : 'después'}: no vale para decir dónde repostó`
          : 'Mapon no tiene la posición del coche a esa hora';
      }
    }
  } catch (e) {
    const msg = `Mapon no contestó al preguntar dónde estaba el coche: ${e.message}`;
    a.detalle.fallos.gps = msg;
    a.reintentar = true;
    return gpsDeAntes(a, rep, gas, msg);
  }

  // La parada de al lado vale si a esa hora el coche seguía junto a ella (el
  // reloj del correo y el de Mapon no son el mismo) o si Mapon no da su
  // posición; si ya se había movido, manda dónde estaba.
  const mCerca = cerca && punto ? G.metros(cerca, punto) : null;
  const deAlLado = cerca && (!punto || (mCerca != null && mCerca <= JUNTO_A_LA_PARADA_M)) ? cerca : null;
  const parada = cubre || deAlLado;
  let posicion = null;
  if (parada) {
    posicion = { lat: parada.lat, lng: parada.lng };
    Object.assign(a, { gpsFuente: 'parada', gpsAt: parada.desde, gpsHasta: parada.hasta, gpsDireccion: parada.direccion });
    a.detalle.parada = { desde: iso(parada.desde), hasta: iso(parada.hasta), direccion: parada.direccion };
    if (deAlLado) {
      // Se dice en la ficha: la hora del correo cae fuera de la parada.
      a.detalle.parada.noCubre = { antes: t < parada.desde, minutos: minutos(t < parada.desde ? parada.desde - t : t - parada.hasta),
        metros: mCerca };
    }
  } else if (punto) {
    posicion = { lat: punto.lat, lng: punto.lng };
    Object.assign(a, { gpsFuente: 'punto', gpsAt: punto.t });
    a.detalle.punto = { t: iso(punto.t) };
    if (cerca) {
      // Ya iba andando (o aún no había parado): se cuenta dónde estuvo parado.
      a.detalle.paradaCerca = { desde: iso(cerca.desde), hasta: iso(cerca.hasta), direccion: cerca.direccion, metros: mCerca };
    }
  } else {
    a.reintentar = true;
  }
  medirDesde(a, rep, posicion, gas, sinPosicion);
  return parada;
}

/**
 * Cuánto subió el depósito según la boya y cuánto le falta para lo pagado.
 * Rellena `a`. Si a media cuenta Mapon no contesta, la boya de la vez anterior
 * se queda (si la había) y se vuelve a mirar.
 */
async function mirarBoya(a, rep, unidad, t, parada, ctx) {
  const mp = ctx.mapon;
  const hasta = Math.min(ctx.ahora, t + 48 * H);
  let fallo = null;
  try {
    // El aforador de 72 h antes a 48 h después: el mismo que ya miró el GPS si
    // la parada era larga (ctx.aforador lo pide una vez).
    let serie = await ctx.aforador();
    a.boyaTipo = 'litros';
    // Los Ford mandan aquí ceros: su nivel va en % por otra serie.
    if (!serie.some(p => Number(p.v) > 0)) {
      const pct = await mp.nivelPorcentaje(unidad.unitId, t - 24 * H, hasta);
      if (pct.some(p => Number(p.v) > 0)) { serie = pct; a.boyaTipo = 'porcentaje'; } else serie = [];
    }
    const m = B.salto(serie, t, { parada });
    if (!m.ok) {
      if (m.sinSerie) {
        a.boyaTipo = 'sin';
        a.boyaMotivo = 'Este coche no da el nivel del depósito en Mapon (no se lee el aforador por el CAN)';
      } else {
        a.boyaMotivo = m.motivo;
        if (m.reintentar) a.reintentar = true;
      }
      return;
    }
    Object.assign(a, { boyaAntes: m.antes, boyaDespues: m.despues, boyaSalto: m.salto });
    a.detalle.boya = { tAntes: iso(m.tAntes), tDespues: iso(m.tDespues), conParada: m.conParada,
      lecturas: lecturasParaFicha(serie, m.tAntes - 45 * 60e3, m.tDespues + 45 * 60e3) };

    let litros = null;
    if (a.boyaTipo === 'litros') {
      litros = m.salto;
      a.boyaCorregida = false;
      const techo = B.techo(serie);
      a.boyaTecho = techo;
      if (B.topa(m, techo)) {
        const baja = B.bajaDelTecho(serie, m, techo);
        if (!baja) {
          // Se vuelve a mirar cuando baje; hasta entonces, el salto es un mínimo.
          a.boyaMotivo = `El aforador sigue en su techo (${techo} L) desde el repostaje: se corrige cuando baje`;
          a.reintentar = true;
        } else {
          let gk = {};
          // Desde una hora antes de la última lectura de antes, no desde «después»:
          // con el coche aparcado no llegan km ni gastado, y si el «después» es de
          // cuando volvió a arrancar, horas más tarde, la serie empezaría pasado
          // ese instante y no habría con qué interpolarlo (3784LFV, 23/10/2026).
          // Parado, el odómetro y el gastado no se mueven: el hueco no engaña.
          try {
            gk = await mp.gastadoYKm(unidad.unitId, m.tAntes - H, baja.t2 + 30 * 60e3);
          } catch (e) {
            // No es que no haya km: es que Mapon no contestó. Se vuelve a mirar.
            fallo = `Mapon no contestó al pedir los km para corregir el techo del aforador: ${e.message}`;
          }
          const c = B.corregirTecho(m, baja, gk);
          litros = c.litros;
          a.boyaCorregida = c.corregido;
          if (c.corregido) a.detalle.boya.correccion = { t2: iso(c.t2), v2: c.v2, gastado: c.gastadoEntre, como: c.como };
          else a.boyaMotivo = fallo || c.motivo;
        }
      }
    } else {
      // En %: sin la capacidad del depósito no hay litros, y sin litros no hay error.
      let capacidad = null;
      try {
        capacidad = await mp.capacidadDeposito(unidad.unitId);
      } catch (e) {
        fallo = `Mapon no contestó al pedir la capacidad del depósito: ${e.message}`;
      }
      a.detalle.boya.capacidad = capacidad;
      if (capacidad) litros = Math.round(m.salto * capacidad / 100 * 10) / 10;
      else a.boyaMotivo = fallo || 'El nivel de este coche va en % del depósito (Ford) y Mapon no tiene su capacidad: sin ella no se pasa a litros';
    }
    // TOPÓ Y NO SE HA PODIDO CORREGIR: el salto es un MÍNIMO, porque lo que
    // entró por encima del techo no se vio. Si se queda corto frente a lo
    // pagado, no dice nada —puede ser solo el techo— y no se compara: un rojo
    // ahí acusaría al conductor de una limitación del aforador. Si ya llega a
    // lo pagado, el déficit es 0: como poco entró lo pagado, y es verde
    // (combustible.semaforo; lo deduce al leer combustible.boya.esMinimo).
    // Hasta el 23/10/2026, con el error en valor absoluto, ese mínimo por encima
    // era «como poco ese error» y no podía ser verde.
    const minimo = a.boyaTipo === 'litros' && !a.boyaCorregida && B.topa(m, a.boyaTecho);
    const coma = v => String(v).replace('.', ',');
    if (litros != null) {
      a.boyaLitros = litros;
      // DOS REPOSTAJES EN LA MISMA PARADA suben el depósito juntos: la boya ve
      // un salto, y se compara con la SUMA de lo pagado. Si no, cada uno por
      // separado cabía en el salto y los dos salían verdes (8203LTR, tres días
      // de octubre: uno con la app y otro con tarjeta o en efectivo, en el
      // mismo minuto). Los de la parada, o los de 15 min a cada lado sin ella.
      let pagados = Number(rep.litros);
      const ventana = parada && parada.hasta != null ? [parada.desde - MARGEN_PARADA_MS, parada.hasta + MARGEN_PARADA_MS]
        : [t - 15 * 60e3, t + 15 * 60e3];
      const juntos = await repo.vecinosDe(rep.id, rep.matricula_norm, ventana[0], ventana[1]);
      if (juntos.length) {
        pagados = Math.round((pagados + juntos.reduce((s, x) => s + x.litros, 0)) * 1000) / 1000;
        a.detalle.boya.juntos = juntos;
        a.detalle.boya.pagados = pagados;
      }
      if (minimo && pagados > 0 && litros < pagados) {
        a.boyaMotivo = `${a.boyaMotivo ? a.boyaMotivo + '. ' : ''}Subió al menos ${coma(litros)} L, menos que lo pagado, ` +
          'y sin corregir el techo no se puede saber cuánto entró: no se compara';
      } else {
        // SOLO CUENTA LO QUE FALTA (boya.deficitPct): subir de más no penaliza.
        a.boyaErrorPct = B.deficitPct(litros, pagados);
        if (a.boyaErrorPct == null) a.boyaMotivo = 'El repostaje dice 0 litros (anulado): no hay con qué comparar';
        else if (minimo) {
          a.boyaMotivo = `${a.boyaMotivo ? a.boyaMotivo + '. ' : ''}Subió al menos ${coma(litros)} L, más que lo pagado: como poco entró lo pagado`;
        }
        if (juntos.length) {
          a.boyaMotivo = `${a.boyaMotivo ? a.boyaMotivo + '. ' : ''}En la misma parada hay ${juntos.length === 1 ? 'otro repostaje' : `otros ${juntos.length}`} ` +
            `de este coche (${juntos.map(x => `${x.hora}, ${coma(x.litros)} L`).join('; ')}): la boya se compara con los ${coma(pagados)} L de todos`;
        }
      }
    }
  } catch (e) {
    limpiarBoya(a);
    fallo = `Mapon no contestó al pedir el aforador: ${e.message}`;
    a.boyaMotivo = fallo;
  } finally {
    if (fallo) {
      a.detalle.fallos.boya = fallo;
      a.reintentar = true;
      // Lo de la vez anterior, si midió algo y este intento no midió más.
      if (rep.boya_tipo != null && (rep.boya_salto != null || a.boyaSalto == null)) restaurarBoya(a, rep);
    }
  }
}

/**
 * Audita UN repostaje y guarda lo que salga. `gas`: { lista, alias }, cargados
 * una vez por pasada. `rep` trae también lo de la vez anterior (gps_*, boya_*,
 * auditoria_detalle): si Mapon no contesta a algo, eso se queda.
 * → lo guardado, con su estado.
 */
async function auditar(rep, gas, ctx = {}) {
  const c = { mapon: ctx.mapon || mapon, ahora: ctx.ahora || Date.now() };
  const { t, repite, primera } = instante(rep);
  const elegida = G.elegir(rep.estacion, { proveedor: rep.proveedor, sede: rep.sede, gasolineras: gas.lista,
    alias: gas.alias, textos: gas.textos });
  const a = {
    gasolineraId: elegida.gasolineraId, gasolineraComo: elegida.como, candidatas: elegida.candidatas,
    detalle: { version: 2, fallos: {} }, reintentar: false,
  };
  if (repite) {
    a.detalle.horaRepetida = { pasada: primera ? 'primera' : 'segunda', t: iso(t) };
    if (rep.origen === 'excel') a.detalle.horaRepetida.excel = true;
  }
  const conGas = { lista: gas.lista, elegida };
  let unidad = null;
  try {
    unidad = ctx.unidad !== undefined ? ctx.unidad : await unidadDe(rep, c.mapon);
  } catch (e) {
    // Sin saber qué equipo es, no se pregunta nada: lo de antes se queda.
    const msg = `Mapon no contestó al buscar el coche: ${e.message}`;
    a.detalle.fallos.unidad = msg;
    a.reintentar = true;
    gpsDeAntes(a, rep, conGas, msg);
    if (rep.boya_tipo != null) restaurarBoya(a, rep);
    else a.boyaMotivo = msg;
  }
  if (unidad) {
    a.detalle.unidad = unidad;
    // El aforador de este repostaje, pedido UNA vez y solo si hace falta: lo
    // mira el GPS si la parada es larga (¿andaba?) y lo usa siempre la boya.
    let aforador = null;
    c.aforador = () => (aforador = aforador || c.mapon.nivelDeposito(unidad.unitId, t - 72 * H, Math.min(c.ahora, t + 48 * H)));
    const parada = await mirarGps(a, rep, unidad, t, conGas, c);
    await mirarBoya(a, rep, unidad, t, parada, c);
  } else if (!a.reintentar) {
    a.gpsMotivo = a.boyaMotivo = `El ${rep.matricula || 'coche'} no está en Mapon: no hay GPS ni aforador que mirar`;
    // Sin posición no hay distancia, pero la gasolinera sí se enseña.
  }
  if (!Object.keys(a.detalle.fallos).length) delete a.detalle.fallos;
  a.estado = a.reintentar ? 'incompleta' : 'hecha';
  await repo.guardarAuditoria(rep.id, a);
  return { id: rep.id, estado: a.estado, distancia: a.distancia, error: a.boyaErrorPct };
}

// ── LAS PASADAS ─────────────────────────────────────────────────────────────

// La lista, los nombres puestos a mano (por palabras) y los textos exactos del
// Excel de Petroprix (db/215). Sin db/215, sin textos: se casa como antes.
async function cargarGasolineras() {
  const [lista, alias, textos] = await Promise.all([repo.gasolineras(), repo.aliasGasolineras(),
    repo.textosGasolineras().catch(e => { if (e && e.code === '42703') return new Map(); throw e; })]);
  return { lista, alias, textos };
}

/**
 * LOS GRUPOS DE UNA PASADA. Los repostajes de un mismo coche (la misma unidad
 * de Mapon) cuyas horas caen en AGRUPAR_DIAS desde el primero van juntos: se
 * pide una vez el aforador de todos (de 72 h antes del primero a 48 h después
 * del último) y las paradas (de 3 h antes a 1 h después), y cada uno recorta lo
 * suyo (combustible.memoria). Con 4 días, la ventana del aforador es de 9 días,
 * lejos del tope de 31 de Mapon. Los que no tienen unidad no van en ninguno.
 * → [{ unidad, reps: [{ rep, t }], aforador: [d, h], paradas: [d, h] }]
 */
function agrupar(conUnidad, ahora) {
  const porUnidad = new Map();
  for (const x of conUnidad) {
    if (!x.unidad) continue;
    const k = x.unidad.unitId;
    if (!porUnidad.has(k)) porUnidad.set(k, []);
    porUnidad.get(k).push(x);
  }
  const grupos = [];
  for (const xs of porUnidad.values()) {
    xs.sort((a, b) => a.t - b.t);
    let g = null;
    for (const x of xs) {
      if (!g || x.t - g.reps[0].t > AGRUPAR_DIAS * 24 * H) { g = { unidad: x.unidad, reps: [] }; grupos.push(g); }
      g.reps.push(x);
    }
  }
  for (const g of grupos) {
    const t0 = g.reps[0].t, t1 = g.reps[g.reps.length - 1].t;
    g.aforador = [t0 - 72 * H, Math.min(ahora, t1 + 48 * H)];
    g.paradas = [t0 - 3 * H, Math.min(ahora, t1 + H)];
  }
  return grupos;
}

/** ¿Se puede preguntar a Mapon ahora? null si sí; si no, por qué. */
function maponNoVa() {
  if (!mapon.configurado()) return 'Falta MAPON_API_KEY en el servidor: no se audita con Mapon';
  if (!mapon.disponible()) {
    const c = mapon.estadoCaida();
    return `Mapon no está disponible${c && c.motivo ? ` (${c.motivo})` : ''}: se audita cuando vuelva`;
  }
  return null;
}

// Una pasada cada vez: node-cron no espera, y un botón puede coincidir con ella.
let enCurso = null;
let avisadoSinDb213 = false;

/**
 * Lo que toca auditar ahora: casa las gasolineras que falten, cierra lo que ya
 * no va a mejorar y audita los que toca, uno detrás de otro. Nunca lanza.
 */
/**
 * Audita una lista de repostajes como lo hace una pasada: cada uno con su
 * unidad de Mapon, agrupados por coche (una lectura del aforador y una de
 * paradas por grupo, combustible.memoria) y uno detrás de otro, con el tope de
 * tiempo. Los que no caben se cuentan en `quedan` (siguen pendientes). `c`
 * acumula las cuentas. Nunca lanza por un repostaje: lo apunta y sigue.
 */
async function auditarLista(lista, c, opciones = {}) {
  const { t0 = Date.now(), tope = TOPE_PASADA_MS, pausaMs = PAUSA_MAPON_MS } = opciones;
  const ahora = Date.now();
  const mem = conMemoria(mapon, { pausaMs });
  const gas = await cargarGasolineras();
  const apuntar = async (rep, e) => {
    c.fallos++;
    console.error(`❌ [Combustible] Auditar el repostaje ${rep.id} con Mapon: ${e.message}`);
    // Se le apunta el intento, sin tocar lo medido: si no, seguiría
    // «pendiente», sería el primero de cada pasada para siempre y veinte así
    // taparían a todos los demás. Así entra en las esperas y en el cierre a
    // «sin datos» como cualquiera.
    await repo.apuntarFallo(rep.id, e.message).catch(e2 =>
      console.error(`❌ [Combustible] Apuntar el fallo del repostaje ${rep.id}: ${e2.message}`));
  };

  // Primero, de qué equipo es cada uno (casi siempre sale de la base). Uno que
  // no se sabe porque Mapon no contestó va solo, y auditar() apunta el fallo.
  const conUnidad = [];
  for (const rep of lista) {
    const x = { rep, t: instante(rep).t, unidad: undefined };
    try { x.unidad = await unidadDe(rep, mem); } catch (_) { x.unidad = undefined; }
    conUnidad.push(x);
  }
  const grupos = agrupar(conUnidad, ahora);
  const orden = [...grupos.flatMap(g => g.reps.map(x => ({ x, g }))), ...conUnidad.filter(x => !x.unidad).map(x => ({ x, g: null }))];
  const precargados = new Set();
  for (const { x, g } of orden) {
    if (Date.now() - t0 > tope || maponNoVa()) { c.quedan++; continue; }
    try {
      if (g && !precargados.has(g)) {
        precargados.add(g);
        if (g.reps.length > 1) await mem.precargar(g.unidad.unitId, { aforador: g.aforador, paradas: g.paradas });
      }
      // Sin unidad (no está en Mapon, o no se pudo saber): auditar() lo resuelve como siempre.
      const r = await auditar(x.rep, gas, { mapon: mem, ahora, unidad: x.unidad === undefined ? undefined : x.unidad });
      c.auditados++;
      if (r.estado === 'hecha') c.hechos++; else c.incompletos++;
    } catch (e) {
      await apuntar(x.rep, e);
    }
  }
  const m = mem.cuenta();
  c.mapon = (c.mapon || 0) + m.pedidas;
  c.deMemoria = (c.deMemoria || 0) + m.deMemoria;
  c.grupos = (c.grupos || 0) + grupos.length;
  return c;
}

async function auditarPendientes({ origen = 'cron', limite = POR_PASADA } = {}) {
  if (enCurso && Date.now() - enCurso < 2 * TOPE_PASADA_MS) return { ok: false, saltada: true };
  const t0 = Date.now();
  enCurso = t0;
  const c = { gasolineras: 0, cerrados: 0, auditados: 0, hechos: 0, incompletos: 0, fallos: 0, quedan: 0 };
  try {
    c.gasolineras = await casarGasolineras();
    const noVa = maponNoVa();
    if (noVa) return { ok: false, motivo: noVa, ...c };
    c.cerrados = await repo.cerrarAuditoriasSinDatos(CIERRE);
    const lista = await repo.paraAuditar({ margenMin: MARGEN_MIN, esperasMin: ESPERAS_MIN, limite,
      recientesHoras: RECIENTES_HORAS, agruparDias: AGRUPAR_DIAS });
    await auditarLista(lista, c, { t0 });
    if (c.auditados || c.fallos || c.cerrados || origen === 'manual') {
      console.log(`⛽ [Combustible] Auditoría con Mapon: ${c.auditados} auditado(s) (${c.hechos} hecho(s), ${c.incompletos} a medias)` +
        `${c.cerrados ? `, ${c.cerrados} cerrado(s) sin datos` : ''}${c.fallos ? `, ${c.fallos} con error` : ''}` +
        `${c.quedan ? `, ${c.quedan} para la siguiente` : ''}${c.gasolineras ? ` · ${c.gasolineras} gasolinera(s) casada(s)` : ''}` +
        ` · ${c.mapon || 0} pregunta(s) a Mapon en ${c.grupos || 0} grupo(s)` +
        ` · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    return { ok: true, ...c };
  } catch (e) {
    // Sin db/213 (o sin db/215) todavía (tabla o columna que no existe): se
    // dice UNA vez en el log, no cada diez minutos, y sin reventar el cron. Y
    // se dice cuál: hasta el 23/10/2026 todo salía como «Falta db/213», también
    // cuando lo que faltaba era una columna de la 215 con la 213 ya aplicada.
    // (La auditoría no debería necesitar la 215: `origen` se lee con to_jsonb.)
    if (e && (e.code === '42P01' || e.code === '42703')) {
      const es215 = /origen|excel_|bot_|tipo|importacion/.test(e.message || '');
      if (!avisadoSinDb213) console.warn(`⚠️  [Combustible] Falta aplicar db/${es215 ? '215' : '213'}: no se auditan los repostajes con Mapon hasta entonces (${e.message})`);
      avisadoSinDb213 = true;
      return { ok: false, motivo: es215 ? FALTA_DB215 : FALTA_DB213, ...c };
    }
    console.error(`❌ [Combustible] La auditoría con Mapon: ${e.message}`);
    return { ok: false, motivo: e.message, ...c };
  } finally {
    if (enCurso === t0) enCurso = null;
  }
}

/** Audita uno ya, desde su ficha (sin esperar a su turno). */
async function auditarUno(id) {
  const rep = await repo.paraAuditarUno(id);
  if (!rep) throw new Error('Ese repostaje no existe');
  if (rep.estado !== 'leido') throw new Error('Solo se auditan los repostajes leídos (no los repetidos ni los que no se pudieron leer)');
  const noVa = maponNoVa();
  if (noVa) throw new Error(noVa);
  return auditar(rep, await cargarGasolineras());
}

/**
 * Audita los repostajes de estos ids, como una pasada (agrupados por coche y
 * con la misma memoria), aunque no les toque: para medir una muestra en el
 * entorno de pruebas (scripts) sin esperar al cron. Solo los leídos.
 */
async function auditarVarios(ids, { tope = TOPE_PASADA_MS } = {}) {
  const noVa = maponNoVa();
  if (noVa) throw new Error(noVa);
  const lista = (await Promise.all(ids.map(id => repo.paraAuditarUno(id)))).filter(r => r && r.estado === 'leido');
  const c = { auditados: 0, hechos: 0, incompletos: 0, fallos: 0, quedan: 0 };
  await auditarLista(lista, c, { tope });
  return c;
}

/**
 * Casa a mano la estación de un repostaje con una gasolinera de la lista, para
 * ese nombre de estación y para siempre (gasolinera_alias): todos los correos
 * con ese nombre pasan a esa gasolinera, y la distancia se rehace con la
 * posición que ya hubiera, sin preguntar a Mapon. `gasolineraId` null quita lo
 * puesto a mano y deja que se case otra vez por el nombre.
 */
async function corregirGasolinera(id, gasolineraId, usuarioId) {
  const rep = await repo.paraAuditarUno(id);
  if (!rep) throw new Error('Ese repostaje no existe');
  if (!rep.estacion) throw new Error('Este repostaje no trae el nombre de la estación');
  const clave = G.normalizar(rep.estacion).clave;
  if (!clave) throw new Error(`«${rep.estacion}» no tiene nada con que casarse`);
  if (gasolineraId == null) {
    await repo.quitarAlias({ proveedor: rep.proveedor, clave });
  } else {
    const g = (await repo.gasolineras()).find(x => x.id === Number(gasolineraId));
    if (!g) throw new Error('Esa gasolinera no está en la lista');
    if (g.proveedor !== rep.proveedor) throw new Error(`Esa gasolinera es de ${g.proveedor}, no de ${rep.proveedor}`);
    await repo.ponerAlias({ proveedor: rep.proveedor, clave, estacion: rep.estacion, gasolineraId: g.id, usuarioId });
  }
  // Todos los del mismo nombre de estación, otra vez (los que ya estaban bien no se tocan).
  const mismos = (await repo.leidosDelProveedor(rep.proveedor)).filter(x => G.normalizar(x.estacion).clave === clave);
  const cambiados = await casarGasolineras({ filas: mismos });
  return { cambiados, mismos: mismos.length };
}

/** La lista para elegir a mano: las del proveedor, por provincia y nombre. */
async function gasolinerasPara(proveedor) {
  return (await repo.gasolineras()).filter(g => !proveedor || g.proveedor === proveedor);
}

module.exports = {
  MARGEN_MIN, ESPERAS_MIN, CIERRE, POR_PASADA, AGRUPAR_DIAS, PAUSA_MAPON_MS, PAGO_TRAS_ARRANCAR_MS,
  auditarPendientes, auditarUno, auditarVarios, casarGasolineras, corregirGasolinera, gasolinerasPara, cargarGasolineras,
  // Gancho de prueba (scripts/comprobar-combustible*.js).
  _paradaDe: paradaDe, _unirParadas: unirParadas, _instante: instante, _agrupar: agrupar,
};
