/**
 * Auditoría de flota FORENSE — reparte los km GPS de Mapon por el estado del
 * conductor en BOLT, para ver quién rueda km "por fuera" (sin pedido / con BOLT
 * cerrado).
 *
 * ── Método (exacto, no especulativo) ─────────────────────────────────────────
 * · La DISTANCIA la pone siempre Mapon (traza punto a punto, decoded_route). Una
 *   sola regla → los buckets suman exacto al total, sin descuadres entre APIs.
 * · El ESTADO lo ponen los TIMESTAMPS de BOLT (medidos, no el GPS espaciado):
 *     [pickup, dropoff]   → CON PASAJERO
 *     [accepted, pickup]  → IDA A RECOGER (incluye aceptados que se cancelan)
 *     sin pedido + waiting_orders → ESPERA    (disponible: es trabajo normal)
 *     sin pedido + busy           → DESCANSO  ← NO disponible para BOLT
 *     sin pedido + inactive       → FUERA     ← app cerrada
 *   DESCANSO y FUERA son los km "no disponibles": rodar marcándose ocupado sale
 *   igual de caro que rodar con la app cerrada (hay sesiones de busy de horas).
 *   Es CONSERVADOR: si no consta el estado, cuenta como ESPERA (no acusa).
 *
 * · Además se miden las HORAS por estado. Los state logs de BOLT son eventos de
 *   CAMBIO (89% de los pares consecutivos son transiciones), así que la duración
 *   entre logs sí es fiable — al contrario que su GPS, demasiado espaciado para
 *   medir distancia. Eso caza el descanso largo aunque no haya rodado ni un km.
 *
 * ── Histórico ────────────────────────────────────────────────────────────────
 * Es pesado (una llamada Mapon por coche/día), así que NO se calcula en cada
 * consulta: lo puebla un cron (5am) día a día en el Sheet, y las consultas solo
 * LEEN. Backfill manual por rango con procesarRango().
 */

const { fetchRangoCompleto, fetchAllPaginated, CONFIG_BOLT } = require('../../services/bolt');
const mapon = require('../../services/mapon');
const repo = require('./auditoria.repo');
// El núcleo de km de Flota viva: de ahí sale el odómetro ya ingerido. Se entra
// por su servicio, no por su tabla, que es la regla de la casa.
const flotaRutas = require('../../services/flotaViva/rutas');

const ZONA = 'Europe/Madrid';
const MAX_DIAS = 31;
const CONC_MAPON = 3;         // llamadas Mapon en paralelo (deja hueco bajo el tope de 5)
const MARGEN_SEG = 4 * 3600;  // margen para pedidos/trayectos que cruzan la medianoche

// ── Utilidades ───────────────────────────────────────────────────────────────

const normPlaca = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const round1 = v => Math.round(v * 10) / 10;
const suma = arr => arr.reduce((s, x) => s + x, 0);
const ahora = () => new Date().toISOString();
const num = v => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

/** unix (segundos) → día 'aaaa-mm-dd' en hora peninsular. */
function diaLocal(unixSeg) {
  const d = new Date(unixSeg * 1000);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const hoyMadrid = () => diaLocal(Math.floor(Date.now() / 1000));
function diaMenos(dia, n) {
  const [y, m, d] = dia.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
const fechaEUaISO = f => { const [d, m, y] = String(f).split('/'); return `${y}-${m}-${d}`; };
const isoAddmm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/** Desfase de Madrid ese día (+1 invierno / +2 verano), en segundos. */
function offsetMadridSeg(dia) {
  const noon = new Date(dia + 'T12:00:00Z');
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour12: false, hour: '2-digit' }).format(noon));
  return (h - 12) * 3600;
}
/**
 * Límites unix [00:00, 23:59:59] del día local Madrid. El fin se calcula con el
 * inicio del día SIGUIENTE, no sumando 86400: en los cambios de hora el día dura 23
 * o 25 h y con el salto fijo se contaba una hora dos veces (marzo) o se perdía
 * (octubre).
 */
function inicioDiaMadrid(dia) {
  const midUTC = Math.floor(new Date(dia + 'T00:00:00Z').getTime() / 1000);
  // El desfase vigente A MEDIANOCHE es el de la víspera: el cambio de hora ocurre a
  // las 2-3 de la madrugada, así que el mediodía del MISMO día ya lleva el desfase
  // nuevo y desplazaba una hora el arranque de los días de cambio (marzo/octubre).
  return midUTC - offsetMadridSeg(diaMenos(dia, 1));
}
function limitesDiaMadrid(dia) {
  const start = inicioDiaMadrid(dia);
  return { start, end: inicioDiaMadrid(diaMenos(dia, -1)) - 1 };
}

/** Hora local de un instante en Madrid (0-23). */
const horaLocalDe = ts => Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour12: false, hour: '2-digit' }).format(new Date(ts * 1000)));

/**
 * Instante en que empieza `hora`:00 (local Madrid) del día indicado. Se prueban los dos
 * desfases posibles de España (CET +1 / CEST +2) y se elige el que de verdad cae en esa
 * hora local, así los días de cambio de hora no descuadran los tramos de turno.
 */
function tsDeHoraLocal(dia, hora) {
  const [y, m, d] = dia.split('-').map(Number);
  const base = Math.floor(Date.UTC(y, m - 1, d, hora) / 1000);
  for (const off of [3600, 7200]) {
    const ts = base - off;
    if (horaLocalDe(ts) === hora && diaLocal(ts) === dia) return ts;
  }
  return base - offsetMadridSeg(dia);
}

