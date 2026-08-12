/**
 * Auditoría de flota — KM (Mapon vs BOLT) y repostajes, con histórico en Google Sheet.
 *
 * ── Sentido de los KM ────────────────────────────────────────────────────────
 * Mapon da los KM TOTALES que rueda el coche (GPS). BOLT solo los KM CON PASAJERO
 * (ride_distance de cada pedido 'finished'; null en cancelados). Por eso Mapon ≥ BOLT
 * y la resta ≈ kilómetros en vacío / fuera de app (a pickup, entre viajes, uso privado
 * u otra plataforma): es la métrica de control.
 *
 * ── Histórico incremental ────────────────────────────────────────────────────
 * Cada consulta se sirve del Sheet. Solo se vuelven a pedir a las APIs los días de HOY
 * y AYER (los datos aún se asientan) y los días del rango que nunca se habían traído
 * (backfill puntual). Los días ya cerrados quedan CONGELADOS en la hoja y no se vuelven
 * a consultar, así que un rango antiguo no toca ninguna API. Los días se acumulan.
 */

const { fetchRangoCompleto, CONFIG_BOLT } = require('./bolt');
const { parseFecha, leerKmPorDia, leerCombustible } = require('./mapon');
const sheets = require('./sheets');

const ZONA = 'Europe/Madrid';
const MAX_DIAS = 31;

// Base de datos: por defecto el Sheet de gestión; se puede aislar en otro con ID_AUDITORIA.
const ID_AUDITORIA = process.env.ID_AUDITORIA || '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const TAB_KM = 'AUDITORIA_KM';
const TAB_FUEL = 'AUDITORIA_REPOSTAJES';
const TAB_DIAS = 'AUDITORIA_DIAS';   // control: qué días ya se trajeron (para congelarlos)
const CAB_KM = ['dia', 'placa', 'matricula', 'vehiculo', 'km_mapon', 'km_bolt', 'viajes_bolt', 'actualizado'];
const CAB_FUEL = ['dia', 'hora', 'orden', 'placa', 'matricula', 'vehiculo', 'tipo', 'litros', 'nivel_antes', 'lat', 'lng', 'direccion', 'fuente', 'actualizado'];
const CAB_DIAS = ['dia', 'actualizado'];

// ── Utilidades ───────────────────────────────────────────────────────────────

