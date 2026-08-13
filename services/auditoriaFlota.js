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

const { fetchRangoCompleto, fetchAllPaginated, CONFIG_BOLT } = require('./bolt');
const { leerPadron } = require('./conductoresBolt');
const mapon = require('./mapon');
const sheets = require('./sheets');

const ZONA = 'Europe/Madrid';
const MAX_DIAS = 31;
const CONC_MAPON = 3;         // llamadas Mapon en paralelo (deja hueco bajo el tope de 5)
const MARGEN_SEG = 4 * 3600;  // margen para pedidos/trayectos que cruzan la medianoche

const ID_AUDITORIA = process.env.ID_AUDITORIA || '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const TAB_KM = 'AUDITORIA_KM';
const TAB_FUEL = 'AUDITORIA_REPOSTAJES';
const TAB_DIAS = 'AUDITORIA_DIAS';
const CAB_KM = ['dia', 'turno', 'placa', 'matricula', 'vehiculo', 'km_mapon', 'km_pasajero', 'km_ida', 'km_espera', 'km_descanso', 'km_fuera',
  'h_pedido', 'h_espera', 'h_descanso', 'h_fuera', 'km_bolt', 'viajes_bolt', 'conductores', 'actualizado'];
const ANCHO_KM = 19;      // columnas de TAB_KM (A:S)
const CAB_FUEL = ['dia', 'hora', 'orden', 'placa', 'matricula', 'vehiculo', 'tipo', 'litros', 'nivel_antes', 'lat', 'lng', 'direccion', 'fuente', 'actualizado'];
const CAB_DIAS = ['dia', 'actualizado'];

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
const HORA_TURNO_DIA = Number(process.env.AUDITORIA_HORA_DIA || 5);
const HORA_TURNO_NOCHE = Number(process.env.AUDITORIA_HORA_NOCHE || 17);
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
function atribuirRecorrido(trips, iv) {
  const km = { pasajero: 0, ida: 0, espera: 0, descanso: 0, fuera: 0 };
  trips.forEach(trip => {
    const pts = trip.puntos || [];
    const distKm = (trip.distancia || 0) / 1000;
    if (pts.length < 2) {
      const t = trip.inicioTs != null ? trip.inicioTs : (pts[0] && pts[0].t);
      if (t != null && distKm) km[bucketDe(t, iv)] += distKm;
      return;
    }
    const seg = [];
    let sumRaw = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = haversineKm(pts[i - 1], pts[i]);
      seg.push([d, bucketDe(pts[i - 1].t, iv)]);
      sumRaw += d;
    }
    const escala = sumRaw > 0 ? distKm / sumRaw : 0;
    seg.forEach(([d, b]) => { km[b] += d * escala; });
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
  return [...uuids].map(u => (nombrePorUuid.get(u) || '').trim() || `#${String(u).slice(0, 8)}`).sort();
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
  const padron = await leerPadron().catch(() => ({ db: new Map() }));
  const nombrePorUuid = new Map();
  (padron.db || new Map()).forEach((d, uuid) => nombrePorUuid.set(uuid, (d.nombre || '').trim()));

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
    const logsCoche = logsPorPlaca[placa] || [];
    const iv = construirIv(ordenesPorPlaca[placa] || [], logsCoche);
    const hh = s => Math.round(s / 360) / 10;   // segundos → horas con 1 decimal

    for (const seg of SEGMENTOS) {
      const { start: s0, end: s1 } = ventanas[seg];
      // Un trayecto cuenta entero en el tramo donde EMPIEZA (mismo criterio que el día).
      const tripsSeg = trips.filter(t => t.inicioTs != null && t.inicioTs >= s0 && t.inicioTs < s1);
      const b = (billed[placa] && billed[placa][seg]) || { km: 0, viajes: 0 };
      const conductores = conductoresEnVentana(logsCoche, s0, s1, nombrePorUuid);
      if (!tripsSeg.length && !b.viajes && !conductores.length) continue;   // ni se movió ni hubo nadie

      const km = atribuirRecorrido(tripsSeg, iv);
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
        kmBolt: round1(b.km), viajesBolt: b.viajes, conductores
      });
    }
  });

  const eventos = await leerFuelDia(dia);
  return { dia, filas: [...filas.values()], eventos };
}

