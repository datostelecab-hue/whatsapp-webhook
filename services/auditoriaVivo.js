// ============================================================
// AUDITORÍA EN VIVO — coches que se mueven estando "en descanso"
// ============================================================
// La auditoría forense (auditoriaFlota) contesta al día siguiente. Esto contesta
// AHORA: cada pocos minutos mira qué coches están en `busy` (descanso) según BOLT
// y cuántos km llevan hechos en ese rato según el GPS (Mapon). Si un coche lleva
// media hora "descansando" y ha recorrido 8 km, alguien está usando el coche sin
// estar disponible para pedidos — y tráfico se entera mientras pasa, no mañana.
//
// Solo se vigilan los coches PLANIFICADOS en el turno en curso: un coche aparcado
// en el depósito puede moverse por mil motivos legítimos y no es noticia.
//
// CUIDADO CON LA CUOTA DE SHEETS (60 lecturas/min y las comparte todo el ERP):
// el tablero del planificador y el padrón se leen UNA vez cada muchos minutos y se
// guardan en memoria. Lo que se consulta en cada vuelta es BOLT y Mapon, que no
// tocan Sheets.

const { fetchRangoCompleto, CONFIG_BOLT } = require('./bolt');
const mapon = require('./mapon');
const { leerTablero, TURNOS } = require('./planificadorV2');
const { leerPadron } = require('./conductoresBolt');

const TZ = 'Europe/Madrid';

// ── Ajustes (se pueden tocar por variables de entorno sin desplegar código) ──
const CFG = {
  // Cada cuánto se recalcula todo.
  intervaloMin: Number(process.env.VIVO_INTERVALO_MIN) || 5,
  // Km recorridos en descanso a partir de los cuales salta la alerta.
  umbralKm: Number(process.env.VIVO_UMBRAL_KM) || 5,
  // Mínimo en descanso antes de mirar: por debajo son transiciones normales
  // (el conductor cierra el viaje mientras aún rueda hasta aparcar).
  minDescansoMin: Number(process.env.VIVO_MIN_DESCANSO_MIN) || 10,
  // Ventana de state logs que se pide a BOLT en cada vuelta.
  ventanaLogsH: Number(process.env.VIVO_VENTANA_LOGS_H) || 6,
  // Consultas simultáneas a Mapon (su límite son 5).
  concurrencia: 4,
  ttlTableroMs: 20 * 60 * 1000,
  ttlPadronMs: 30 * 60 * 1000
};

const ESTADO_DESCANSO = 'busy';

// ── Estado en memoria ────────────────────────────────────────────────────────
// Se pierde al reiniciar Render: es un monitor de "ahora", no un libro de
// registro. Lo que hay que conservar ya lo guarda la auditoría forense.
let ULTIMO = {
  ts: 0,                 // cuándo terminó la última vuelta
  ejecutando: false,
  alertas: [],           // las que están activas AHORA
  vigilados: 0,          // coches en descanso que se han medido
  planificados: 0,
  error: null,
  duracionMs: 0
};
const REVISADAS = new Map();   // clave -> { ts, quien }  alertas que tráfico ya miró
let timer = null;

const normPlaca = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const r1 = n => Math.round(n * 10) / 10;

// ── Cachés de lo que vive en Sheets ─────────────────────────────────────────
let cacheTablero = { ts: 0, datos: null };
let cachePadron = { ts: 0, datos: null };

async function tableroCacheado() {
  if (cacheTablero.datos && Date.now() - cacheTablero.ts < CFG.ttlTableroMs) return cacheTablero.datos;
  const t = await leerTablero();
  cacheTablero = { ts: Date.now(), datos: t };
  return t;
}
async function padronCacheado() {
  if (cachePadron.datos && Date.now() - cachePadron.ts < CFG.ttlPadronMs) return cachePadron.datos;
  // leerPadron() devuelve { db: Map(uuid -> ficha), filas: n }; aquí solo interesa el mapa.
  const { db } = await leerPadron();
  if (!db || typeof db.get !== 'function') throw new Error('leerPadron() no devolvió el mapa esperado');
  cachePadron = { ts: Date.now(), datos: db };
  return db;
}

/**
 * Turno que se está trabajando AHORA, con el mismo corte que la auditoría:
 * día 05:00–17:00 y noche 17:00–05:00. De madrugada (antes de las 5) el turno de
 * noche es el que empezó AYER, así que el día del tablero es el anterior.
 */
