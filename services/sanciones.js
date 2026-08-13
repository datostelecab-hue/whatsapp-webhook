// ============================================================
// SANCIONES POR EXCESO DE VELOCIDAD (Operaciones) — registro legal + avisos
// ============================================================
// Flujo (cron cada 15 min):
//   1) Mapon da las alertas de 'speeding' (matrícula + hora + velocidad/límite).
//   2) Por cada exceso NUEVO (dedup por clave unit_id|hora), se resuelve el
//      conductor cruzando con Bolt: matrícula → vehicle_uuid (getVehicles) →
//      state_logs [T-15min…ampliable] filtrando ese vehículo → driver_uuid →
//      nombre + teléfono (padrón CONDUCTORES_BOLT).
//   3) Reincidencia dentro de 3 MESES: la 1ª vez → 'advertencia_limite' (auto);
//      la 2ª+ → 'reincidencia_de_velocidad' (NO se manda sola: queda PENDIENTE de
//      aprobación manual, porque abre expediente disciplinario).
//   4) Todo se registra en un libro APARTE ("logs de velocidad"), append-only.
//   · Si no se puede resolver el conductor con confianza → NO se avisa: queda
//     "pendiente-revisión". En algo legal, mejor no sancionar a quien no toca.
//   · MODO: 'test' por defecto (no envía nada, marca 'simulado'); 'live' envía.
//     Se cambia con la variable de entorno SANCIONES_MODO=live.

const bolt = require('./bolt');
const mapon = require('./mapon');
const whatsapp = require('./whatsapp');
const { leerPadron } = require('./conductoresBolt');
const { leerTelefonosDB } = require('./control');
const { normClave } = require('./conductores');
const { readSheet, writeSheet, ensureSheet, appendRows } = require('./sheets');

const LIBRO = '18E7ZJpc29aGDAAFNIyrvhScuMgEuYR8qNG1FGVY9_Ns';   // libro "logs de velocidad" (aparte)
const HOJA = 'REGISTRO';                                          // pestaña del log legal
const VENTANA_MESES = 3;                                          // reincidencia dentro de 3 meses
const PLANTILLA_ADVERTENCIA = 'advertencia_limite';
const PLANTILLA_REINCIDENCIA = 'reincidencia_de_velocidad';
const TTL_VEHICULOS = 6 * 3600 * 1000;                            // caché del mapa de vehículos: 6 h
const VENTANAS_VEH = 3;                                           // ventanas de 30 días para getVehicles

const modo = () => (process.env.SANCIONES_MODO === 'live' ? 'live' : 'test');
const esLive = () => modo() === 'live';

/**
 * FECHA DE ALTA DEL SISTEMA (SANCIONES_DESDE, formato aaaa-mm-dd).
 *
 * No se puede sancionar por reincidencia usando excesos anteriores a que el sistema
 * existiera: al conductor nunca se le avisó de ellos, así que no puede "reincidir".
 * Con esta fecha puesta, todo lo anterior:
 *   · NI se registra (las alertas viejas se ignoran aunque se pida un rango amplio),
 *   · NI cuenta como infracción previa (aunque queden filas antiguas en el libro).
 * Sin ella el módulo se comporta como antes (cuenta todo el histórico).
 */
function inicioSistemaTs() {
  const s = (process.env.SANCIONES_DESDE || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  // Medianoche de ese día en hora peninsular (el desfase se saca del propio día).
  const mediodiaUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour12: false, hour: '2-digit' }).format(new Date(mediodiaUTC)));
  const offsetSeg = (h - 12) * 3600;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - offsetSeg * 1000;
}
const DESDE_TS = inicioSistemaTs();

