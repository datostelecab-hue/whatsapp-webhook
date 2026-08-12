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
 *     sin pedido + BOLT online (waiting_orders/busy) → CRUISING (normal)
 *     sin pedido + BOLT offline (inactive)           → FUERA  ← km sospechoso
 *   "Fuera" es CONSERVADOR: solo cuenta cuando BOLT confirma que estaba offline;
 *   ante la duda cuenta como cruising (no acusa).
 *
 * ── Histórico ────────────────────────────────────────────────────────────────
 * Es pesado (una llamada Mapon por coche/día), así que NO se calcula en cada
 * consulta: lo puebla un cron (5am) día a día en el Sheet, y las consultas solo
 * LEEN. Backfill manual por rango con procesarRango().
 */

const { fetchRangoCompleto, CONFIG_BOLT } = require('./bolt');
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
const CAB_KM = ['dia', 'placa', 'matricula', 'vehiculo', 'km_mapon', 'km_pasajero', 'km_ida', 'km_cruising', 'km_fuera', 'km_bolt', 'viajes_bolt', 'actualizado'];
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
/** Límites unix [00:00, 23:59:59] del día local Madrid. */
function limitesDiaMadrid(dia) {
  const off = offsetMadridSeg(dia);
  const midUTC = Math.floor(new Date(dia + 'T00:00:00Z').getTime() / 1000);
  return { start: midUTC - off, end: midUTC - off + 86400 - 1 };
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
  return { pasajero: mergeIv(pasajero), ida: mergeIv(ida), logs: (logs || []).slice().sort((a, b) => a.t - b.t) };
}