function turnoActual(ahora = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  }).formatToParts(ahora);
  const g = t => (p.find(x => x.type === t) || {}).value;
  const hora = Number(g('hour'));
  // Mediodía UTC del día local: sumar/restar días no cruza fronteras raras.
  let base = new Date(`${g('year')}-${g('month')}-${g('day')}T12:00:00Z`);
  let turno = 'Noche';
  if (hora >= 5 && hora < 17) turno = 'Día';
  else if (hora < 5) base = new Date(base.getTime() - 86400000);   // la noche de ayer
  return { turno, idxDia: (base.getUTCDay() + 6) % 7, fecha: base };
}

/** Matrículas con conductor planificado en el turno en curso → info del plan. */
async function planificadosAhora() {
  const { turno, idxDia } = turnoActual();
  const tablero = await tableroCacheado();
  const iT = TURNOS.indexOf(turno);
  const mapa = new Map();
  (tablero.coches || []).forEach(coche => {
    if (!coche.matricula || !coche.operativo) return;
    const tramo = (coche.semana || [])[idxDia * 2 + iT];
    if (!tramo || !tramo.id) return;
    mapa.set(normPlaca(coche.matricula), {
      matricula: coche.matricula,
      zona: coche.zona || '',
      planificado: (tramo.nombre || tramo.id || '').trim(),
      turno
    });
  });
  return { mapa, turno };
}

// ── BOLT: estado actual de cada coche ───────────────────────────────────────

async function vehiculosBolt(desdeTs, hastaTs) {
  const map = {};   // vehicle_uuid -> matrícula normalizada
  for (const f of CONFIG_BOLT.flotas) {
    const v = await fetchRangoCompleto('/fleetIntegration/v1/getVehicles',
      { company_id: f.id }, 'vehicles', desdeTs, hastaTs, 100, `VIVO veh ${f.id}`);
    v.forEach(x => {
      const placa = normPlaca(x.reg_number || x.registration_number || x.license_plate);
      const uuid = x.uuid || x.vehicle_uuid;
      if (placa && uuid) map[uuid] = placa;
    });
  }
  return map;
}

async function logsRecientes(desdeTs, hastaTs) {
  let out = [];
  for (const f of CONFIG_BOLT.flotas) {
    out = out.concat(await fetchRangoCompleto('/fleetIntegration/v1/getFleetStateLogs',
      { company_id: f.id }, 'state_logs', desdeTs, hastaTs, 1000, `VIVO log ${f.id}`));
  }
  return out;
}

/**
 * Último estado de cada coche y desde cuándo lo lleva. "Desde cuándo" es el
 * comienzo de la RACHA actual: se retrocede mientras el estado no cambie, para no
 * confundir un descanso de 2 h con el último latido del log.
 */
function estadoActualPorPlaca(logs, uuidPlaca) {
  const porPlaca = {};
  logs.forEach(l => {
    const placa = uuidPlaca[l.vehicle_uuid];
    if (!placa || !l.created) return;
    (porPlaca[placa] = porPlaca[placa] || []).push({
      t: Number(l.created), state: l.state, driver: l.driver_uuid || ''
    });
  });

  const fuera = {};
  Object.entries(porPlaca).forEach(([placa, arr]) => {
    arr.sort((a, b) => a.t - b.t);
    const ult = arr[arr.length - 1];
    let desde = ult.t;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].state !== ult.state) break;
      desde = arr[i].t;
    }
    fuera[placa] = { estado: ult.state, desde, driver: ult.driver, ultimoLog: ult.t };
  });
  return fuera;
}

// ── Vuelta completa ─────────────────────────────────────────────────────────

/** Lanza `tareas` de N en N para no pasarse del límite de Mapon. */
async function enLotes(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  }
  return out;
}