// Estados del registro (columna N).
const EST = {
  ENVIADO: 'enviado',                 // advertencia enviada
  SIMULADO: 'simulado',               // modo test: se habría enviado
  PEND_APROB: 'pendiente-aprobacion', // reincidencia esperando OK manual
  APROB_ENVIADA: 'reincidencia-enviada',
  APROB_SIMULADA: 'reincidencia-simulada',
  PEND_REVISION: 'pendiente-revision',// no se pudo resolver el conductor
  ERROR: 'error'
};
// Estados que SÍ cuentan como una infracción atribuida a un conductor (para la reincidencia).
const CUENTAN = new Set([EST.ENVIADO, EST.SIMULADO, EST.PEND_APROB, EST.APROB_ENVIADA, EST.APROB_SIMULADA]);

const CAB = ['Clave', 'Fecha (Madrid)', 'Fecha (UTC)', 'ts', 'Matrícula', 'Conductor', 'driver_uuid',
  'Teléfono', 'Velocidad', 'Límite', 'Exceso', 'Aviso', 'Plantilla', 'Estado', 'Envío ID', 'Envío ts', 'Notas', 'Ubicación'];
const RANGO_LOG = `'${HOJA}'!A:R`;   // 18 columnas (la última = ubicación lat,lng)

const normPlaca = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const fmtMadrid = ms => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(ms));

// ── Mapa de vehículos de Bolt (matrícula ↔ vehicle_uuid), cacheado ──────────
let _cacheVeh = { ts: 0, porPlaca: new Map(), porUuid: new Map() };

async function mapaVehiculos(forzar = false) {
  if (!forzar && _cacheVeh.porPlaca.size && Date.now() - _cacheVeh.ts < TTL_VEHICULOS) return _cacheVeh;
  const porPlaca = new Map();   // normPlaca -> { uuid, reg, flotas:Set }
  const porUuid = new Map();    // uuid -> { reg, flotas:Set }
  const ahora = Math.floor(Date.now() / 1000);
  for (const flota of bolt.CONFIG_BOLT.flotas) {
    // getVehicles (limit ≤ 100). Se probó que UNA ventana de 30 días ya cubre el 100%
    // de la flota en uso; barremos 3 (90 días) por margen. Si alguna matrícula activa
    // saliera como "desconocida", subir VENTANAS_VEH.
    for (let w = 0; w < VENTANAS_VEH; w++) {
      const end = ahora - w * 30 * 86400;
      const start = end - 30 * 86400;
      let vehiculos = [];
      try {
        vehiculos = await bolt.fetchAllPaginated('/fleetIntegration/v1/getVehicles',
          { company_id: flota.id, start_ts: start, end_ts: end }, 'vehicles', 100, 'sanciones-veh');
      } catch (e) { console.warn(`⚠️ [SANCIONES] getVehicles flota ${flota.id}: ${e.message}`); continue; }
      vehiculos.forEach(v => {
        const uuid = v.uuid; const reg = (v.reg_number || '').toString().trim();
        if (!uuid || !reg) return;
        const k = normPlaca(reg);
        if (!porPlaca.has(k)) porPlaca.set(k, { uuid, reg, flotas: new Set() });
        porPlaca.get(k).flotas.add(flota.id);
        if (!porUuid.has(uuid)) porUuid.set(uuid, { reg, flotas: new Set() });
        porUuid.get(uuid).flotas.add(flota.id);
      });
    }
  }
  if (porPlaca.size) _cacheVeh = { ts: Date.now(), porPlaca, porUuid };
  else if (!_cacheVeh.porPlaca.size) throw new Error('No se pudo cargar el mapa de vehículos de Bolt');
  console.log(`🚗 [SANCIONES] Mapa de vehículos: ${_cacheVeh.porPlaca.size} matrículas`);
  return _cacheVeh;
}