// ── Tramos de auditoría ───────────────────────────────────────────────────────
// Estos coches suelen llevar DOS conductores en 24 h, así que mirar solo el día
// natural mezcla los dos turnos y diluye lo que hizo cada uno. Se audita en tres
// tramos, y los tres se calculan de la MISMA lectura de Mapon:
//   · dia      turno de día:   05:00 → 17:00 del propio día
//   · noche    turno de noche: 17:00 → 05:00 del día siguiente
//   · completo día natural:    00:00 → 24:00 (la vista de siempre)
// "completo" NO es la suma de los otros dos: el tramo 00:00-05:00 pertenece al turno de
// noche de la víspera. Por eso se guardan y se consultan por separado.
// Además, el DÍA NATURAL partido por la mitad (00–12 y 12–24), que es otra forma de
// mirarlo cuando el relevo no cae a las 5: no depende de los turnos y permite un
// segundo flujo comparable entre coches.
// Del nucleo: era la segunda copia de la misma constante (ver services/nucleo.js).
const { HORA_DIA: HORA_TURNO_DIA, HORA_NOCHE: HORA_TURNO_NOCHE } = require('../../services/nucleo');
const SEGMENTOS = ['completo', 'dia', 'noche', 'manana', 'tarde'];
const ETIQUETA_SEG = {
  completo: 'Día natural (00:00–24:00)',
  dia: `Turno de día (${HORA_TURNO_DIA}:00–${HORA_TURNO_NOCHE}:00)`,
  noche: `Turno de noche (${HORA_TURNO_NOCHE}:00–${HORA_TURNO_DIA}:00)`,
  manana: 'Primera mitad (00:00–12:00)',
  tarde: 'Segunda mitad (12:00–24:00)'
};

/** Ventana [start, end) de un tramo. */
function limitesSegmento(dia, seg) {
  if (seg === 'dia') return { start: tsDeHoraLocal(dia, HORA_TURNO_DIA), end: tsDeHoraLocal(dia, HORA_TURNO_NOCHE) };
  if (seg === 'noche') return { start: tsDeHoraLocal(dia, HORA_TURNO_NOCHE), end: tsDeHoraLocal(diaMenos(dia, -1), HORA_TURNO_DIA) };
  const l = limitesDiaMadrid(dia);
  if (seg === 'manana') return { start: l.start, end: tsDeHoraLocal(dia, 12) };
  if (seg === 'tarde') return { start: tsDeHoraLocal(dia, 12), end: l.end + 1 };
  return { start: l.start, end: l.end + 1 };
}

/** Como en mapon: día final completo, tope 31 días. */
function resolverRango({ desde, hasta } = {}, porDefectoDias = 7) {
  const fin = (desde || hasta) ? (mapon.parseFecha(hasta) || new Date()) : new Date();
  if (hasta) fin.setHours(23, 59, 59, 0);
  let ini = mapon.parseFecha(desde);
  if (!ini) { ini = new Date(fin); ini.setDate(ini.getDate() - porDefectoDias); }
  ini.setHours(0, 0, 0, 0);
  if (ini > fin) throw new Error('La fecha inicial es posterior a la final');
  const dias = Math.round((fin - ini) / 86400000);
  if (dias > MAX_DIAS) throw new Error(`El rango máximo es ${MAX_DIAS} días (has pedido ${dias})`);
  return { ini, fin };
}
function ejeDias(ini, fin) {
  const dias = [];
  for (let d = new Date(ini); d <= fin; d.setDate(d.getDate() + 1)) dias.push(diaLocal(Math.floor(d.getTime() / 1000)));
  return dias;
}