/** Matrícula a comparable: sin espacios ni guiones y en mayúsculas ('1212-MJY' → '1212MJY'). */
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
/** 'aaaa-mm-dd' menos n días (aritmética en UTC para no depender del huso del server). */
function diaMenos(dia, n) {
  const [y, m, d] = dia.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
/** 'dd/mm/aaaa' → 'aaaa-mm-dd'. */
const fechaEUaISO = f => { const [d, m, y] = String(f).split('/'); return `${y}-${m}-${d}`; };
/** 'aaaa-mm-dd' → 'dd/mm/aaaa' (lo que esperan los lectores de mapon). */
const isoAddmm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/** Mismo criterio de rango que services/mapon.js (día final completo, tope 31 días). */
function resolverRango({ desde, hasta } = {}, porDefectoDias = 7) {
  const fin = (desde || hasta) ? (parseFecha(hasta) || new Date()) : new Date();
  if (hasta) fin.setHours(23, 59, 59, 0);
  let ini = parseFecha(desde);
  if (!ini) { ini = new Date(fin); ini.setDate(ini.getDate() - porDefectoDias); }
  ini.setHours(0, 0, 0, 0);
  if (ini > fin) throw new Error('La fecha inicial es posterior a la final');
  const dias = Math.round((fin - ini) / 86400000);
  if (dias > MAX_DIAS) throw new Error(`El rango máximo es ${MAX_DIAS} días (has pedido ${dias})`);
  return { ini, fin };
}

/** Eje de días 'aaaa-mm-dd' (local) del rango. */
function ejeDias(ini, fin) {
  const dias = [];
  for (let d = new Date(ini); d <= fin; d.setDate(d.getDate() + 1)) {
    dias.push(diaLocal(Math.floor(d.getTime() / 1000)));
  }
  return dias;
}

/**
 * Reparte los días del rango entre los que hay que volver a pedir a las APIs y los
 * que se leen del Sheet. Se re-piden HOY y AYER siempre (datos aún cambiantes) y los
 * días que nunca se trajeron (no están en el control). El resto, del Sheet.
 */
function clasificarDias(dias, congelados, hoy) {
  const ayer = diaMenos(hoy, 1);
  const refetch = [], usarSheet = [];
  dias.forEach(d => {
    if (d >= ayer || !congelados.has(d)) refetch.push(d);
    else usarSheet.push(d);
  });
  return { refetch, usarSheet, ayer };
}

// ── Lado BOLT: KM facturados por matrícula y día ──────────────────────────────

/**
 * KM con pasajero por matrícula y día (viajes 'finished' de todas las flotas).
 * Devuelve filas { placa, matricula, km:{dia}, viajes:{dia}, total, viajesTotal }.
 */
async function leerKmBolt({ desde, hasta } = {}) {
  const { ini, fin } = resolverRango({ desde, hasta });
  const startTs = Math.floor(ini.getTime() / 1000);
  const endTs = Math.floor(fin.getTime() / 1000);
  const dias = ejeDias(ini, fin);

  const porPlaca = new Map();   // normPlaca -> { matricula, km:Map, viajesDia:Map }

  for (const flota of CONFIG_BOLT.flotas) {
    const ordenes = await fetchRangoCompleto(
      '/fleetIntegration/v1/getFleetOrders',
      { company_ids: [flota.id], company_id: flota.id, time_range_filter_type: 'created' },
      'orders', startTs, endTs, 1000, `KM ${flota.id}`
    );
    ordenes.forEach(o => {
      if (o.order_status !== 'finished' || o.ride_distance == null) return;
      const placa = normPlaca(o.vehicle_license_plate);
      if (!placa) return;
      const dia = diaLocal(o.order_created_timestamp);
      if (!dia) return;
      const reg = porPlaca.get(placa) || { matricula: (o.vehicle_license_plate || '').trim(), km: new Map(), viajesDia: new Map() };
      reg.km.set(dia, (reg.km.get(dia) || 0) + Number(o.ride_distance) / 1000);
      reg.viajesDia.set(dia, (reg.viajesDia.get(dia) || 0) + 1);
      porPlaca.set(placa, reg);
    });
  }

  const filas = [...porPlaca.entries()].map(([placa, reg]) => {
    const km = {}, viajes = {};
    let total = 0, viajesTotal = 0;
    reg.km.forEach((v, dia) => { const k = round1(v); km[dia] = k; total += k; });
    reg.viajesDia.forEach((n, dia) => { viajes[dia] = n; viajesTotal += n; });
    return { placa, matricula: reg.matricula, km, viajes, total: round1(total), viajesTotal };
  }).sort((a, b) => a.matricula.localeCompare(b.matricula));

  return { dias, filas, desde: ini.toISOString(), hasta: fin.toISOString() };
}

// ── Cruce Mapon + BOLT en registros por (día, placa) ──────────────────────────

/** Combina los KM de Mapon y BOLT de los días indicados en registros { dia, placa, ... }. */
function construirFilasKm(diasRefetch, mapon, bolt) {
  const set = new Set(diasRefetch);
  const rec = new Map();   // dia|placa -> registro
  const get = (dia, placa, matricula, vehiculo) => {
    const k = dia + '|' + placa;
    let o = rec.get(k);
    if (!o) { o = { dia, placa, matricula: matricula || placa, vehiculo: vehiculo || '', kmMapon: 0, kmBolt: 0, viajesBolt: 0 }; rec.set(k, o); }
    else { if (!o.matricula) o.matricula = matricula; if (!o.vehiculo && vehiculo) o.vehiculo = vehiculo; }
    return o;
  };
  (mapon.filas || []).forEach(f => {
    const placa = normPlaca(f.matricula);
    if (!placa) return;
    Object.entries(f.km || {}).forEach(([dia, km]) => {
      if (!set.has(dia) || !km) return;
      get(dia, placa, f.matricula, f.vehiculo).kmMapon = round1(km);
    });
  });
  (bolt.filas || []).forEach(f => {
    Object.entries(f.km || {}).forEach(([dia, km]) => {
      if (!set.has(dia) || !km) return;
      const o = get(dia, f.placa, f.matricula, '');
      o.kmBolt = round1(km);
      o.viajesBolt = (f.viajes && f.viajes[dia]) || 0;
    });
  });
  return [...rec.values()];
}

// ── Serialización con el Sheet ────────────────────────────────────────────────

const filaKmASheet = o => [o.dia, o.placa, o.matricula, o.vehiculo, o.kmMapon || '', o.kmBolt || '', o.viajesBolt || '', ahora()];
function leerFilasKm(valores) {
  return (valores || []).slice(1).filter(r => r[0]).map(r => ({
    dia: String(r[0]), placa: String(r[1] || ''), matricula: String(r[2] || ''), vehiculo: String(r[3] || ''),
    kmMapon: num(r[4]), kmBolt: num(r[5]), viajesBolt: Math.round(num(r[6]))
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

// ── Respuesta para el rango pedido (a partir de los registros ya en memoria) ──

function construirRespuesta(dias, filasKmRec, eventosRec) {
  const set = new Set(dias);
  const porPlaca = new Map();
  filasKmRec.forEach(r => {
    if (!set.has(r.dia)) return;
    let o = porPlaca.get(r.placa);
    if (!o) { o = { placa: r.placa, matricula: r.matricula, vehiculo: r.vehiculo, mapon: {}, bolt: {}, viajes: {} }; porPlaca.set(r.placa, o); }
    if (r.kmMapon) o.mapon[r.dia] = r.kmMapon;
    if (r.kmBolt) o.bolt[r.dia] = r.kmBolt;
    if (r.viajesBolt) o.viajes[r.dia] = r.viajesBolt;
    if (!o.matricula) o.matricula = r.matricula;
    if (!o.vehiculo && r.vehiculo) o.vehiculo = r.vehiculo;
  });
  const km = [...porPlaca.values()].map(o => {
    const totalMapon = round1(suma(Object.values(o.mapon)));
    const totalBolt = round1(suma(Object.values(o.bolt)));
    const diff = round1(totalMapon - totalBolt);
    const pct = totalMapon > 0 ? Math.round((diff / totalMapon) * 100) : null;
    return { placa: o.placa, matricula: o.matricula, vehiculo: o.vehiculo, mapon: o.mapon, bolt: o.bolt, viajes: o.viajes,
      totalMapon, totalBolt, viajesBolt: suma(Object.values(o.viajes)), diff, pct };
  }).sort((a, b) => a.matricula.localeCompare(b.matricula));

  const eventos = eventosRec.filter(e => set.has(e.dia)).sort((a, b) => b.orden - a.orden);

  // Ofensores: más KM sin facturar (diff) y quienes más repostan (litros positivos).
  const topDiff = [...km].filter(k => k.diff != null).sort((a, b) => b.diff - a.diff).slice(0, 5)
    .map(k => ({ placa: k.placa, matricula: k.matricula, diff: k.diff, pct: k.pct, totalMapon: k.totalMapon, totalBolt: k.totalBolt }));
  const rep = new Map();
  eventos.forEach(e => {
    if (e.tipo !== 'repostaje') return;
    const o = rep.get(e.placa) || { placa: e.placa, matricula: e.matricula, litros: 0, veces: 0 };
    o.litros += e.litros; o.veces++;
    rep.set(e.placa, o);
  });
  const topRepostaje = [...rep.values()].map(o => ({ ...o, litros: round1(o.litros) }))
    .sort((a, b) => b.litros - a.litros).slice(0, 5);

  return { dias, km, eventos, ofensores: { kmDiff: topDiff, repostaje: topRepostaje } };
}

// ── Persistencia / orquestación ───────────────────────────────────────────────

async function ensureTabs() {
  await sheets.ensureSheet(ID_AUDITORIA, TAB_KM);
  await sheets.ensureSheet(ID_AUDITORIA, TAB_FUEL);
  await sheets.ensureSheet(ID_AUDITORIA, TAB_DIAS);
  const [a, b, c] = await sheets.readMany(ID_AUDITORIA, [`${TAB_KM}!A1:H1`, `${TAB_FUEL}!A1:N1`, `${TAB_DIAS}!A1:B1`]);
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

// Un refresco a la vez: el histórico se reescribe entero, así que dos a la par se pisarían.
let _cola = Promise.resolve();
function enCola(fn) {
  const r = _cola.then(fn, fn);
  _cola = r.catch(() => {});
  return r;
}

async function _cargar({ desde, hasta }) {
  const { ini, fin } = resolverRango({ desde, hasta });
  const dias = ejeDias(ini, fin);
  const hoy = hoyMadrid();

  await ensureTabs();
  const [valKm, valFuel, valDias] = await sheets.readMany(
    ID_AUDITORIA, [`${TAB_KM}!A:H`, `${TAB_FUEL}!A:N`, `${TAB_DIAS}!A:B`]);

  const congelados = new Set((valDias || []).slice(1).map(r => String(r[0])).filter(Boolean));
  const { refetch } = clasificarDias(dias, congelados, hoy);

  let filasKmRec = leerFilasKm(valKm);
  let eventosRec = leerEventos(valFuel);

  if (refetch.length) {
    const spanIni = refetch.reduce((a, b) => a < b ? a : b);
    const spanFin = refetch.reduce((a, b) => a > b ? a : b);
    const rango = { desde: isoAddmm(spanIni), hasta: isoAddmm(spanFin) };

    // BOLT (otra API) en paralelo; los dos lectores de Mapon en serie para no
    // acercarnos al tope de 5 peticiones concurrentes que comparte el cron de sanciones.
    const boltP = leerKmBolt(rango);
    const mapon = await leerKmPorDia(rango);
    const comb = await leerCombustible(rango);
    const bolt = await boltP;

    const setRe = new Set(refetch);
    const nuevasKm = construirFilasKm(refetch, mapon, bolt);
    const nuevosEv = comb.eventos
      .map(e => ({ ...e, dia: fechaEUaISO(e.fecha), placa: normPlaca(e.matricula) }))
      .filter(e => setRe.has(e.dia));

    // Se sustituyen SOLO los días refrescados; el resto del histórico se conserva.
    filasKmRec = filasKmRec.filter(r => !setRe.has(r.dia)).concat(nuevasKm);
    eventosRec = eventosRec.filter(r => !setRe.has(r.dia)).concat(nuevosEv);

    await reescribir(TAB_KM, `${TAB_KM}!A2:H`, filasKmRec.map(filaKmASheet));
    await reescribir(TAB_FUEL, `${TAB_FUEL}!A2:N`, eventosRec.map(eventoASheet));
    const nuevosDias = refetch.filter(d => !congelados.has(d));
    if (nuevosDias.length) await sheets.appendRows(ID_AUDITORIA, `${TAB_DIAS}!A:B`, nuevosDias.map(d => [d, ahora()]));

    console.log(`📊 [AUDITORÍA] refrescados ${refetch.length} día(s) (${spanIni}→${spanFin}) · ` +
      `${nuevasKm.length} filas KM, ${nuevosEv.length} eventos`);
  }

  const resp = construirRespuesta(dias, filasKmRec, eventosRec);
  return { ...resp, desde: ini.toISOString(), hasta: fin.toISOString(),
    refrescados: refetch.length, generado: ahora() };
}

/** Punto de entrada: sirve el rango del Sheet, refrescando solo lo necesario. */
function cargarAuditoria(rango = {}) {
  return enCola(() => _cargar(rango));
}

module.exports = {
  cargarAuditoria, leerKmBolt,
  // exportados para pruebas
  normPlaca, diaLocal, diaMenos, clasificarDias, construirFilasKm, construirRespuesta,
  leerFilasKm, leerEventos, resolverRango, ejeDias, MAX_DIAS
};