// El último conductor que tuvo ese vehicle_uuid en [desde, hasta] (epoch s), en las
// flotas indicadas. Devuelve driver_uuid o null.
async function ultimoConductor(flotas, uuid, desde, hasta) {
  let mejor = null;
  for (const flotaId of flotas) {
    let logs = [];
    try {
      logs = await bolt.fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs',
        { company_id: flotaId, start_ts: desde, end_ts: hasta }, 'state_logs', 1000, 'sanciones-logs');
    } catch (e) { console.warn(`⚠️ [SANCIONES] state_logs flota ${flotaId}: ${e.message}`); continue; }
    logs.forEach(l => {
      if (l.vehicle_uuid === uuid && l.created <= hasta && (!mejor || l.created > mejor.created)) {
        mejor = { created: l.created, driver_uuid: l.driver_uuid, lat: l.lat, lng: l.lng };
      }
    });
  }
  return mejor;   // { created, driver_uuid, lat, lng } o null
}

// Resuelve la matrícula X en el momento tMs → { driver_uuid, ventanaSeg } o { error }.
async function conductorDeMatricula(matricula, tMs) {
  const mapa = await mapaVehiculos();
  const veh = mapa.porPlaca.get(normPlaca(matricula));
  if (!veh) return { error: 'matricula-desconocida' };
  const flotas = [...veh.flotas];
  const t = Math.floor(tMs / 1000);
  // Ventanas crecientes: normalmente el conductor está en los 15 min; si el coche
  // estaba desconectado se amplía para hallar el último que lo condujo.
  for (const w of [15 * 60, 60 * 60, 6 * 3600, 24 * 3600, 3 * 86400, 15 * 86400]) {
    const m = await ultimoConductor(flotas, veh.uuid, t - w, t);
    if (m && m.driver_uuid) return { driver_uuid: m.driver_uuid, uuid: veh.uuid, flotas, ventanaSeg: w, lat: m.lat, lng: m.lng };
  }
  return { error: 'sin-conductor', uuid: veh.uuid, flotas };
}

// ── Padrón (driver_uuid → nombre/teléfono), con caché corto ─────────────────
let _cachePadron = { ts: 0, mapa: null };
let _cacheTelDB = { ts: 0, mapa: null };
async function datosConductor(driverUuid) {
  if (!_cachePadron.mapa || Date.now() - _cachePadron.ts > 10 * 60 * 1000) {
    const padron = await leerPadron().catch(() => ({ db: new Map() }));
    _cachePadron = { ts: Date.now(), mapa: padron.db || new Map() };
  }
  const reg = _cachePadron.mapa.get(driverUuid) || _cachePadron.mapa.get(String(driverUuid)) || {};
  let telefono = (reg.phone || '').toString().trim();
  const nombre = (reg.nombre || '').toString().trim();
  if (!telefono && nombre) {   // fallback: teléfono por nombre desde DB_CONDUCTORES
    if (!_cacheTelDB.mapa || Date.now() - _cacheTelDB.ts > 10 * 60 * 1000) {
      _cacheTelDB = { ts: Date.now(), mapa: await leerTelefonosDB().catch(() => new Map()) };
    }
    telefono = _cacheTelDB.mapa.get(normClave(nombre)) || '';
  }
  return { nombre, telefono };
}

// ── Log legal (append-only) ─────────────────────────────────────────────────
let _logListo = false;
async function ensureLog() {
  if (_logListo) return;
  await ensureSheet(LIBRO, HOJA);
  const filas = await readSheet(LIBRO, `'${HOJA}'!A1:R1`).catch(() => []);
  if (!filas.length || !(filas[0] || []).length) await writeSheet(LIBRO, `'${HOJA}'!A1`, [CAB]);
  _logListo = true;
}

async function leerLog() {
  await ensureLog();
  const filas = await readSheet(LIBRO, `'${HOJA}'!A2:R100000`).catch(() => []);
  return (filas || []).map((f, i) => ({
    fila: i + 2,
    clave: (f[0] || '').toString(),
    fechaLocal: f[1], fechaUtc: f[2], ts: num(f[3]),
    matricula: (f[4] || '').toString(), conductor: (f[5] || '').toString(), driverUuid: (f[6] || '').toString(),
    telefono: (f[7] || '').toString(), velocidad: num(f[8]), limite: num(f[9]), exceso: num(f[10]),
    aviso: (f[11] || '').toString(), plantilla: (f[12] || '').toString(), estado: (f[13] || '').toString(),
    envioId: (f[14] || '').toString(), envioTs: (f[15] || '').toString(), notas: (f[16] || '').toString(),
    ubicacion: (f[17] || '').toString()
  })).filter(r => r.clave);
}