function haversineKm(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dlat = r(b.lat - a.lat), dln = r(b.lng - a.lng);
  const s = Math.sin(dlat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function enParalelo(items, n, fn) {
  const it = items[Symbol.iterator]();
  const runner = async () => { for (let x = it.next(); !x.done; x = it.next()) await fn(x.value); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, runner));
}

// ── Núcleo de cálculo (puro y testeable) ──────────────────────────────────────

/** Une intervalos [ini,fin] solapados, ordenados por inicio. */
function mergeIv(ivs) {
  const s = ivs.filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}
const enIntervalos = (t, ivs) => { for (const [a, b] of ivs) if (t >= a && t < b) return true; return false; };

// Tope para no imputar estados a un coche que simplemente dejó de reportar (parado
// días en el taller, p. ej.). NO puede ser corto: los logs son eventos de CAMBIO y
// un descanso real llega a durar horas seguidas sin ningún log intermedio — con un
// corte de 1 h se perdían justo las pausas largas, que son las que interesan (en la
// muestra real había 21 sesiones de busy de más de 2 h y una de 7,5 h).
const MAX_HUECO_ESTADO = 12 * 3600;

// Prioridad al ordenar logs del MISMO segundo. Gana el ÚLTIMO de la lista, así que
// el orden va de más acusatorio a menos: ante un empate se impone el estado que NO
// acusa. Sin esto el ganador lo decidía el orden de la respuesta de BOLT y el
// resultado no era ni reproducible (mismo problema ya documentado en boltHorasCore).
const RANGO_ESTADO = { inactive: 0, busy: 1, waiting_orders: 2, has_order: 3 };
const rangoEstado = s => (RANGO_ESTADO[s] === undefined ? 2 : RANGO_ESTADO[s]);

/** Intervalos de estado de un coche a partir de sus pedidos BOLT. */
function construirIv(ordenes, logs) {
  const pasajero = [], ida = [];
  const val = v => (v == null ? null : Number(v));   // ojo: 0 es válido, no usar truthiness
  ordenes.forEach(o => {
    const ta = val(o.order_accepted_timestamp), tp = val(o.order_pickup_timestamp);
    const td = val(o.order_drop_off_timestamp), tc = val(o.order_cancelled_timestamp);
    if (o.order_status === 'finished' && tp != null && td != null && td > tp) pasajero.push([tp, td]);
    const idaFin = tp != null ? tp : tc;         // recogió, o canceló antes de recoger
    if (ta != null && idaFin != null && idaFin > ta) ida.push([ta, idaFin]);
  });
  const orden = (logs || []).slice().sort((a, b) => a.t - b.t || rangoEstado(a.state) - rangoEstado(b.state));
  return { pasajero: mergeIv(pasajero), ida: mergeIv(ida), logs: orden, porConductor: agruparPorConductor(orden) };
}

/** Los logs del coche, separados por conductor (cada uno con su línea temporal). */
function agruparPorConductor(logs) {
  const m = new Map();
  (logs || []).forEach(l => {
    const k = l.driver || 'sin-conductor';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(l);
  });
  return [...m.values()];   // ya vienen ordenados: se reparte una lista ordenada
}

/** Último log con t <= instante de una lista ordenada, o null. */
function ultimoLog(t, logs) {
  if (!logs || !logs.length) return null;
  let lo = 0, hi = logs.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (logs[m].t <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
  return idx >= 0 ? logs[idx] : null;
}

/**
 * Estado del COCHE en el instante t. Un coche lo comparten el turno de día y el de
 * noche, y los logs de ambos conductores llegan mezclados: si se mira solo "el
 * último log", el `inactive` que emite el saliente al cerrar sesión cae encima de
 * los km del entrante y lo acusa sin motivo. Por eso se mira el último estado de
 * CADA conductor y manda el que esté más trabajando (has_order > waiting_orders >
 * busy > inactive): si alguien tiene el coche disponible, el coche está disponible.
 *
 * Solo cuentan los logs de las últimas MAX_HUECO_ESTADO horas: un estado de hace
 * días no dice nada del ahora. Sin dato → null (y bucketDe no acusa).
 */
function estadoEn(t, iv) {
  const grupos = (iv && iv.porConductor) || (iv && iv.logs ? [iv.logs] : []);
  let mejor = null;
  for (const logs of grupos) {
    const l = ultimoLog(t, logs);
    if (!l || t - l.t > MAX_HUECO_ESTADO) continue;         // estado rancio: no cuenta
    if (mejor === null || rangoEstado(l.state) > rangoEstado(mejor)) mejor = l.state;
  }
  return mejor;
}

/**
 * Los cuatro estados que usa BOLT (verificado sobre datos reales: no hay más) son
 * has_order, waiting_orders, busy e inactive. Aquí solo importan los tres que
 * pueden darse SIN pedido casado; has_order sin intervalo (pedido de otra flota o
 * fuera de ventana) se trata como trabajo normal, que es lo conservador.
 */
function bucketDe(t, iv) {
  if (enIntervalos(t, iv.pasajero)) return 'pasajero';
  if (enIntervalos(t, iv.ida)) return 'ida';
  const st = estadoEn(t, iv);
  if (st === 'inactive') return 'fuera';
  if (st === 'busy') return 'descanso';
  return 'espera';   // waiting_orders, has_order suelto o estado desconocido
}

/**
 * Horas por estado dentro de la ventana [ini, fin]. Se calcula POR CONDUCTOR y se
 * suma: en un coche compartido, mezclar las dos líneas temporales trocearía los
 * tramos de uno con los eventos del otro. Los huecos mayores de MAX_HUECO_ESTADO no
 * se imputan (el coche dejó de reportar, no siguió en ese estado).
 */
function tiempoPorEstado(iv, ini, fin) {
  const seg = { has_order: 0, waiting_orders: 0, busy: 0, inactive: 0 };
  const grupos = (iv && iv.porConductor) || (Array.isArray(iv) ? [iv] : []);
  grupos.forEach(logs => {
    for (let i = 1; i < logs.length; i++) {
      const a = logs[i - 1], b = logs[i];
      const dur = b.t - a.t;
      if (dur <= 0 || dur > MAX_HUECO_ESTADO) continue;
      const desde = Math.max(a.t, ini), hasta = Math.min(b.t, fin);   // recorta al día
      if (hasta <= desde) continue;
      if (seg[a.state] !== undefined) seg[a.state] += hasta - desde;
    }
  });
  return seg;
}

/**
 * Reparte los km de los trayectos entre los 4 buckets. Cada tramo entre dos
 * puntos GPS va al estado de su punto de INICIO; luego se escala el trayecto para
 * que sume EXACTO la distancia que da Mapon (evita el subconteo de la línea recta).
 */
function atribuirRecorrido(trips, iv, ventana = null) {
  // UN TRAYECTO SE REPARTE POR DONDE PASA, no cuenta entero donde empieza.
  //
  // La regla de antes funcionaba con trayectos cortos y era demoledora con uno
  // largo: Carlos Arturo Borelli hizo uno de 249 km y SIETE HORAS que arrancó a
  // las 04:45, un cuarto de hora antes de abrir la jornada, y su mañana entera
  // se contó en el día anterior. En diez días había 330 trayectos y 22.302 km
  // mal colocados. Como aquí ya se va punto a punto, basta con mirar la hora de
  // cada tramo: el trayecto se parte solo por el corte.
  const dentro = t => !ventana || (t >= ventana.desde && t < ventana.hasta);
  const km = { pasajero: 0, ida: 0, espera: 0, descanso: 0, fuera: 0 };
  trips.forEach(trip => {
    const pts = trip.puntos || [];
    const distKm = (trip.distancia || 0) / 1000;
    if (pts.length < 2) {
      // Sin traza no hay por dónde partirlo: se queda entero donde empieza, que
      // es lo único que se sabe de él.
      const t = trip.inicioTs != null ? trip.inicioTs : (pts[0] && pts[0].t);
      if (t != null && distKm && dentro(t)) km[bucketDe(t, iv)] += distKm;
      return;
    }
    const seg = [];
    let sumRaw = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = haversineKm(pts[i - 1], pts[i]);
      seg.push([d, bucketDe(pts[i - 1].t, iv), pts[i - 1].t]);
      sumRaw += d;
    }
    // LA ESCALA SE CALCULA SOBRE EL TRAYECTO ENTERO, aunque luego solo se sumen
    // los tramos de dentro: es lo que hace que los trozos de las dos ventanas
    // sumen exactamente los metros que dio Mapon, sin inventar ni perder.
    const escala = sumRaw > 0 ? distKm / sumRaw : 0;
    seg.forEach(([d, b, t]) => { if (dentro(t)) km[b] += d * escala; });
  });
  return km;
}

/**
 * Lo mismo, pero repartiendo el ODÓMETRO DEL COCHE en vez de la traza del GPS.
 *
 * Es la fuente buena: el GPS estima uniendo puntos —corta curvas y pierde lo que
 * no ve—, mientras que esto es el número del cuadro, que el coche cuenta solo.
 *
 * El reparto es idéntico en espíritu al de arriba: cada trocito de tiempo cae en
 * el estado que hubiera en ese momento. Como entre dos lecturas del odómetro
 * pasan 90 segundos de mediana y un cambio de estado puede caer en medio, cada
 * tramo se parte en rodajas de un minuto y cada rodaja va a su cubo. Sin eso, un
 * tramo a caballo entre "en viaje" y "desconectado" se iría entero a uno de los
 * dos.
 */
function atribuirOdometro(segs, iv, ventana) {
  const RODAJA = 60;
  const km = { pasajero: 0, ida: 0, espera: 0, descanso: 0, fuera: 0 };
  (segs || []).forEach(sg => {
    const dur = sg.hasta - sg.desde;
    if (!(dur > 0) || !(sg.metros > 0)) return;
    const a = ventana ? Math.max(sg.desde, ventana.desde) : sg.desde;
    const b = ventana ? Math.min(sg.hasta, ventana.hasta) : sg.hasta;
    if (!(b > a)) return;
    const kmSeg = sg.metros / 1000;
    const n = Math.max(1, Math.ceil((b - a) / RODAJA));
    const paso = (b - a) / n;
    for (let i = 0; i < n; i++) {
      const medio = Math.round(a + paso * (i + 0.5));
      km[bucketDe(medio, iv)] += kmSeg * (paso / dur);
    }
  });
  return km;
}

// ── BOLT: pedidos, logs y vehículos de un rango ───────────────────────────────

/**
 * fetchAllPaginated devuelve datos PARCIALES en silencio si una página falla (deja
 * el motivo en ultimoDiagnostico). Para una auditoría eso es inaceptable: media
 * lectura de logs convierte a un infractor en "espera" y el día quedaría congelado
 * como limpio. Ante datos incompletos se aborta el día entero.
 */
function comprobarCompleto(etiqueta) {
  const d = fetchAllPaginated.ultimoDiagnostico || {};
  if (d.motivo === 'error-http' || d.motivo === 'tope-paginas' || d.motivo === 'timeout') {
    throw new Error(`BOLT devolvió datos incompletos en ${etiqueta} (${d.motivo}${d.errorHttp ? ' HTTP ' + d.errorHttp : ''}): no se guarda el día`);
  }
  if (d.totalRows != null && d.registros != null && d.registros < d.totalRows) {
    throw new Error(`BOLT devolvió ${d.registros} de ${d.totalRows} registros en ${etiqueta}: no se guarda el día`);
  }
}

async function boltOrdenesRango(fromTs, tillTs) {
  let out = [];
  for (const f of CONFIG_BOLT.flotas) {
    out = out.concat(await fetchRangoCompleto('/fleetIntegration/v1/getFleetOrders',
      { company_ids: [f.id], company_id: f.id, time_range_filter_type: 'created' }, 'orders', fromTs, tillTs, 1000, `AUD ord ${f.id}`));
    comprobarCompleto(`pedidos flota ${f.id}`);
  }
  return out;
}
async function boltLogsRango(fromTs, tillTs) {
  let out = [];
  for (const f of CONFIG_BOLT.flotas) {
    out = out.concat(await fetchRangoCompleto('/fleetIntegration/v1/getFleetStateLogs',
      { company_id: f.id }, 'state_logs', fromTs, tillTs, 1000, `AUD log ${f.id}`));
    comprobarCompleto(`state logs flota ${f.id}`);
  }
  return out;
}
async function boltVehiculos(fromTs, tillTs) {
  const map = {};   // vehicle_uuid -> placa normalizada
  for (const f of CONFIG_BOLT.flotas) {
    const v = await fetchRangoCompleto('/fleetIntegration/v1/getVehicles',
      { company_id: f.id }, 'vehicles', fromTs, tillTs, 100, `AUD veh ${f.id}`);
    v.forEach(x => {
      const placa = normPlaca(x.reg_number || x.registration_number || x.license_plate);
      const uuid = x.uuid || x.vehicle_uuid;
      if (placa && uuid) map[uuid] = placa;
    });
  }
  return map;
}

// ── Cálculo de un día (fetch + atribución) ────────────────────────────────────

async function leerFuelDia(dia) {
  const comb = await mapon.leerCombustible({ desde: isoAddmm(diaMenos(dia, 1)), hasta: isoAddmm(diaMenos(dia, -1)) });
  return comb.eventos
    .map(e => ({ ...e, dia: fechaEUaISO(e.fecha), placa: normPlaca(e.matricula) }))
    .filter(e => e.dia === dia);
}

/**
 * Conductores que BOLT vio en ese coche dentro de la ventana. Se saca de los state
 * logs (no del planificador): es quien de verdad estaba conectado con ese vehículo.
 * Los logs son eventos de cambio y se emiten cada pocos minutos, así que quien haya
 * trabajado un turno entero aparece seguro.
 */
function conductoresEnVentana(logs, ini, fin, nombrePorUuid) {
  const uuids = new Set();
  (logs || []).forEach(l => { if (l.t >= ini && l.t < fin && l.driver) uuids.add(l.driver); });
  // Se devuelve el UUID además del nombre: es lo que permite enlazar con la
  // ficha del conductor al guardar, y por tanto ir de la persona a sus km.
  return [...uuids]
    .map(u => ({ uuid: String(u), nombre: (nombrePorUuid.get(u) || '').trim() || `#${String(u).slice(0, 8)}` }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function computarDia(dia) {
  const { start, end } = limitesDiaMadrid(dia);
  // La ventana cubre TODOS los tramos: desde las 00:00 del día hasta las 05:00 del
  // siguiente (fin del turno de noche), con el margen habitual a cada lado.
  const finNoche = limitesSegmento(dia, 'noche').end;
  const fromTs = start - MARGEN_SEG, tillTs = Math.max(end, finNoche) + MARGEN_SEG;
  // Los logs se piden con MUCHA más historia hacia atrás: son eventos de CAMBIO, así
  // que para saber en qué estado entra el coche a las 00:00 hay que ver el último
  // cambio anterior — que puede ser de la tarde previa. Sin esto, quien cierra la app
  // por la noche y rueda de madrugada salía como "espera" (trabajo normal).
  const logsDesde = start - MAX_HUECO_ESTADO - 3600;

  // Las tres lecturas de BOLT van EN SERIE a propósito: comprobarCompleto se apoya en
  // fetchAllPaginated.ultimoDiagnostico, que es un global compartido — en paralelo el
  // diagnóstico de una llamada pisa al de otra y el control de datos incompletos deja
  // de valer. Mapon sí puede ir a la vez (no toca ese global).
  const unidadesP = mapon.unidades();
  const ordenes = await boltOrdenesRango(fromTs, tillTs);
  const logs = await boltLogsRango(logsDesde, tillTs);
  const uuidPlaca = await boltVehiculos(fromTs, tillTs);
  const mapaUnidades = await unidadesP;

  // Sin padrón de Mapon no se puede calcular nada: abortar antes de tocar el Sheet,
  // porque guardar 0 filas borraría lo que ya hubiera de ese día.
  if (!mapaUnidades.size) throw new Error('Mapon no devolvió unidades: no se calcula el día para no borrar el histórico');
  if (!logs.length) throw new Error('BOLT no devolvió state logs: sin ellos todo saldría como "espera" (falso negativo)');

  // Índices por placa
  const ordenesPorPlaca = {};
  ordenes.forEach(o => { const p = normPlaca(o.vehicle_license_plate); if (p) (ordenesPorPlaca[p] = ordenesPorPlaca[p] || []).push(o); });
  // Se conserva el CONDUCTOR de cada log: un coche lo comparten día y noche y hay que
  // poder separar sus líneas temporales (ver estadoEn).
  const logsPorPlaca = {};
  logs.forEach(l => {
    const p = uuidPlaca[l.vehicle_uuid]; if (!p) return;
    (logsPorPlaca[p] = logsPorPlaca[p] || []).push({ t: l.created, state: l.state, driver: l.driver_uuid || '' });
  });

  // Km facturado (ride_distance) por placa Y TRAMO: el pedido cae en el tramo que
  // contenga su hora de creación, igual que los km.
  const ventanas = Object.fromEntries(SEGMENTOS.map(s => [s, limitesSegmento(dia, s)]));
  const billed = {};   // placa -> { seg: { km, viajes } }
  ordenes.forEach(o => {
    if (o.order_status !== 'finished' || o.ride_distance == null) return;
    const p = normPlaca(o.vehicle_license_plate); if (!p) return;
    const t = Number(o.order_created_timestamp);
    SEGMENTOS.forEach(s => {
      if (t < ventanas[s].start || t >= ventanas[s].end) return;
      const porSeg = billed[p] = billed[p] || {};
      const b = porSeg[s] = porSeg[s] || { km: 0, viajes: 0 };
      b.km += Number(o.ride_distance) / 1000; b.viajes++;
    });
  });

  // Nombre de cada conductor de BOLT (para decir QUIÉN usó el coche en cada tramo).
  // Sale de PostgreSQL, no del padrón en hoja: aquello fallaba en silencio —el
  // catch se lo tragaba— y el informe salía lleno de "#181f6feb" en vez de
  // nombres. Si esto falla, que falle el día entero y se vea.
  const nombrePorUuid = await repo.nombresBolt();

  // ── Qué matrículas se auditan: LAS QUE TUVIERON ACTIVIDAD EN BOLT ese día ──
  // Mapon tiene coches que no son de esta flota (otras plazas, bajas, reservas sin dar
  // de alta) y auditarlos ensucia los totales. La verdad la manda BOLT: si un coche
  // tuvo un state log o un pedido, es de la flota y se audita; si no, ni se consulta a
  // Mapon —lo que además ahorra una llamada por coche—.
  const placasBolt = new Set([...Object.keys(logsPorPlaca), ...Object.keys(ordenesPorPlaca)]);
  const unidadesAuditar = [...mapaUnidades.entries()].filter(([, info]) => placasBolt.has(normPlaca(info.matricula)));
  console.log(`🚗 [AUDITORÍA] ${dia}: ${placasBolt.size} matrículas con actividad en BOLT · ` +
    `${unidadesAuditar.length} localizadas en Mapon (de ${mapaUnidades.size})`);

  const filas = new Map();   // 'placa|seg' → fila
  await enParalelo(unidadesAuditar, CONC_MAPON, async ([unitId, info]) => {
    const placa = normPlaca(info.matricula);
    if (!placa) return;
    const { trips } = await mapon.leerRecorridoUnidad({ unitId, fromTs, tillTs });
    // EL ODÓMETRO DEL COCHE, del núcleo de Flota viva (ya ingerido, sin llamar a
    // la API otra vez). Es la fuente buena de km; el GPS queda de suplente.
    //
    // La decisión se toma UNA VEZ POR COCHE Y DÍA, no por tramo: si la mañana
    // fuera por odómetro y la noche por GPS, el día completo no sería la suma de
    // sus partes. Y con el MISMO umbral que Control, para que las dos pantallas
    // no puedan discrepar del mismo día.
    let odoDia = [];
    try {
      odoDia = await flotaRutas.odometroDeUnidad({ unitId, fromTs, tillTs });
    } catch (e) {
      console.error(`⚠️  [AUDITORÍA] odómetro de ${placa}: ${e.message}`);
    }
    const kmCanDia = odoDia.reduce((n, x) => n + x.metros, 0) / 1000;
    const kmGpsDia = trips.reduce((n, t) => n + (t.distancia || 0), 0) / 1000;
    const porCan = odoDia.length > 0 && kmCanDia >= flotaRutas.UMBRAL_CAN * kmGpsDia;
    const logsCoche = logsPorPlaca[placa] || [];
    const iv = construirIv(ordenesPorPlaca[placa] || [], logsCoche);
    const hh = s => Math.round(s / 360) / 10;   // segundos → horas con 1 decimal

    for (const seg of SEGMENTOS) {
      const { start: s0, end: s1 } = ventanas[seg];
      // Los que TOCAN el tramo, no solo los que empiezan en él: `atribuirRecorrido`
      // se queda con los puntos de dentro y parte el trayecto por el corte.
      const finDe = t => (t.puntos && t.puntos.length ? t.puntos[t.puntos.length - 1].t : t.inicioTs);
      const tripsSeg = trips.filter(t => t.inicioTs != null && t.inicioTs < s1 && finDe(t) >= s0);
      const b = (billed[placa] && billed[placa][seg]) || { km: 0, viajes: 0 };
      const conductores = conductoresEnVentana(logsCoche, s0, s1, nombrePorUuid);
      const odoSeg = porCan && odoDia.some(x => x.desde < s1 && x.hasta > s0);
      if (!tripsSeg.length && !odoSeg && !b.viajes && !conductores.length) continue;   // ni se movió ni hubo nadie

      const km = porCan
        ? atribuirOdometro(odoDia, iv, { desde: s0, hasta: s1 })
        : atribuirRecorrido(tripsSeg, iv, { desde: s0, hasta: s1 });
      const h = tiempoPorEstado(iv, s0, s1);
      const clave = `${placa}|${seg}`;
      const prev = filas.get(clave);
      if (prev) {   // misma matrícula en dos unidades Mapon: se acumulan los km
        prev.kmMapon = round1(prev.kmMapon + km.pasajero + km.ida + km.espera + km.descanso + km.fuera);
        prev.kmPasajero = round1(prev.kmPasajero + km.pasajero); prev.kmIda = round1(prev.kmIda + km.ida);
        prev.kmEspera = round1(prev.kmEspera + km.espera); prev.kmDescanso = round1(prev.kmDescanso + km.descanso);
        prev.kmFuera = round1(prev.kmFuera + km.fuera);
        continue;
      }
      filas.set(clave, {
        dia, turno: seg, placa, matricula: info.matricula || placa, vehiculo: info.vehiculo || '',
        kmMapon: round1(km.pasajero + km.ida + km.espera + km.descanso + km.fuera),
        kmPasajero: round1(km.pasajero), kmIda: round1(km.ida), kmEspera: round1(km.espera),
        kmDescanso: round1(km.descanso), kmFuera: round1(km.fuera),
        hPedido: hh(h.has_order), hEspera: hh(h.waiting_orders), hDescanso: hh(h.busy), hFuera: hh(h.inactive),
        kmBolt: round1(b.km), viajesBolt: b.viajes, conductores,
        // Con qué vara se midió: el odómetro del coche o la estimación del GPS.
        fuenteKm: porCan ? 'can' : 'gps'
      });
    }
  });

  const eventos = await leerFuelDia(dia);
  return { dia, filas: [...filas.values()], eventos };
}

/** Calcula y guarda UN día (lo que llama el cron con el día de ayer). */
async function procesarDia(dia) {
  const arranque = Date.now();
  const r = await computarDia(dia);
  const seg = Math.round((Date.now() - arranque) / 1000);
  const g = await repo.guardarDia(r, { segundos: seg });
  console.log(`📊 [AUDITORÍA] ${dia}: ${g.filas} líneas de ${new Set(r.filas.map(f => f.placa)).size} ` +
    `matrículas, ${g.eventos} repostajes (${seg}s)`);
  return { dia, filas: g.filas, eventos: g.eventos };
}

// ── Backfill por rango (en segundo plano; el panel sondea el progreso) ─────────

let _prog = { activo: false, total: 0, hechos: 0, dia: null, iniciado: null, fin: null, error: null, fallidos: [] };
const progreso = () => ({ ..._prog });

// Interruptor de emergencia: un backfill largo consume mucha cuota de Google y, si se
// desmadra, tumba TODO el ERP (el login también lee de Sheets). Sin esto la única
// forma de pararlo era reiniciar el servicio.
let _parar = false;
function detener() {
  if (!_prog.activo) return { activo: false, msg: 'No hay ningún procesado en marcha' };
  _parar = true;
  console.warn('🛑 [AUDITORÍA] parada solicitada: se detiene al acabar el día en curso');
  return { activo: true, msg: 'Se detendrá al terminar el día en curso' };
}

/**
 * Procesa días. Admite un rango {desde,hasta} o una LISTA explícita de días
 * ('aaaa-mm-dd'): los pendientes no tienen por qué ser contiguos, y pasando solo los
 * extremos se reprocesaban de balde todos los días buenos de en medio.
 * Un día que falle no aborta el resto: se anota y se sigue.
 */
async function procesarRango({ desde, hasta, dias: lista } = {}) {
  if (_prog.activo) throw new Error('Ya hay un procesado en marcha');
  let dias;
  if (Array.isArray(lista) && lista.length) {
    dias = [...new Set(lista.map(String).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    if (!dias.length) throw new Error('Ningún día válido en la lista');
    if (dias.length > MAX_DIAS) throw new Error(`Máximo ${MAX_DIAS} días por tanda (has pedido ${dias.length})`);
  } else {
    const { ini, fin } = resolverRango({ desde, hasta });
    dias = ejeDias(ini, fin);
  }
  _parar = false;
  _prog = { activo: true, total: dias.length, hechos: 0, dia: null, iniciado: ahora(), fin: null, error: null, fallidos: [] };
  try {
    // Día a día. Cuando esto vivía en una hoja había que agrupar en lotes porque
    // cada guardado reescribía el libro entero y agotaba la cuota de Google; en
    // PostgreSQL un día es una transacción y guardarlo cuesta lo mismo suelto que
    // acompañado. Ahora si el backfill se corta, lo calculado está guardado.
    for (const d of dias) {
      if (_parar) { _prog.error = 'Detenido a mano'; console.warn('🛑 [AUDITORÍA] backfill detenido'); break; }
      _prog.dia = d;
      try {
        await procesarDia(d);
      } catch (e) {
        _prog.fallidos.push(`${d}: ${e.message}`);
        console.error(`❌ [AUDITORÍA] ${d}:`, e.message);
        // Queda anotado que ese día se intentó y falló: así se distingue de uno
        // que nunca se ha calculado, que es una situación distinta.
        await repo.marcarFallo(d, e.message).catch(() => {});
      }
      _prog.hechos++;
    }
    if (_prog.fallidos.length) _prog.error = `${_prog.fallidos.length} día(s) sin procesar: ${_prog.fallidos.slice(0, 3).join(' · ')}`;
  } catch (e) {
    _prog.error = e.message;
    console.error('❌ [AUDITORÍA] backfill:', e.message);
  } finally {
    _prog.activo = false; _prog.fin = ahora();
  }
}

// ── Lectura para la vista (solo Sheet, sin tocar APIs) ────────────────────────

/**
 * Arma la tabla de un TRAMO concreto ('completo', 'dia' o 'noche'). Se llama una vez
 * por tramo, así la vista puede enseñar el turno de día, el de noche y el día natural
 * sin recalcular nada.
 */
function construirRespuesta(dias, filasKmRec, eventosRec, segmento = 'completo') {
  const set = new Set(dias);
  const porPlaca = new Map();
  filasKmRec.forEach(r => {
    if (!set.has(r.dia)) return;
    if ((r.turno || 'completo') !== segmento) return;
    let o = porPlaca.get(r.placa);
    if (!o) { o = { placa: r.placa, matricula: r.matricula, vehiculo: r.vehiculo, dias: {}, conductores: new Set(), fuentes: new Set() }; porPlaca.set(r.placa, o); }
    if (r.fuenteKm) o.fuentes.add(r.fuenteKm);
    (r.conductores || []).forEach(c => o.conductores.add(c));
    // Se ACUMULA: si el histórico trajera dos filas del mismo (día, matrícula),
    // sobrescribir haría desaparecer esos km sin ningún aviso.
    const prev = o.dias[r.dia];
    const nuevo = { mapon: r.kmMapon, pasajero: r.kmPasajero, ida: r.kmIda, espera: r.kmEspera,
      descanso: r.kmDescanso, fuera: r.kmFuera, bolt: r.kmBolt, viajes: r.viajesBolt,
      hPedido: r.hPedido, hEspera: r.hEspera, hDescanso: r.hDescanso, hFuera: r.hFuera };
    if (prev) { for (const k in nuevo) nuevo[k] = round1((prev[k] || 0) + (nuevo[k] || 0)); }
    nuevo.conductores = (r.conductores || []).slice();
    o.dias[r.dia] = nuevo;
    if (!o.matricula) o.matricula = r.matricula;
    if (!o.vehiculo && r.vehiculo) o.vehiculo = r.vehiculo;
  });
  const km = [...porPlaca.values()].map(o => {
    const a = { mapon: 0, pasajero: 0, ida: 0, espera: 0, descanso: 0, fuera: 0, bolt: 0, viajes: 0,
      hPedido: 0, hEspera: 0, hDescanso: 0, hFuera: 0 };
    Object.values(o.dias).forEach(d => { for (const k in a) a[k] += d[k] || 0; });
    const conductores = [...o.conductores].sort();
    const totalMapon = round1(a.mapon);
    // "No disponible" = rodó sin estar a disposición de BOLT (descanso + app cerrada).
    const noDisp = round1(a.descanso + a.fuera);
    return {
      placa: o.placa, matricula: o.matricula, vehiculo: o.vehiculo, dias: o.dias, conductores,
      totalMapon, totalPasajero: round1(a.pasajero), totalIda: round1(a.ida),
      totalEspera: round1(a.espera), totalDescanso: round1(a.descanso), totalFuera: round1(a.fuera),
      totalNoDisp: noDisp, totalBolt: round1(a.bolt), viajesBolt: a.viajes,
      hPedido: round1(a.hPedido), hEspera: round1(a.hEspera), hDescanso: round1(a.hDescanso), hFuera: round1(a.hFuera),
      pctNoDisp: totalMapon > 0 ? Math.round(noDisp / totalMapon * 100) : null,
      pctFuera: totalMapon > 0 ? Math.round(a.fuera / totalMapon * 100) : null,
      pctPasajero: totalMapon > 0 ? Math.round(a.pasajero / totalMapon * 100) : null,
      // CON QUÉ VARA. 'can' es el odómetro del coche; 'gps' es la estimación de
      // Mapon, que es lo único que hay cuando el equipo no lee el CAN. En un
      // rango de varios días puede haber de las dos ('mixta'): un equipo que
      // calla unos días y habla otros. Las filas viejas no lo llevan y se quedan
      // en null — se calcularon antes de haber odómetro.
      fuenteKm: o.fuentes.size > 1 ? 'mixta' : ([...o.fuentes][0] || null)
    };
  }).sort((x, y) => y.totalNoDisp - x.totalNoDisp);

  const eventos = eventosRec.filter(e => set.has(e.dia)).sort((a, b) => b.orden - a.orden);
  const rep = new Map();
  eventos.forEach(e => {
    if (e.tipo !== 'repostaje') return;
    const o = rep.get(e.placa) || { placa: e.placa, matricula: e.matricula, litros: 0, veces: 0 };
    o.litros += e.litros; o.veces++; rep.set(e.placa, o);
  });
  const ofensores = {
    // km rodados sin estar disponible (descanso + app cerrada)
    fuera: km.filter(k => k.totalNoDisp > 0).slice(0, 5).map(k => ({
      placa: k.placa, matricula: k.matricula, noDisp: k.totalNoDisp, descanso: k.totalDescanso,
      fuera: k.totalFuera, pct: k.pctNoDisp, mapon: k.totalMapon
    })),
    // horas marcado "ocupado" (descanso): caza al que se pone en pausa media jornada
    descanso: km.filter(k => k.hDescanso > 0).sort((a, b) => b.hDescanso - a.hDescanso).slice(0, 5)
      .map(k => ({ placa: k.placa, matricula: k.matricula, horas: k.hDescanso, km: k.totalDescanso })),
    repostaje: [...rep.values()].map(o => ({ ...o, litros: round1(o.litros) })).sort((a, b) => b.litros - a.litros).slice(0, 5)
  };
  return { dias, km, eventos, ofensores };
}

/**
 * Lee el rango del histórico. Ya no hay cola ni hoja: son tres consultas a
 * PostgreSQL que traen SOLO el rango pedido. Antes se leía el libro entero —los
 * cinco tramos de todos los días habidos— y se descartaba en memoria, así que
 * pedir una semana costaba exactamente lo mismo que pedir un año.
 */
async function cargarAuditoria({ desde, hasta } = {}) {
  const { ini, fin } = resolverRango({ desde, hasta });
  const dias = ejeDias(ini, fin);
  const d1 = dias[0], d2 = dias[dias.length - 1];

  const [filas, eventos, calculados] = await Promise.all([
    repo.consultar({ desde: d1, hasta: d2, tramo: '*' }),
    repo.repostajes({ desde: d1, hasta: d2 }),
    repo.dias({ desde: d1, hasta: d2 }),
  ]);

  // Se arma cada tramo por separado: el día natural (la vista de siempre) y los
  // turnos, para poder verlos juntos sin volver a consultar.
  const base = construirRespuesta(dias, filas, eventos, 'completo');
  const segmentos = Object.fromEntries(SEGMENTOS.map(s =>
    [s, s === 'completo' ? base.km : construirRespuesta(dias, filas, eventos, s).km]));

  // Pendiente es lo que no se ha calculado NUNCA o se intentó y falló. Un día
  // fallido no puede confundirse con uno que nadie ha pedido todavía: el
  // primero hay que reintentarlo, el segundo solo programarlo.
  const buenos = new Set(calculados.filter(c => c.ok).map(c => c.dia));
  const pendientes = dias.filter(d => !buenos.has(d));
  const fallidos = calculados.filter(c => !c.ok).map(c => ({ dia: c.dia, error: c.error }));

  return {
    ...base, segmentos, etiquetas: ETIQUETA_SEG,
    matriculasBolt: new Set(filas.map(r => r.placa)).size,
    desde: ini.toISOString(), hasta: fin.toISOString(),
    pendientes, fallidos, generado: ahora()
  };
}

module.exports = {
  cargarAuditoria, procesarDia, procesarRango, progreso, detener, hoyMadrid, diaMenos,
  // exportados para pruebas
  SEGMENTOS, ETIQUETA_SEG, limitesSegmento, tsDeHoraLocal, conductoresEnVentana,
  normPlaca, diaLocal, limitesDiaMadrid, offsetMadridSeg, mergeIv, enIntervalos,
  construirIv, estadoEn, bucketDe, atribuirRecorrido, atribuirOdometro, tiempoPorEstado, haversineKm, construirRespuesta,
  resolverRango, ejeDias, MAX_DIAS,
  // El ranking por conductor se sirve tal cual desde el repositorio.
  porConductor: (...a) => repo.porConductor(...a)
};
