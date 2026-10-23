// ============================================================
// COMBUSTIBLE · LA AUDITORÍA DE CADA REPOSTAJE CON MAPON
// ============================================================
// Cada repostaje leído del correo se mira contra Mapon, EN SOLO LECTURA (todo
// son GET de services/mapon; ninguna orden, ningún relé). Dos preguntas, con
// los umbrales de Camilo (combustible.semaforo.js):
//
//   · GPS: ¿estaba el coche en la gasolinera del correo a esa hora? Metros de
//     su posición a la gasolinera casada (verde < 700, amarillo < 1600).
//   · BOYA: ¿subió el depósito lo que dice el correo? Error % del salto del
//     aforador frente a los litros del correo (verde < 35, amarillo < 65).
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

const repo = require('./combustible.repo');
const G = require('./combustible.gasolinera');
const B = require('./combustible.boya');
const mapon = require('../../services/mapon');

const MARGEN_MIN = 45;                          // tras el repostaje, para que haya lecturas de después
const ESPERAS_MIN = [30, 60, 120, 240, 480, 720];  // entre intentos de los que quedaron a medias
const CIERRE = { horas: 48, minIntentos: 3, maxIntentos: 8 };
const POR_PASADA = 20;                          // repostajes por pasada, uno detrás de otro
const TOPE_PASADA_MS = 4 * 60 * 1000;           // y no más de esto: el cron salta cada 10 minutos
const MINUTO_MS = 59e3;                         // el correo da el minuto: de hh:mm:00 a hh:mm:59
const MARGEN_PARADA_MS = 5 * 60e3;              // una parada «de al lado», para decirlo en la ficha
const JUNTO_A_LA_PARADA_M = 100;                // a esa hora seguía allí: es esa parada (relojes distintos)
const PUNTO_MAX_MS = 20 * 60e3;
const LECTURAS_FICHA = 90;                      // las del aforador que se guardan para dibujarlas en la ficha

