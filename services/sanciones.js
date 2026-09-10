// ============================================================
// EXCESOS DE VELOCIDAD (Operaciones) — avisar, siempre, y llevar la cuenta
// ============================================================
// Flujo (cron cada 15 min):
//   1) Mapon da las alertas de 'speeding' (matrícula + hora + velocidad/límite).
//   2) Por cada exceso NUEVO (dedup por la clave que da Mapon), se resuelve el
//      conductor cruzando con BOLT: matrícula → vehicle_uuid (getVehicles) →
//      state_logs filtrando ese vehículo → driver_uuid → nombre y teléfono, que
//      ahora salen de PostgreSQL.
//   3) SE AVISA. Siempre, con la misma plantilla, tantas veces como haga falta.
//   4) Queda registrado en `velocidad_exceso`, y de ahí salen las dos preguntas
//      del módulo: cuántas veces se le ha dicho a cada uno, y qué ha pasado.
//
// ── Lo que este módulo YA NO HACE ───────────────────────────────────────────
// Antes era un expediente sancionador: la primera vez avisaba y, a partir de la
// segunda dentro de tres meses, abría un caso que alguien tenía que aprobar a
// mano para mandar OTRA plantilla más dura. En la práctica eso lo convertía en
// una bandeja de aprobaciones, y lo que de verdad se quería saber —quién sigue
// corriendo después de que se le diga— quedaba enterrado entre estados.
//
// Ahora el mensaje es siempre el mismo y siempre automático. La escalada, si
// hace falta, la decide una persona mirando quién acumula avisos: eso es
// información, no un trámite.
//
// ── Lo que sí se mantiene, porque sigue siendo verdad ───────────────────────
//   · Si no se sabe con confianza quién conducía, NO se avisa. Avisar al que no
//     fue era malo cuando pasaba una vez; ahora que es automático y repetido,
//     sería peor. Queda registrado para mirarlo a mano.
//   · MODO: 'test' por defecto (no envía nada, marca 'simulado'); 'live' envía.
//     Se cambia con la variable de entorno SANCIONES_MODO=live.

const bolt = require('./bolt');
const mapon = require('./mapon');
const whatsapp = require('./whatsapp');
const repo = require('./repo/velocidad');

const PLANTILLA_ADVERTENCIA = 'advertencia_limite';
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

/**
 * MEDIA HORA. Hasta ahí la atribución es un dato; a partir de ahí es una conjetura.
 *
 * El motivo es el relevo. Estos coches cambian de manos cada turno, y entre que
 * uno lo deja y el otro se conecta hay un hueco de silencio en los logs. Si el
 * último rastro es de hace 45 minutos, el exceso puede perfectamente ser del que
 * acaba de recibir el coche y aún no se ha puesto en marcha en BOLT: avisar al
 * anterior sería cargarle lo que hizo otro.
 *
 * Media hora es el margen en el que un relevo normal ya ha dejado huella. Por
 * encima, el caso se registra pero NO se avisa a nadie y queda para mirarlo a
 * mano: es preferible revisar que acusar al que no fue.
 *
 * (La intención a futuro es que el propio `busy` haga de fichaje del relevo —el
 * que entrega lo quita, el que recibe lo pone— y entonces la responsabilidad
 * dejará de deducirse y pasará a estar declarada. Mientras tanto, media hora.)
 */
const VENTANA_FIABLE_SEG = Number(process.env.SANCIONES_VENTANA_FIABLE || 1800);
const humanizar = seg => seg < 3600 ? `${Math.round(seg / 60)} min`
  : seg < 86400 ? `${Math.round(seg / 3600)} h` : `${Math.round(seg / 86400)} días`;