// ¿Cuántas infracciones previas atribuidas a ese conductor dentro de la ventana?
// Nunca se miran hechos anteriores al alta del sistema: aunque el libro conserve filas
// viejas, no cuentan para la reincidencia (al conductor no se le avisó de aquello).
function previosEnVentana(log, driverUuid, tsMs) {
  const limite = new Date(tsMs); limite.setMonth(limite.getMonth() - VENTANA_MESES);
  const desde = Math.max(limite.getTime(), DESDE_TS || 0);
  return log.filter(r => r.driverUuid && r.driverUuid === driverUuid && CUENTAN.has(r.estado) &&
    r.ts != null && r.ts >= desde && r.ts < tsMs).length;
}

async function enviar(plantilla, telefono, nombre, matricula) {
  if (!esLive()) return { ok: true, simulado: true };
  if (!telefono) return { ok: false, error: 'sin-telefono' };
  return whatsapp.enviarPlantillaPosicional(telefono, plantilla, [nombre, matricula]);
}

// ── Procesar (lo llama el cron) ─────────────────────────────────────────────
let _corriendo = false;
let _ultimo = { ts: null, nuevos: 0, resumen: null };

async function procesar(opciones = {}) {
  if (_corriendo) return { saltado: true, motivo: 'ya en curso' };
  _corriendo = true;
  const res = { modo: modo(), leidas: 0, nuevas: 0, advertencias: 0, reincidencias: 0, sinConductor: 0, errores: 0, detalle: [] };
  try {
    // Ventana de lectura: por defecto ~25 min (solape sobre los 15 del cron).
    const minutos = Number(opciones.minutos) || 25;
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - minutos * 60000);
    const { alertas } = await mapon.leerAlertas({ desde, hasta, tipo: 'speeding' });
    res.leidas = alertas.length;

    const log = await leerLog();
    const yaVistas = new Set(log.map(r => r.clave));

    for (const a of alertas) {
      if (yaVistas.has(a.id)) continue;                 // dedup: ya registrada
      const tMs = Date.parse(a.iso);
      // Anterior al alta del sistema: ni se registra ni cuenta. Evita que una consulta
      // con rango amplio vuelva a llenar el libro de hechos que nunca se comunicaron.
      if (DESDE_TS && tMs < DESDE_TS) { res.previosAlAlta = (res.previosAlAlta || 0) + 1; continue; }
      yaVistas.add(a.id);
      res.nuevas++;
      const fila = new Array(CAB.length).fill('');
      fila[0] = a.id; fila[1] = fmtMadrid(tMs); fila[2] = a.iso; fila[3] = String(tMs);
      fila[4] = a.matricula; fila[8] = a.velocidad ?? ''; fila[9] = a.limite ?? ''; fila[10] = a.exceso ?? '';

      // Resolver conductor.
      let r;
      try { r = await conductorDeMatricula(a.matricula, tMs); }
      catch (e) { r = { error: 'excepcion', msg: e.message }; }

      if (r.error || !r.driver_uuid) {
        fila[13] = EST.PEND_REVISION;
        fila[16] = r.error === 'matricula-desconocida' ? 'Matrícula no está en Bolt' :
          r.error === 'sin-conductor' ? 'Sin conductor en los logs (coche desconectado)' : (r.msg || r.error || 'no resuelto');
        res.sinConductor++;
        await appendRows(LIBRO, RANGO_LOG, [fila]);
        res.detalle.push({ matricula: a.matricula, estado: fila[13] });
        continue;
      }

      const { nombre, telefono } = await datosConductor(r.driver_uuid);
      fila[5] = nombre || '(sin nombre)'; fila[6] = r.driver_uuid; fila[7] = telefono;
      fila[17] = (r.lat != null && r.lng != null) ? `${r.lat},${r.lng}` : '';   // ubicación del log

      const previos = previosEnVentana(log, r.driver_uuid, tMs);
      const esReincidente = previos >= 1;

      if (esReincidente) {
        // La reincidencia NO se manda sola: queda pendiente de aprobación manual.
        fila[11] = `Reincidencia (${previos + 1}ª en ${VENTANA_MESES} meses)`;
        fila[12] = PLANTILLA_REINCIDENCIA;
        fila[13] = EST.PEND_APROB;
        res.reincidencias++;
      } else {
        // 1ª advertencia: automática (según el modo).
        fila[11] = '1ª advertencia';
        fila[12] = PLANTILLA_ADVERTENCIA;
        const env = await enviar(PLANTILLA_ADVERTENCIA, telefono, nombre, a.matricula);
        if (env.ok && env.simulado) { fila[13] = EST.SIMULADO; }
        else if (env.ok) { fila[13] = EST.ENVIADO; fila[14] = env.id || ''; fila[15] = String(Date.now()); }
        else { fila[13] = EST.ERROR; fila[16] = env.error || 'fallo de envío'; res.errores++; }
        res.advertencias++;
      }
      // Añadir al log en memoria para que la reincidencia cuente dentro de la MISMA corrida.
      log.push({ clave: a.id, driverUuid: r.driver_uuid, estado: fila[13], ts: tMs });
      await appendRows(LIBRO, RANGO_LOG, [fila]);
      res.detalle.push({ matricula: a.matricula, conductor: nombre, aviso: fila[11], estado: fila[13] });
    }
  } catch (e) {
    res.error = e.message;
    console.error('❌ [SANCIONES] procesar:', e.stack || e.message);
  } finally {
    _corriendo = false;
    _ultimo = { ts: Date.now(), nuevos: res.nuevas, resumen: res };
  }
  return res;
}