const FALTA_DB213 = 'Falta aplicar la migración db/213 (auditoría de repostajes) desde /migraciones';
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
  const [lista, alias] = await Promise.all([repo.gasolineras(), repo.aliasGasolineras()]);
  let cambiados = 0;
  for (const x of filas || await repo.paraCasarGasolinera()) {
    const e = G.elegir(x.estacion, { proveedor: x.proveedor, sede: x.sede, gasolineras: lista, alias });
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
 * → { cubre, cerca }
 */
function paradaDe(paradas, t) {
  const lejos = p => (t < p.desde ? p.desde - t : p.hasta != null && t > p.hasta ? t - p.hasta : 0);
  const ps = [...(paradas || [])].sort((a, b) => lejos(a) - lejos(b));
  const cubre = ps.find(p => p.desde <= t + MINUTO_MS && (p.hasta == null || p.hasta >= t)) || null;
  const cerca = cubre ? null : ps.find(p => lejos(p) <= MARGEN_PARADA_MS) || null;
  return { cubre, cerca };
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
 */
function instante(rep) {
  const t = new Date(rep.repostaje_at).getTime();
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
async function unidadDe(rep) {
  const enBase = await repo.unidadMapon(rep.vehiculo_id, rep.matricula_norm);
  if (enBase) return enBase;
  const u = await mapon.unidadPorMatricula(rep.matricula);
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
  if (!antes) { medirDesde(a, rep, null, gas, motivo); return null; }
  Object.assign(a, antes.campos);
  Object.assign(a.detalle, antes.detalle);
  medirDesde(a, rep, antes.posicion, gas, null);
  return antes.parada;
}

/**
 * Dónde estaba el coche y a cuánto de la gasolinera. Rellena `a`; devuelve la
 * parada en la que repostó (la usa la boya), o null si a esa hora no estaba
 * parado.
 */
async function mirarGps(a, rep, unidad, t, gas) {
  let cubre, cerca, punto = null, sinPosicion = null;
  try {
    ({ cubre, cerca } = paradaDe(unirParadas(await mapon.paradasUnidad(unidad.unitId, t - 3 * H, Math.min(Date.now(), t + H))), t));
    if (!cubre) {
      const p = await mapon.posicionEn(unidad.unitId, t);
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
 * Cuánto subió el depósito según la boya y cuánto se aleja de los litros del
 * correo. Rellena `a`. Si a media cuenta Mapon no contesta, la boya de la vez
 * anterior se queda (si la había) y se vuelve a mirar.
 */
async function mirarBoya(a, rep, unidad, t, parada) {
  const hasta = Math.min(Date.now(), t + 48 * H);
  let fallo = null;
  try {
    let serie = await mapon.nivelDeposito(unidad.unitId, t - 72 * H, hasta);
    a.boyaTipo = 'litros';
    // Los Ford mandan aquí ceros: su nivel va en % por otra serie.
    if (!serie.some(p => Number(p.v) > 0)) {
      const pct = await mapon.nivelPorcentaje(unidad.unitId, t - 24 * H, hasta);
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
            gk = await mapon.gastadoYKm(unidad.unitId, m.tAntes - H, baja.t2 + 30 * 60e3);
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
        capacidad = await mapon.capacidadDeposito(unidad.unitId);
      } catch (e) {
        fallo = `Mapon no contestó al pedir la capacidad del depósito: ${e.message}`;
      }
      a.detalle.boya.capacidad = capacidad;
      if (capacidad) litros = Math.round(m.salto * capacidad / 100 * 10) / 10;
      else a.boyaMotivo = fallo || 'El nivel de este coche va en % del depósito (Ford) y Mapon no tiene su capacidad: sin ella no se pasa a litros';
    }
    // TOPÓ Y NO SE HA PODIDO CORREGIR: el salto es un MÍNIMO, porque lo que
    // entró por encima del techo no se vio. Si se queda corto frente al
    // correo, no dice nada —puede ser solo el techo— y no se compara: un rojo
    // ahí acusaría al conductor de una limitación del aforador. Si aun así pasa
    // de los litros del correo, el error es «como poco ese»: vale para decir
    // amarillo o rojo, pero NO verde, porque el de verdad puede ser mayor
    // (combustible.semaforo; lo deduce al leer combustible.boya.esMinimo).
    const minimo = a.boyaTipo === 'litros' && !a.boyaCorregida && B.topa(m, a.boyaTecho);
    const coma = v => String(v).replace('.', ',');
    if (litros != null) {
      a.boyaLitros = litros;
      if (minimo && Number(rep.litros) > 0 && litros < Number(rep.litros)) {
        a.boyaMotivo = `${a.boyaMotivo ? a.boyaMotivo + '. ' : ''}Subió al menos ${coma(litros)} L, menos que el correo, ` +
          'y sin corregir el techo no se puede saber cuánto entró: no se compara';
      } else {
        a.boyaErrorPct = B.errorPct(litros, rep.litros);
        if (a.boyaErrorPct == null) a.boyaMotivo = 'El correo dice 0 litros (un repostaje anulado): no hay con qué comparar';
        else {
          a.boyaErrorPct = Math.min(a.boyaErrorPct, 99999);
          if (minimo) {
            a.boyaMotivo = `${a.boyaMotivo ? a.boyaMotivo + '. ' : ''}Subió al menos ${coma(litros)} L, y el error es como poco del ` +
              `${coma(a.boyaErrorPct)} %: con eso se puede decir amarillo o rojo, pero no verde`;
          }
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
async function auditar(rep, gas) {
  const { t, repite, primera } = instante(rep);
  const elegida = G.elegir(rep.estacion, { proveedor: rep.proveedor, sede: rep.sede, gasolineras: gas.lista, alias: gas.alias });
  const a = {
    gasolineraId: elegida.gasolineraId, gasolineraComo: elegida.como, candidatas: elegida.candidatas,
    detalle: { version: 2, fallos: {} }, reintentar: false,
  };
  if (repite) a.detalle.horaRepetida = { pasada: primera ? 'primera' : 'segunda', t: iso(t) };
  const conGas = { lista: gas.lista, elegida };
  let unidad = null;
  try {
    unidad = await unidadDe(rep);
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
    const parada = await mirarGps(a, rep, unidad, t, conGas);
    await mirarBoya(a, rep, unidad, t, parada);
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

const cargarGasolineras = async () => {
  const [lista, alias] = await Promise.all([repo.gasolineras(), repo.aliasGasolineras()]);
  return { lista, alias };
};

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
async function auditarPendientes({ origen = 'cron' } = {}) {
  if (enCurso && Date.now() - enCurso < 2 * TOPE_PASADA_MS) return { ok: false, saltada: true };
  const t0 = Date.now();
  enCurso = t0;
  const c = { gasolineras: 0, cerrados: 0, auditados: 0, hechos: 0, incompletos: 0, fallos: 0, quedan: 0 };
  try {
    c.gasolineras = await casarGasolineras();
    const noVa = maponNoVa();
    if (noVa) return { ok: false, motivo: noVa, ...c };
    c.cerrados = await repo.cerrarAuditoriasSinDatos(CIERRE);
    const lista = await repo.paraAuditar({ margenMin: MARGEN_MIN, esperasMin: ESPERAS_MIN, limite: POR_PASADA });
    const gas = await cargarGasolineras();
    for (const rep of lista) {
      if (Date.now() - t0 > TOPE_PASADA_MS || maponNoVa()) { c.quedan++; continue; }
      try {
        const r = await auditar(rep, gas);
        c.auditados++;
        if (r.estado === 'hecha') c.hechos++; else c.incompletos++;
      } catch (e) {
        c.fallos++;
        console.error(`❌ [Combustible] Auditar el repostaje ${rep.id} con Mapon: ${e.message}`);
        // Se le apunta el intento, sin tocar lo medido: si no, seguiría
        // «pendiente», sería el primero de cada pasada para siempre y veinte así
        // taparían a todos los demás. Así entra en las esperas y en el cierre a
        // «sin datos» como cualquiera.
        await repo.apuntarFallo(rep.id, e.message).catch(e2 =>
          console.error(`❌ [Combustible] Apuntar el fallo del repostaje ${rep.id}: ${e2.message}`));
      }
    }
    if (c.auditados || c.fallos || c.cerrados || origen === 'manual') {
      console.log(`⛽ [Combustible] Auditoría con Mapon: ${c.auditados} auditado(s) (${c.hechos} hecho(s), ${c.incompletos} a medias)` +
        `${c.cerrados ? `, ${c.cerrados} cerrado(s) sin datos` : ''}${c.fallos ? `, ${c.fallos} con error` : ''}` +
        `${c.quedan ? `, ${c.quedan} para la siguiente` : ''}${c.gasolineras ? ` · ${c.gasolineras} gasolinera(s) casada(s)` : ''}` +
        ` · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    return { ok: true, ...c };
  } catch (e) {
    // Sin db/213 todavía (tabla o columna que no existe): se dice UNA vez en el
    // log, no cada diez minutos, y sin reventar el cron.
    if (e && (e.code === '42P01' || e.code === '42703')) {
      if (!avisadoSinDb213) console.warn('⚠️  [Combustible] Falta aplicar db/213: no se auditan los repostajes con Mapon hasta entonces');
      avisadoSinDb213 = true;
      return { ok: false, motivo: FALTA_DB213, ...c };
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
  MARGEN_MIN, ESPERAS_MIN, CIERRE,
  auditarPendientes, auditarUno, casarGasolineras, corregirGasolinera, gasolinerasPara,
  // Gancho de prueba (scripts/comprobar-combustible.js).
  _paradaDe: paradaDe, _unirParadas: unirParadas, _instante: instante,
};