// ── Serialización / Sheet ─────────────────────────────────────────────────────

const filaKmASheet = o => [o.dia, o.turno || 'completo', o.placa, o.matricula, o.vehiculo,
  o.kmMapon || '', o.kmPasajero || '', o.kmIda || '', o.kmEspera || '', o.kmDescanso || '', o.kmFuera || '',
  o.hPedido || '', o.hEspera || '', o.hDescanso || '', o.hFuera || '', o.kmBolt || '', o.viajesBolt || '',
  (o.conductores || []).join(' · '), ahora()];
function leerFilasKm(valores) {
  return (valores || []).slice(1).filter(r => r[0]).map(r => ({
    dia: String(r[0]), turno: String(r[1] || 'completo'), placa: String(r[2] || ''),
    matricula: String(r[3] || ''), vehiculo: String(r[4] || ''),
    kmMapon: num(r[5]), kmPasajero: num(r[6]), kmIda: num(r[7]), kmEspera: num(r[8]), kmDescanso: num(r[9]), kmFuera: num(r[10]),
    hPedido: num(r[11]), hEspera: num(r[12]), hDescanso: num(r[13]), hFuera: num(r[14]),
    kmBolt: num(r[15]), viajesBolt: Math.round(num(r[16])),
    conductores: String(r[17] || '').split('·').map(s => s.trim()).filter(Boolean)
  }));
}
const eventoASheet = e => [e.dia, e.hora, e.orden, e.placa, e.matricula, e.vehiculo, e.tipo, e.litros,
  e.nivelAntes == null ? '' : e.nivelAntes, e.lat == null ? '' : e.lat, e.lng == null ? '' : e.lng, e.direccion || '', e.fuente, ahora()];
function leerEventos(valores) {
  return (valores || []).slice(1).filter(r => r[0]).map(r => ({
    dia: String(r[0]), hora: String(r[1] || ''), orden: Number(r[2]) || 0, placa: String(r[3] || ''),
    matricula: String(r[4] || ''), vehiculo: String(r[5] || ''), tipo: String(r[6] || ''),
    litros: num(r[7]), nivelAntes: r[8] === '' || r[8] == null ? null : num(r[8]),
    lat: r[9] === '' || r[9] == null ? null : num(r[9]), lng: r[10] === '' || r[10] == null ? null : num(r[10]),
    direccion: String(r[11] || ''), fuente: String(r[12] || '')
  }));
}

async function ensureTabs() {
  await sheets.ensureSheet(ID_AUDITORIA, TAB_KM);
  await sheets.ensureSheet(ID_AUDITORIA, TAB_FUEL);
  await sheets.ensureSheet(ID_AUDITORIA, TAB_DIAS);
  let [a, b, c] = await sheets.readMany(ID_AUDITORIA, [`${TAB_KM}!A1:S1`, `${TAB_FUEL}!A1:N1`, `${TAB_DIAS}!A1:B1`]);
  // Migración: si la cabecera de KM no cuadra (esquema viejo), se rehace la tabla
  // y se vacía el control de días para reconstruir con el esquema nuevo.
  const hdr = (a[0] || []).map(String);
  if (hdr.length && hdr.join('|') !== CAB_KM.join('|')) {
    await sheets.clearSheet(ID_AUDITORIA, `${TAB_KM}!A:Z`);
    await sheets.clearSheet(ID_AUDITORIA, `${TAB_DIAS}!A:B`);
    a = []; c = [];
    console.log('♻️  [AUDITORÍA] esquema KM actualizado: el histórico se reconstruirá');
  }
  const tareas = [];
  if (!a.length) tareas.push({ range: `${TAB_KM}!A1`, values: [CAB_KM] });
  if (!b.length) tareas.push({ range: `${TAB_FUEL}!A1`, values: [CAB_FUEL] });
  if (!c.length) tareas.push({ range: `${TAB_DIAS}!A1`, values: [CAB_DIAS] });
  if (tareas.length) await sheets.writeMany(ID_AUDITORIA, tareas);
}
/**
 * Reescribe una tabla ENTERA sin dejarla nunca vacía a medias: primero se amplía la
 * rejilla (values.update no la agranda: pasadas las 1000 filas por defecto fallaba
 * DESPUÉS del borrado y se perdía todo el histórico), luego se escriben los datos
 * nuevos y solo al final se limpia el sobrante. Así un fallo a mitad deja datos
 * viejos o nuevos, pero nunca la hoja en blanco.
 */