// ── Aprobar / rechazar una reincidencia pendiente ───────────────────────────
async function aprobar(clave) {
  const log = await leerLog();
  const r = log.find(x => x.clave === clave && x.estado === EST.PEND_APROB);
  if (!r) throw new Error('No hay una reincidencia pendiente con esa clave');
  const env = await enviar(PLANTILLA_REINCIDENCIA, r.telefono, r.conductor, r.matricula);
  const estado = env.ok && env.simulado ? EST.APROB_SIMULADA : env.ok ? EST.APROB_ENVIADA : EST.ERROR;
  // Actualiza SOLO el estado/envío de esa fila (los hechos legales no se tocan).
  await writeSheet(LIBRO, `'${HOJA}'!N${r.fila}:Q${r.fila}`, [[
    estado, env.ok ? (env.id || '') : '', env.ok ? String(Date.now()) : '', env.ok ? '' : (env.error || 'fallo')
  ]]);
  return { ok: env.ok, estado, id: env.id, error: env.error };
}

async function rechazar(clave, motivo) {
  const log = await leerLog();
  const r = log.find(x => x.clave === clave && x.estado === EST.PEND_APROB);
  if (!r) throw new Error('No hay una reincidencia pendiente con esa clave');
  await writeSheet(LIBRO, `'${HOJA}'!N${r.fila}:Q${r.fila}`, [['descartada', '', '', (motivo || 'descartada a mano')]]);
  return { ok: true };
}

function estadoModulo() {
  return {
    modo: modo(), corriendo: _corriendo, ultimo: _ultimo,
    // Desde cuándo cuenta el sistema (lo de antes no genera avisos ni reincidencia).
    desde: DESDE_TS ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(DESDE_TS)) : null,
    ventanaMeses: VENTANA_MESES
  };
}

module.exports = {
  LIBRO, HOJA, EST, VENTANA_MESES, DESDE_TS,
  procesar, aprobar, rechazar, leerLog, estadoModulo,
  conductorDeMatricula, mapaVehiculos, modo, previosEnVentana
};