// Los estados que puede tener un exceso. Viven también en el CHECK de la tabla:
// si aquí se añade uno, allí también.
const EST = {
  AVISADO: 'avisado',              // se le mandó el WhatsApp
  SIMULADO: 'simulado',            // modo pruebas: se habría mandado
  SIN_CONDUCTOR: 'sin_conductor',  // el coche no tenía a nadie identificable
  DUDOSO: 'dudoso',                // hay candidato, pero el log es demasiado viejo
  ERROR: 'error'                   // se intentó mandar y falló
};

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
  // estaba desconectado se amplía para hallar el último que lo condujo. La
  // ventana es solo una estrategia de búsqueda para no descargarse 15 días de
  // logs de golpe: la ANCHA contiene a la estrecha y ambas devuelven el mismo
  // log (el más reciente anterior al exceso), así que ampliar no cambia a quién
  // se señala, solo cuánto se busca.
  for (const w of [15 * 60, 30 * 60, 60 * 60, 6 * 3600, 24 * 3600, 3 * 86400, 15 * 86400]) {
    const m = await ultimoConductor(flotas, veh.uuid, t - w, t);
    if (m && m.driver_uuid) {
      // ANTIGÜEDAD REAL del log, no el ancho de la ventana que lo encontró.
      //
      // Devolvía `w`, y eso hacía que el 78 % de los excesos se anotara como
      // "último log 60 min antes" cuando en realidad solo se sabía "entre 15 y
      // 60". Con esa cifra no se puede decidir nada a 30 minutos: la resolución
      // del dato era más gruesa que la regla que había que aplicarle.
      return {
        driver_uuid: m.driver_uuid, uuid: veh.uuid, flotas,
        ventanaSeg: Math.max(0, t - m.created),
        lat: m.lat, lng: m.lng,
      };
    }
  }
  return { error: 'sin-conductor', uuid: veh.uuid, flotas };
}

// ── Padrón (driver_uuid → nombre, teléfono y ficha) ────────────────────────
// De PostgreSQL. Antes eran dos hojas de cálculo encadenadas —el padrón de BOLT
// y una tabla de teléfonos por nombre—, cada una con su `.catch()`: cuando
// fallaban, el módulo se quedaba sin teléfono, el aviso no salía y nadie se
// enteraba de por qué. Se cachea un minuto porque una tanda de excesos se
// procesa entera de golpe.
let _cachePadron = { ts: 0, mapa: null };
async function datosConductor(driverUuid) {
  if (!_cachePadron.mapa || Date.now() - _cachePadron.ts > 60 * 1000) {
    _cachePadron = { ts: Date.now(), mapa: await repo.padron() };
  }
  return _cachePadron.mapa.get(String(driverUuid)) || { nombre: '', telefono: '', conductorId: null };
}

/**
 * El aviso. Es SIEMPRE el mismo: la plantilla 'advertencia_limite', ya aprobada
 * en Meta, con el nombre y la matrícula como variables. No hay una segunda
 * plantilla ni un segundo tono: si alguien no hace caso, lo que cambia no es el
 * mensaje sino el número de veces que aparece en la lista.
 */
async function enviar(telefono, nombre, matricula) {
  if (!esLive()) return { ok: true, simulado: true };
  if (!telefono) return { ok: false, error: 'sin-telefono' };
  return whatsapp.enviarPlantillaPosicional(telefono, PLANTILLA_ADVERTENCIA, [nombre, matricula]);
}

// ── Procesar (lo llama el cron) ─────────────────────────────────────────────
let _corriendo = false;
let _ultimo = { ts: null, nuevos: 0, resumen: null };