async function reescribir(tab, values, anchoCols, filasPrevias) {
  const necesarias = values.length + 1;
  await sheets.ensureGrid(ID_AUDITORIA, tab, necesarias + 200, anchoCols);
  if (values.length) await sheets.writeSheetRaw(ID_AUDITORIA, `${tab}!A2`, values);
  const sobra = (filasPrevias || 0) - values.length;
  if (sobra > 0) {
    const finCol = String.fromCharCode(64 + anchoCols);
    await sheets.clearSheet(ID_AUDITORIA, `${tab}!A${necesarias + 1}:${finCol}${necesarias + sobra}`);
  }
}

// Un guardado a la vez (el histórico se reescribe entero).
let _cola = Promise.resolve();
function enCola(fn) { const r = _cola.then(fn, fn); _cola = r.catch(() => {}); return r; }

async function guardarDias(resultados) {
  if (!resultados.length) return;
  return enCola(async () => {
    await ensureTabs();
    const dias = new Set(resultados.map(r => r.dia));
    const [valKm, valFuel, valDias] = await sheets.readMany(ID_AUDITORIA, [`${TAB_KM}!A:S`, `${TAB_FUEL}!A:N`, `${TAB_DIAS}!A:B`]);
    const previasKm = Math.max(0, (valKm || []).length - 1), previasFuel = Math.max(0, (valFuel || []).length - 1);
    let filasKm = leerFilasKm(valKm).filter(r => !dias.has(r.dia));
    let eventos = leerEventos(valFuel).filter(r => !dias.has(r.dia));
    resultados.forEach(r => { filasKm = filasKm.concat(r.filas); eventos = eventos.concat(r.eventos); });
    await reescribir(TAB_KM, filasKm.map(filaKmASheet), ANCHO_KM, previasKm);
    await reescribir(TAB_FUEL, eventos.map(eventoASheet), 14, previasFuel);
    // El control de días se escribe en RAW: con USER_ENTERED, Sheets convertía
    // 'aaaa-mm-dd' en fecha y al releerlo ('11/08/2026') no casaba nunca, así que
    // TODOS los días salían siempre como pendientes.
    const cong = new Set((valDias || []).slice(1).map(r => String(r[0]).trim()).filter(Boolean));
    const previasDias = cong.size;
    dias.forEach(d => cong.add(d));
    if (cong.size !== previasDias) {
      await reescribir(TAB_DIAS, [...cong].sort().map(d => [d, ahora()]), 2, previasDias);
    }
  });
}

/** Calcula y guarda UN día (lo que llama el cron con el día de ayer). */
async function procesarDia(dia) {
  const r = await computarDia(dia);
  await guardarDias([r]);
  console.log(`📊 [AUDITORÍA] ${dia}: ${r.filas.length} matrículas, ${r.eventos.length} repostajes`);
  return { dia, filas: r.filas.length, eventos: r.eventos.length };
}