/** ¿estaba BOLT OFFLINE (inactive) en el instante t? Sin log previo → false (no acusa). */
function offlineEn(t, logs) {
  if (!logs || !logs.length) return false;
  let lo = 0, hi = logs.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (logs[m].t <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
  return idx >= 0 && logs[idx].state === 'inactive';
}

function bucketDe(t, iv) {
  if (enIntervalos(t, iv.pasajero)) return 'pasajero';
  if (enIntervalos(t, iv.ida)) return 'ida';
  return offlineEn(t, iv.logs) ? 'fuera' : 'cruising';
}

/**
 * Reparte los km de los trayectos entre los 4 buckets. Cada tramo entre dos
 * puntos GPS va al estado de su punto de INICIO; luego se escala el trayecto para
 * que sume EXACTO la distancia que da Mapon (evita el subconteo de la línea recta).
 */
function atribuirRecorrido(trips, iv) {
  const km = { pasajero: 0, ida: 0, cruising: 0, fuera: 0 };
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

async function boltOrdenesRango(fromTs, tillTs) {
  let out = [];
  for (const f of CONFIG_BOLT.flotas) {
    out = out.concat(await fetchRangoCompleto('/fleetIntegration/v1/getFleetOrders',
      { company_ids: [f.id], company_id: f.id, time_range_filter_type: 'created' }, 'orders', fromTs, tillTs, 1000, `AUD ord ${f.id}`));
  }
  return out;
}
async function boltLogsRango(fromTs, tillTs) {
  let out = [];
  for (const f of CONFIG_BOLT.flotas) {
    out = out.concat(await fetchRangoCompleto('/fleetIntegration/v1/getFleetStateLogs',
      { company_id: f.id }, 'state_logs', fromTs, tillTs, 1000, `AUD log ${f.id}`));
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

async function computarDia(dia) {
  const { start, end } = limitesDiaMadrid(dia);
  const fromTs = start - MARGEN_SEG, tillTs = end + MARGEN_SEG;

  const [ordenes, logs, uuidPlaca, mapaUnidades] = await Promise.all([
    boltOrdenesRango(fromTs, tillTs),
    boltLogsRango(fromTs, tillTs),
    boltVehiculos(fromTs, tillTs),
    mapon.unidades()
  ]);

  // Índices por placa
  const ordenesPorPlaca = {};
  ordenes.forEach(o => { const p = normPlaca(o.vehicle_license_plate); if (p) (ordenesPorPlaca[p] = ordenesPorPlaca[p] || []).push(o); });
  const logsPorPlaca = {};
  logs.forEach(l => { const p = uuidPlaca[l.vehicle_uuid]; if (p) (logsPorPlaca[p] = logsPorPlaca[p] || []).push({ t: l.created, state: l.state }); });

  // Km facturado (ride_distance) del día, por placa — referencia
  const billed = {};
  ordenes.forEach(o => {
    if (o.order_status !== 'finished' || o.ride_distance == null) return;
    if (diaLocal(o.order_created_timestamp) !== dia) return;
    const p = normPlaca(o.vehicle_license_plate); if (!p) return;
    const b = billed[p] || { km: 0, viajes: 0 }; b.km += Number(o.ride_distance) / 1000; b.viajes++; billed[p] = b;
  });

  const filas = [];
  await enParalelo([...mapaUnidades.entries()], CONC_MAPON, async ([unitId, info]) => {
    const placa = normPlaca(info.matricula);
    if (!placa) return;
    const { trips } = await mapon.leerRecorridoUnidad({ unitId, fromTs, tillTs });
    const tripsDia = trips.filter(t => t.inicioTs != null && diaLocal(t.inicioTs) === dia);
    if (!tripsDia.length && !billed[placa]) return;   // ese coche no se movió ni facturó ese día
    const iv = construirIv(ordenesPorPlaca[placa] || [], logsPorPlaca[placa] || []);
    const km = atribuirRecorrido(tripsDia, iv);
    const b = billed[placa] || { km: 0, viajes: 0 };
    filas.push({
      dia, placa, matricula: info.matricula || placa, vehiculo: info.vehiculo || '',
      kmMapon: round1(km.pasajero + km.ida + km.cruising + km.fuera),
      kmPasajero: round1(km.pasajero), kmIda: round1(km.ida), kmCruising: round1(km.cruising), kmFuera: round1(km.fuera),
      kmBolt: round1(b.km), viajesBolt: b.viajes
    });
  });

  const eventos = await leerFuelDia(dia);
  return { dia, filas, eventos };
}

// ── Serialización / Sheet ─────────────────────────────────────────────────────

const filaKmASheet = o => [o.dia, o.placa, o.matricula, o.vehiculo, o.kmMapon || '', o.kmPasajero || '', o.kmIda || '', o.kmCruising || '', o.kmFuera || '', o.kmBolt || '', o.viajesBolt || '', ahora()];
function leerFilasKm(valores) {
  return (valores || []).slice(1).filter(r => r[0]).map(r => ({
    dia: String(r[0]), placa: String(r[1] || ''), matricula: String(r[2] || ''), vehiculo: String(r[3] || ''),
    kmMapon: num(r[4]), kmPasajero: num(r[5]), kmIda: num(r[6]), kmCruising: num(r[7]), kmFuera: num(r[8]),
    kmBolt: num(r[9]), viajesBolt: Math.round(num(r[10]))
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
  let [a, b, c] = await sheets.readMany(ID_AUDITORIA, [`${TAB_KM}!A1:L1`, `${TAB_FUEL}!A1:N1`, `${TAB_DIAS}!A1:B1`]);
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
async function reescribir(tab, rango, values) {
  await sheets.clearSheet(ID_AUDITORIA, rango);
  if (values.length) await sheets.writeSheetRaw(ID_AUDITORIA, `${tab}!A2`, values);
}

// Un guardado a la vez (el histórico se reescribe entero).
let _cola = Promise.resolve();
function enCola(fn) { const r = _cola.then(fn, fn); _cola = r.catch(() => {}); return r; }

async function guardarDias(resultados) {
  if (!resultados.length) return;
  return enCola(async () => {
    await ensureTabs();
    const dias = new Set(resultados.map(r => r.dia));
    const [valKm, valFuel, valDias] = await sheets.readMany(ID_AUDITORIA, [`${TAB_KM}!A:L`, `${TAB_FUEL}!A:N`, `${TAB_DIAS}!A:B`]);
    let filasKm = leerFilasKm(valKm).filter(r => !dias.has(r.dia));
    let eventos = leerEventos(valFuel).filter(r => !dias.has(r.dia));
    resultados.forEach(r => { filasKm = filasKm.concat(r.filas); eventos = eventos.concat(r.eventos); });
    await reescribir(TAB_KM, `${TAB_KM}!A2:L`, filasKm.map(filaKmASheet));
    await reescribir(TAB_FUEL, `${TAB_FUEL}!A2:N`, eventos.map(eventoASheet));
    const cong = new Set((valDias || []).slice(1).map(r => String(r[0])));
    const nuevos = [...dias].filter(d => !cong.has(d));
    if (nuevos.length) await sheets.appendRows(ID_AUDITORIA, `${TAB_DIAS}!A:B`, nuevos.map(d => [d, ahora()]));
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

let _prog = { activo: false, total: 0, hechos: 0, dia: null, iniciado: null, fin: null, error: null };
const progreso = () => ({ ..._prog });

async function procesarRango({ desde, hasta } = {}) {
  if (_prog.activo) throw new Error('Ya hay un procesado en marcha');
  const { ini, fin } = resolverRango({ desde, hasta });
  const dias = ejeDias(ini, fin);
  _prog = { activo: true, total: dias.length, hechos: 0, dia: null, iniciado: ahora(), fin: null, error: null };
  try {
    for (const d of dias) {
      _prog.dia = d;
      await procesarDia(d);   // guarda día a día → resiliente si se corta
      _prog.hechos++;
    }
  } catch (e) {
    _prog.error = e.message;
    console.error('❌ [AUDITORÍA] backfill:', e.message);
  } finally {
    _prog.activo = false; _prog.fin = ahora();
  }
}

// ── Lectura para la vista (solo Sheet, sin tocar APIs) ────────────────────────

function construirRespuesta(dias, filasKmRec, eventosRec) {
  const set = new Set(dias);
  const porPlaca = new Map();
  filasKmRec.forEach(r => {
    if (!set.has(r.dia)) return;
    let o = porPlaca.get(r.placa);
    if (!o) { o = { placa: r.placa, matricula: r.matricula, vehiculo: r.vehiculo, dias: {} }; porPlaca.set(r.placa, o); }
    o.dias[r.dia] = { mapon: r.kmMapon, pasajero: r.kmPasajero, ida: r.kmIda, cruising: r.kmCruising, fuera: r.kmFuera, bolt: r.kmBolt, viajes: r.viajesBolt };
    if (!o.matricula) o.matricula = r.matricula;
    if (!o.vehiculo && r.vehiculo) o.vehiculo = r.vehiculo;
  });
  const km = [...porPlaca.values()].map(o => {
    const a = { mapon: 0, pasajero: 0, ida: 0, cruising: 0, fuera: 0, bolt: 0, viajes: 0 };
    Object.values(o.dias).forEach(d => { for (const k in a) a[k] += d[k] || 0; });
    const totalMapon = round1(a.mapon);
    return {
      placa: o.placa, matricula: o.matricula, vehiculo: o.vehiculo, dias: o.dias,
      totalMapon, totalPasajero: round1(a.pasajero), totalIda: round1(a.ida),
      totalCruising: round1(a.cruising), totalFuera: round1(a.fuera), totalBolt: round1(a.bolt), viajesBolt: a.viajes,
      pctFuera: totalMapon > 0 ? Math.round(a.fuera / totalMapon * 100) : null,
      pctPasajero: totalMapon > 0 ? Math.round(a.pasajero / totalMapon * 100) : null
    };
  }).sort((x, y) => y.totalFuera - x.totalFuera);

  const eventos = eventosRec.filter(e => set.has(e.dia)).sort((a, b) => b.orden - a.orden);
  const rep = new Map();
  eventos.forEach(e => {
    if (e.tipo !== 'repostaje') return;
    const o = rep.get(e.placa) || { placa: e.placa, matricula: e.matricula, litros: 0, veces: 0 };
    o.litros += e.litros; o.veces++; rep.set(e.placa, o);
  });
  const ofensores = {
    fuera: km.filter(k => k.totalFuera > 0).slice(0, 5)
      .map(k => ({ placa: k.placa, matricula: k.matricula, fuera: k.totalFuera, pct: k.pctFuera, mapon: k.totalMapon })),
    repostaje: [...rep.values()].map(o => ({ ...o, litros: round1(o.litros) })).sort((a, b) => b.litros - a.litros).slice(0, 5)
  };
  return { dias, km, eventos, ofensores };
}

async function cargarAuditoria({ desde, hasta } = {}) {
  const { ini, fin } = resolverRango({ desde, hasta });
  const dias = ejeDias(ini, fin);
  await ensureTabs();
  const [valKm, valFuel, valDias] = await sheets.readMany(ID_AUDITORIA, [`${TAB_KM}!A:L`, `${TAB_FUEL}!A:N`, `${TAB_DIAS}!A:B`]);
  const procesados = new Set((valDias || []).slice(1).map(r => String(r[0])).filter(Boolean));
  const resp = construirRespuesta(dias, leerFilasKm(valKm), leerEventos(valFuel));
  const pendientes = dias.filter(d => !procesados.has(d));
  return { ...resp, desde: ini.toISOString(), hasta: fin.toISOString(), pendientes, generado: ahora() };
}

module.exports = {
  cargarAuditoria, procesarDia, procesarRango, progreso, hoyMadrid, diaMenos,
  // exportados para pruebas
  normPlaca, diaLocal, limitesDiaMadrid, offsetMadridSeg, mergeIv, enIntervalos,
  construirIv, offlineEn, bucketDe, atribuirRecorrido, haversineKm, construirRespuesta,
  leerFilasKm, leerEventos, resolverRango, ejeDias, MAX_DIAS
};