async function procesar(opciones = {}) {
  if (_corriendo) return { saltado: true, motivo: 'ya en curso' };
  _corriendo = true;
  const res = { modo: modo(), leidas: 0, nuevas: 0, avisos: 0, sinConductor: 0, dudosas: 0, errores: 0, detalle: [] };
  try {
    // Ventana de lectura: por defecto ~25 min (solape sobre los 15 del cron).
    const minutos = Number(opciones.minutos) || 25;
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - minutos * 60000);
    const { alertas } = await mapon.leerAlertas({ desde, hasta, tipo: 'speeding' });
    res.leidas = alertas.length;

    // El dedup ya no se hace leyendo el libro entero: se preguntan las claves
    // del rango, que son unas pocas. Con un margen de un día por si una alerta
    // llega con retraso.
    const margen = new Date(desde.getTime() - 86400000).toISOString();
    const yaVistas = await repo.yaVistas(margen);

    // De la más antigua a la más reciente, que es como se leen los hechos.
    const enOrden = [...alertas].sort((x, y) => x.orden - y.orden);

    for (const a of enOrden) {
      if (yaVistas.has(a.id)) continue;
      const tMs = Date.parse(a.iso);
      // Anterior al alta del sistema: ni se registra ni se avisa. Evita que una
      // consulta con rango amplio mande WhatsApps por excesos de hace meses.
      if (DESDE_TS && tMs < DESDE_TS) { res.previosAlAlta = (res.previosAlAlta || 0) + 1; continue; }
      yaVistas.add(a.id);
      res.nuevas++;

      const base = {
        clave: a.id, ocurridoAt: new Date(tMs).toISOString(), placa: normPlaca(a.matricula),
        velocidad: a.velocidad, limite: a.limite, exceso: a.exceso,
      };

      // ── ¿Quién conducía? ──────────────────────────────────────────────────
      let r;
      try { r = await conductorDeMatricula(a.matricula, tMs); }
      catch (e) { r = { error: 'excepcion', msg: e.message }; }

      if (r.error || !r.driver_uuid) {
        res.sinConductor++;
        await repo.registrar({ ...base, estado: EST.SIN_CONDUCTOR,
          nota: r.error === 'matricula-desconocida' ? 'La matrícula no está en BOLT'
            : r.error === 'sin-conductor' ? 'Sin conductor en los logs (coche desconectado de BOLT)'
            : (r.msg || r.error || 'no se pudo resolver') });
        res.detalle.push({ matricula: a.matricula, estado: EST.SIN_CONDUCTOR });
        continue;
      }

      const { nombre, telefono, conductorId } = await datosConductor(r.driver_uuid);
      const quien = {
        driverUuid: r.driver_uuid, conductorId, conductor: nombre || null, telefono: telefono || null,
        lat: r.lat, lng: r.lng, ventanaSeg: r.ventanaSeg,
      };

      // ── Atribución dudosa: se registra, pero no se avisa ───────────────────
      // El coche cambia de manos cada turno. Si el último log del que se deduce
      // el conductor es de hace horas, "el último que lo condujo" puede
      // perfectamente no ser quien iba al volante.
      if (r.ventanaSeg > VENTANA_FIABLE_SEG) {
        res.dudosas++;
        await repo.registrar({ ...base, ...quien, estado: EST.DUDOSO,
          nota: `Candidato: ${nombre || r.driver_uuid} (el último log del coche es de ` +
            `${humanizar(r.ventanaSeg)} antes del exceso). Confirmar antes de avisar.` });
        res.detalle.push({ matricula: a.matricula, conductor: nombre, estado: EST.DUDOSO });
        continue;
      }

      // ── Se avisa. Siempre. ────────────────────────────────────────────────
      const env = await enviar(telefono, nombre, a.matricula);
      const estado = env.ok ? (env.simulado ? EST.SIMULADO : EST.AVISADO) : EST.ERROR;
      if (estado === EST.ERROR) res.errores++; else res.avisos++;
      await repo.registrar({ ...base, ...quien, estado,
        plantilla: PLANTILLA_ADVERTENCIA,
        envioId: env.id || null,
        enviadoAt: estado === EST.AVISADO ? new Date().toISOString() : null,
        nota: estado === EST.ERROR ? (env.error || 'fallo de envío')
          : `Conductor resuelto con un log de ${humanizar(r.ventanaSeg)} antes del exceso` });
      res.detalle.push({ matricula: a.matricula, conductor: nombre, estado });
    }
  } catch (e) {
    res.error = e.message;
    console.error('❌ [VELOCIDAD] procesar:', e.stack || e.message);
  } finally {
    _corriendo = false;
    _ultimo = { ts: Date.now(), nuevos: res.nuevas, resumen: res };
  }
  return res;
}

function estadoModulo() {
  return {
    modo: modo(), corriendo: _corriendo, ultimo: _ultimo,
    plantilla: PLANTILLA_ADVERTENCIA,
    // Desde cuándo cuenta el sistema: lo anterior no genera avisos. Se llama
    // `altaSistema` y no `desde` porque la pantalla ya tiene un `desde` —el del
    // rango que se mira— y son cosas distintas: mezclarlos dejaba el rango a
    // null y la pantalla en blanco.
    altaSistema: DESDE_TS ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(DESDE_TS)) : null,
  };
}

module.exports = {
  EST, DESDE_TS, PLANTILLA_ADVERTENCIA,
  procesar, estadoModulo, conductorDeMatricula, mapaVehiculos, modo,
  // La lectura la sirve el repositorio; se reexporta para que las rutas tengan
  // una sola puerta a este módulo.
  porConductor: (...a) => repo.porConductor(...a),
  historico: (...a) => repo.historico(...a),
  resumen: (...a) => repo.resumen(...a),
};