// ── Backfill por rango (en segundo plano; el panel sondea el progreso) ─────────

let _prog = { activo: false, total: 0, hechos: 0, dia: null, iniciado: null, fin: null, error: null, fallidos: [] };
const progreso = () => ({ ..._prog });

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
  _prog = { activo: true, total: dias.length, hechos: 0, dia: null, iniciado: ahora(), fin: null, error: null, fallidos: [] };
  try {
    for (const d of dias) {
      _prog.dia = d;
      try {
        await procesarDia(d);   // guarda día a día → resiliente si se corta
      } catch (e) {
        _prog.fallidos.push(`${d}: ${e.message}`);
        console.error(`❌ [AUDITORÍA] ${d}:`, e.message);
      }
      _prog.hechos++;
    }
    if (_prog.fallidos.length) _prog.error = `${_prog.fallidos.length} día(s) sin procesar: ${_prog.fallidos.slice(0, 3).join(' · ')}`;
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
    if (!o) { o = { placa: r.placa, matricula: r.matricula, vehiculo: r.vehiculo, dias: {}, conductores: new Set() }; porPlaca.set(r.placa, o); }
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
      pctPasajero: totalMapon > 0 ? Math.round(a.pasajero / totalMapon * 100) : null
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
 * Lee el rango del histórico. Va por la MISMA cola que los guardados: si no, una
 * consulta que caiga en mitad de una reescritura vería la tabla a medias y pintaría
 * una auditoría vacía (que se lee como "aquí no ha rodado nadie por fuera").
 */
function cargarAuditoria({ desde, hasta } = {}) {
  const { ini, fin } = resolverRango({ desde, hasta });   // valida antes de encolar
  return enCola(async () => {
    const dias = ejeDias(ini, fin);
    await ensureTabs();
    const [valKm, valFuel, valDias] = await sheets.readMany(ID_AUDITORIA, [`${TAB_KM}!A:S`, `${TAB_FUEL}!A:N`, `${TAB_DIAS}!A:B`]);
    const procesados = new Set((valDias || []).slice(1).map(r => String(r[0]).trim()).filter(Boolean));
    const filas = leerFilasKm(valKm), eventos = leerEventos(valFuel);
    // Se arma cada tramo por separado: el día natural (la vista de siempre) y los dos
    // turnos, para poder verlos juntos sin volver a consultar.
    const base = construirRespuesta(dias, filas, eventos, 'completo');
    const segmentos = Object.fromEntries(SEGMENTOS.map(s =>
      [s, s === 'completo' ? base.km : construirRespuesta(dias, filas, eventos, s).km]));
    const pendientes = dias.filter(d => !procesados.has(d));
    // Todo lo guardado ya es de matrículas CON ACTIVIDAD EN BOLT (se filtran al
    // calcular el día), así que no hace falta ningún filtro adicional aquí.
    const enRango = new Set(dias);
    const matriculas = new Set(filas.filter(r => enRango.has(r.dia)).map(r => r.placa));
    return {
      ...base, segmentos, etiquetas: ETIQUETA_SEG,
      matriculasBolt: matriculas.size,
      desde: ini.toISOString(), hasta: fin.toISOString(), pendientes, generado: ahora()
    };
  });
}

module.exports = {
  cargarAuditoria, procesarDia, procesarRango, progreso, hoyMadrid, diaMenos,
  // exportados para pruebas
  SEGMENTOS, ETIQUETA_SEG, limitesSegmento, tsDeHoraLocal, conductoresEnVentana,
  normPlaca, diaLocal, limitesDiaMadrid, offsetMadridSeg, mergeIv, enIntervalos,
  construirIv, estadoEn, bucketDe, atribuirRecorrido, tiempoPorEstado, haversineKm, construirRespuesta,
  leerFilasKm, leerEventos, resolverRango, ejeDias, MAX_DIAS
};