async function pasada() {
  if (ULTIMO.ejecutando) return ULTIMO;
  ULTIMO.ejecutando = true;
  const t0 = Date.now();

  try {
    const ahoraTs = Math.floor(Date.now() / 1000);
    const desdeTs = ahoraTs - CFG.ventanaLogsH * 3600;

    const [{ mapa: plan, turno }, padron, uuidPlaca, unidades] = await Promise.all([
      planificadosAhora(),
      padronCacheado(),
      vehiculosBolt(desdeTs, ahoraTs),
      mapon.unidades()
    ]);

    // matrícula normalizada -> unit_id de Mapon
    const unitPorPlaca = new Map();
    unidades.forEach((info, unitId) => unitPorPlaca.set(normPlaca(info.matricula), unitId));

    const logs = await logsRecientes(desdeTs, ahoraTs);
    const estados = estadoActualPorPlaca(logs, uuidPlaca);

    // Candidatos: planificados + en descanso + ya con un rato en descanso.
    const candidatos = Object.entries(estados)
      .filter(([placa, e]) =>
        e.estado === ESTADO_DESCANSO &&
        plan.has(placa) &&
        (ahoraTs - e.desde) >= CFG.minDescansoMin * 60)
      .map(([placa, e]) => ({ placa, ...e, ...plan.get(placa), unitId: unitPorPlaca.get(placa) }))
      .filter(c => c.unitId);

    // Km de cada uno DURANTE el descanso.
    const medidos = await enLotes(candidatos, CFG.concurrencia, async c => {
      try {
        const km = await mapon.kmEnVentana({ unitId: c.unitId, fromTs: c.desde, tillTs: ahoraTs });
        return { ...c, km: km.km, trayectos: km.trayectos };
      } catch (e) {
        console.warn(`⚠️  [VIVO] ${c.matricula}: no se pudo medir (${e.message})`);
        return null;
      }
    });

    const alertas = medidos.filter(Boolean)
      .filter(c => c.km > CFG.umbralKm)
      .map(c => {
        const minutos = Math.round((ahoraTs - c.desde) / 60);
        const ficha = padron.get(c.driver);
        return {
          clave: `${c.placa}|${c.desde}`,
          matricula: c.matricula,
          zona: c.zona,
          km: r1(c.km),
          trayectos: c.trayectos,
          minutos,
          kmPorHora: r1(c.km / Math.max(minutos / 60, 0.1)),
          desde: c.desde,
          desdeLocal: new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(c.desde * 1000)),
          turno: c.turno,
          planificado: c.planificado,
          enBolt: (ficha && ficha.nombre) || '',
          telefono: (ficha && ficha.phone) || '',
          driverUuid: c.driver || '',
          // Si el que conduce no es el que estaba planificado, es otra historia
          // (coche cambiado de mano) y conviene verlo de un vistazo.
          distinto: !!(ficha && ficha.nombre && c.planificado &&
            normPlaca(ficha.nombre) !== normPlaca(c.planificado)),
          revisada: REVISADAS.has(`${c.placa}|${c.desde}`)
        };
      })
      .sort((a, b) => b.km - a.km);

    ULTIMO = {
      ts: Date.now(),
      ejecutando: false,
      alertas,
      vigilados: candidatos.length,
      planificados: plan.size,
      turno,
      error: null,
      duracionMs: Date.now() - t0
    };
    if (alertas.length) {
      console.log(`🚨 [VIVO] ${alertas.length} coche(s) en descanso con más de ${CFG.umbralKm} km: ` +
        alertas.map(a => `${a.matricula} ${a.km}km/${a.minutos}min`).join(', '));
    }
  } catch (e) {
    console.error(`❌ [VIVO] ${e.stack || e.message}`);
    ULTIMO = { ...ULTIMO, ejecutando: false, ts: Date.now(), error: e.message, duracionMs: Date.now() - t0 };
  }
  return ULTIMO;
}

// ── API del módulo ──────────────────────────────────────────────────────────

function estado() {
  return {
    ...ULTIMO,
    alertas: ULTIMO.alertas.map(a => ({ ...a, revisada: REVISADAS.has(a.clave) })),
    config: { umbralKm: CFG.umbralKm, minDescansoMin: CFG.minDescansoMin, intervaloMin: CFG.intervaloMin },
    proxima: ULTIMO.ts ? ULTIMO.ts + CFG.intervaloMin * 60000 : 0
  };
}

function marcarRevisada(clave, quien) {
  if (!clave) return { ok: false };
  REVISADAS.set(clave, { ts: Date.now(), quien: quien || '' });
  // No crece sin fin: se sueltan las de hace más de 24 h.
  const corte = Date.now() - 24 * 3600 * 1000;
  for (const [k, v] of REVISADAS) if (v.ts < corte) REVISADAS.delete(k);
  return { ok: true };
}

function arrancar() {
  if (timer) return;
  const ms = CFG.intervaloMin * 60000;
  console.log(`🔴 [VIVO] Auditoría en vivo cada ${CFG.intervaloMin} min ` +
    `(umbral ${CFG.umbralKm} km tras ${CFG.minDescansoMin} min en descanso)`);
  pasada();
  timer = setInterval(pasada, ms);
}
function parar() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { pasada, estado, marcarRevisada, arrancar, parar, turnoActual, CFG };
