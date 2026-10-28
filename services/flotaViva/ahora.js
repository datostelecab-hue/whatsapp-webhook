// ============================================================
// EL AHORA DE LA FLOTA — una sola foto para todas las pantallas
// ============================================================
// Qué está haciendo en BOLT cada coche y cada conductor EN ESTE MOMENTO. Lo
// preguntan el mapa (cada 10 s), En directo de Control (cada 10 s el «ahora» de
// sus filas y cada 45 s todo lo demás), el aviso de coches sueltos (cada 30 s)
// y el panel de Flota viva.
//
// Antes cada uno lo calculaba por su lado: tres consultas distintas contra las
// mismas tablas, cada una con su copia de la regla «gana la noticia más
// fresca» y cada una desempatando a su manera. Con los MISMOS datos, el mapa y
// Control decían cosas distintas del mismo conductor (25/09/2026).
//
// ── EL PATRÓN: FUENTE ÚNICA, CACHÉ COMPARTIDA, AVISO AL CAMBIAR ─────────────
//
//   · UNA foto. Dos consultas —coches y conductores— y la regla se aplica UNA
//     vez, aquí. Quien la necesite la pide con `foto()` y la lee por la clave
//     que le convenga (matrícula, unidad de Mapon, conductor).
//
//   · SE REHACE SOLO SI HAY ALGO NUEVO. Quien escribe los datos avisa con
//     `invalidar()` —la ingesta de 10 s cuando entran apuntes, el motor al
//     acabar una vuelta— y la siguiente petición la rehace (patrón observador).
//     Si nadie mira, no se hace nada: es perezosa. Y lleva un tope de 15 s por
//     si algún aviso no llega.
//
//   · UNA CONSULTA A LA VEZ. Si diez pantallas la piden mientras se está
//     haciendo, las diez esperan a esa misma («single-flight»): no se lanzan
//     diez consultas iguales.
//
//   · QUIEN GUARDE ALGO DERIVADO se apunta con `alCambiar(fn)` y se entera en
//     el momento. Es lo que hace el mapa con su foto de posiciones.
//
// ── LA REGLA ────────────────────────────────────────────────────────────────
// Hay dos noticias de lo mismo y ninguna es de fiar siempre:
//
//   · el TRAMO abierto (`fv_ahora`), que construye el motor cada 5 min. Sabe
//     los km y desde cuándo dura la situación, pero si el motor se atasca se
//     queda viejo (el 23/09/2026 estuvo dos horas sin terminar una vuelta);
//   · el ÚLTIMO APUNTE de BOLT (`bolt_state_log`), que entra cada 10 s.
//
// Gana la más reciente por la hora del apunte. Si dicen lo mismo, se queda el
// tramo, que sabe desde cuándo dura. Y dos apuntes en el mismo segundo se
// desempatan con services/flotaViva/desempate.js, la misma regla que el motor.
//
// ── DESDE EL 28/10/2026, PRIMERO LA API v2 ──────────────────────────────────
// Si hay lista fresca de `getOnlineDrivers` (services/flotaViva/enLinea.js),
// el ahora es ESA lista: quien sale en ella está conectado en lo que dice y
// desde cuándo lo dice, y quien no sale, no está conectado. Ya no hay que
// adivinar cuál de las dos noticias es más nueva. Del tramo se queda lo que la
// v2 no sabe: los km, el GPS y quién llevó el coche la última vez. Sin lista
// válida, todo como arriba (el plan B). `fuente` dice cuál de las dos se usó.

const EventEmitter = require('events');
const db = require('./db');
const { normMat } = require('./fuentes');
const { sqlRango } = require('./desempate');
const enLinea = require('./enLinea');

const TOPE_MS = Number(process.env.AHORA_TOPE_MS) || 15000;
const CONECTADO = new Set(['viaje', 'espera', 'descanso']);

// ── Las dos consultas ───────────────────────────────────────────────────────

// Una fila por coche que BOLT conoce (`fv_vehiculo`): el tramo abierto si está
// vigilado (`fv_ahora` solo trae los de fv_matricula activa) y su último
// apunte de las últimas doce horas.
const SQL_COCHES = `
  SELECT a.*,
         v.uuid        AS v_uuid,
         v.matricula   AS v_matricula,
         v.mapon_unit  AS v_unit,
         (a.vehiculo_uuid IS NOT NULL) AS vigilado,
         eb.situacion  AS situacion_cruda,
         s2.etiqueta   AS etiqueta_cruda,
         s2.color      AS color_crudo,
         s2.conectado  AS conectado_crudo,
         cru.ocurrido_at AS crudo_at,
         cru.driver_uuid AS conductor_uuid_crudo,
         cc.nombre     AS conductor_crudo,
         cc.telefono   AS telefono_crudo
    FROM fv_vehiculo v
    LEFT JOIN fv_ahora a ON a.vehiculo_uuid = v.uuid
    LEFT JOIN LATERAL (
      SELECT l.estado, l.ocurrido_at, l.driver_uuid
        FROM bolt_state_log l
        LEFT JOIN fv_estado_bolt e ON e.estado = l.estado
       WHERE l.vehiculo_uuid = v.uuid
         AND l.ocurrido_at > now() - interval '12 hours'
       ORDER BY l.ocurrido_at DESC, ${sqlRango('e.situacion')} DESC, l.id DESC
       LIMIT 1) cru ON TRUE
    LEFT JOIN fv_estado_bolt eb ON eb.estado = cru.estado
    LEFT JOIN fv_cat_situacion s2 ON s2.codigo = eb.situacion
    LEFT JOIN fv_conductor cc ON cc.uuid = cru.driver_uuid`;

// El último apunte de cada conductor en doce horas. Un conductor no es un
// coche: se cambian de coche a diario, y En directo va por persona.
const SQL_CONDUCTORES = `
  SELECT DISTINCT ON (l.driver_uuid)
         l.driver_uuid AS uuid, l.vehiculo_uuid, l.ocurrido_at,
         eb.situacion, s.etiqueta
    FROM bolt_state_log l
    LEFT JOIN fv_estado_bolt eb ON eb.estado = l.estado
    LEFT JOIN fv_cat_situacion s ON s.codigo = eb.situacion
   WHERE l.driver_uuid IS NOT NULL
     AND l.ocurrido_at > now() - interval '12 hours'
   ORDER BY l.driver_uuid, l.ocurrido_at DESC, ${sqlRango('eb.situacion')} DESC, l.id DESC`;

// ── La regla, una sola vez ──────────────────────────────────────────────────

/**
 * La fila de un coche con la noticia más fresca. Devuelve la misma forma que
 * `fv_ahora` —así el panel de Flota viva no ha tenido que cambiar— con
 * `fuente_ahora` diciendo de dónde salió lo que se enseña.
 */
function masFresco(x) {
  if (!x.situacion_cruda || !x.crudo_at) return { ...x, fuente_ahora: x.situacion ? 'tramo' : null };
  const tCrudo = new Date(x.crudo_at).getTime();
  const tTramo = x.desde ? new Date(x.desde).getTime() : null;
  if (tTramo != null && tTramo > tCrudo) return { ...x, fuente_ahora: 'tramo' };   // el motor sabe algo más nuevo
  if (x.situacion_cruda === x.situacion) return { ...x, fuente_ahora: 'tramo' };    // dicen lo mismo: el tramo sabe desde cuándo
  return {
    ...x,
    situacion: x.situacion_cruda,
    situacion_etiqueta: x.etiqueta_cruda || x.situacion_etiqueta,
    color: x.color_crudo || x.color,
    conectado: x.conectado_crudo === true,
    conductor_uuid: x.conductor_uuid_crudo || x.conductor_uuid,
    conductor: x.conductor_crudo || x.conductor,
    telefono: x.telefono_crudo || x.telefono,
    desde: x.crudo_at,
    segundos: Math.max(0, Math.round((Date.now() - tCrudo) / 1000)),
    // Los km y el GPS siguen siendo los del tramo: eso no lo sabe un apunte.
    fuente_ahora: 'apunte',
  };
}

/** Lo mismo para un conductor: su tramo abierto contra su último apunte. */
function conductorMasFresco(tramo, apunte) {
  const de = (x, fuente) => x && ({
    situacion: x.situacion || null, etiqueta: x.etiqueta || null,
    conectado: CONECTADO.has(x.situacion), desde: x.desde,
    vehiculoUuid: x.vehiculoUuid || null, matricula: x.matricula || null, fuente,
  });
  if (!apunte) return de(tramo, 'tramo');
  if (!tramo) return de(apunte, 'apunte');
  if (new Date(tramo.desde) > new Date(apunte.desde)) return de(tramo, 'tramo');
  if (tramo.situacion === apunte.situacion) return de(tramo, 'tramo');
  return de(apunte, 'apunte');
}

/** La fila del coche como la deja la base: identidad del padrón si no está vigilado. */
const filaBase = x => ({ ...x, vehiculo_uuid: x.v_uuid, matricula: x.matricula || x.v_matricula, mapon_unit: x.mapon_unit != null ? x.mapon_unit : x.v_unit });

/** El tramo abierto de cada conductor, tal cual, ANTES de mezclarlo: lo que sabe el motor. */
function apuntaTramo(tramos, base) {
  if (!(base.tramo_id && base.conductor_uuid && base.desde)) return;
  const prev = tramos.get(base.conductor_uuid);
  if (!prev || new Date(base.desde) > new Date(prev.desde)) {
    tramos.set(base.conductor_uuid, {
      situacion: base.situacion, etiqueta: base.situacion_etiqueta, desde: base.desde,
      vehiculoUuid: base.vehiculo_uuid, matricula: base.matricula,
    });
  }
}

function indexa(c, porVehiculo, porMatricula, porUnidad) {
  if (c.vehiculo_uuid) porVehiculo.set(c.vehiculo_uuid, c);
  if (c.matricula) porMatricula.set(normMat(c.matricula), c);
  if (c.mapon_unit != null) porUnidad.set(Number(c.mapon_unit), c);
}

/** El PLAN B: la foto con lo que hay en la base (tramo del motor contra último apunte). */
async function construirBD() {
  const t0 = Date.now();
  const [rc, rd] = await Promise.all([db.consulta(SQL_COCHES), db.consulta(SQL_CONDUCTORES)]);

  const coches = [];
  const porVehiculo = new Map(), porMatricula = new Map(), porUnidad = new Map();
  const tramos = new Map();     // conductor → su tramo abierto (del motor)
  for (const x of rc.rows) {
    // Los que no están vigilados no traen nada de fv_ahora: su identidad sale
    // del padrón de BOLT.
    const base = filaBase(x);
    apuntaTramo(tramos, base);
    const c = masFresco(base);
    coches.push(c);
    indexa(c, porVehiculo, porMatricula, porUnidad);
  }

  const apuntes = new Map(rd.rows.map(x => [x.uuid, {
    situacion: x.situacion, etiqueta: x.etiqueta, desde: x.ocurrido_at,
    vehiculoUuid: x.vehiculo_uuid,
    matricula: (porVehiculo.get(x.vehiculo_uuid) || {}).matricula || null,
  }]));
  const porConductor = new Map();
  new Set([...apuntes.keys(), ...tramos.keys()]).forEach(uuid => {
    const c = conductorMasFresco(tramos.get(uuid), apuntes.get(uuid));
    if (c) porConductor.set(uuid, { uuid, ...c });
  });

  return { at: new Date(), ms: Date.now() - t0, fuente: 'bd', coches, porVehiculo, porMatricula, porUnidad, porConductor };
}

// ── Con la API v2 ───────────────────────────────────────────────────────────

// Solo el tramo abierto (km, GPS, último conductor): lo que la v2 no sabe. Sin
// el último apunte de cada coche, que era la consulta cara.
const SQL_TRAMOS = `
  SELECT a.*,
         v.uuid        AS v_uuid,
         v.matricula   AS v_matricula,
         v.mapon_unit  AS v_unit,
         (a.vehiculo_uuid IS NOT NULL) AS vigilado
    FROM fv_vehiculo v
    LEFT JOIN fv_ahora a ON a.vehiculo_uuid = v.uuid`;
const SQL_CATALOGO = `SELECT codigo, etiqueta, color, conectado, orden FROM fv_cat_situacion`;

const segundosDesde = (desde, ahoraMs) =>
  (desde ? Math.max(0, Math.round((ahoraMs - new Date(desde).getTime()) / 1000)) : null);

/** El coche que la v2 da conectado: la situación, el conductor y el desde, de BOLT. */
function conLaV2(x, d, cat, ahoraMs) {
  const s = cat.get(d.situacion) || {};
  // Si es la misma persona que en el tramo, se queda el nombre de la casa.
  const mismo = x.conductor_uuid === d.uuid;
  return {
    ...x,
    situacion: d.situacion,
    situacion_etiqueta: s.etiqueta || d.situacion,
    color: s.color || x.color,
    conectado: s.conectado !== false,
    situacion_orden: s.orden != null ? s.orden : x.situacion_orden,
    estado_bolt: d.estadoBolt,
    conductor_uuid: d.uuid,
    conductor: (mismo && x.conductor) || d.nombre || x.conductor,
    telefono: (mismo && x.telefono) || d.telefono || x.telefono,
    desde: d.desde,
    segundos: segundosDesde(d.desde, ahoraMs),
    // Los km y el GPS siguen siendo los del tramo: eso no lo sabe la v2.
    fuente_ahora: 'v2',
  };
}

/**
 * El coche que la v2 NO da conectado. Si el tramo ya dice «desconectado», se
 * queda el tramo, que sabe desde cuándo. Si el tramo dice que rueda en BOLT, el
 * motor aún no se ha enterado (va cada 5 min): desconectado desde la última vez
 * que la v2 lo vio, y si no lo vio desde que arrancó, sin hora.
 */
function sinConexion(x, v2, cat, ahoraMs) {
  const visto = x.vehiculo_uuid ? v2.visto.vehiculo.get(x.vehiculo_uuid) : null;
  const tramoConectado = !!x.situacion && x.situacion !== 'desconectado';
  // Sin tramo (no vigilado) y nunca visto: no sabemos nada, como con la base.
  if (!tramoConectado && !(visto && !x.situacion)) return { ...x, fuente_ahora: x.situacion ? 'tramo' : null };
  const s = cat.get('desconectado') || {};
  const desde = visto ? new Date(visto.at) : null;
  return {
    ...x,
    situacion: 'desconectado',
    situacion_etiqueta: s.etiqueta || 'Desconectado',
    color: s.color || x.color,
    conectado: false,
    situacion_orden: s.orden != null ? s.orden : x.situacion_orden,
    estado_bolt: null,
    // Quien lo llevaba al desconectarse: el mapa explica el rojo con él.
    conductor_uuid: (visto && visto.conductorUuid) || x.conductor_uuid,
    conductor: (visto && visto.conductorUuid !== x.conductor_uuid && visto.nombre) || x.conductor,
    telefono: (visto && visto.conductorUuid !== x.conductor_uuid && visto.telefono) || x.telefono,
    desde,
    segundos: segundosDesde(desde, ahoraMs),
    fuente_ahora: 'v2',
  };
}

async function construirV2(v2) {
  const t0 = Date.now();
  const [rc, rk] = await Promise.all([db.consulta(SQL_TRAMOS), db.consulta(SQL_CATALOGO)]);
  const cat = new Map(rk.rows.map(x => [x.codigo, x]));
  const ahoraMs = Date.now();

  const coches = [];
  const porVehiculo = new Map(), porMatricula = new Map(), porUnidad = new Map();
  const tramos = new Map();
  for (const x of rc.rows) {
    const base = filaBase(x);
    apuntaTramo(tramos, base);
    const d = v2.porVehiculo.get(base.vehiculo_uuid) || (base.matricula && v2.porMatricula.get(normMat(base.matricula)));
    const c = d ? conLaV2(base, d, cat, ahoraMs) : sinConexion(base, v2, cat, ahoraMs);
    coches.push(c);
    indexa(c, porVehiculo, porMatricula, porUnidad);
  }
  // Un coche conectado que aún no está en el padrón de BOLT (`fv_vehiculo`, se
  // refresca cada hora): el mapa lo encuentra por la matrícula igualmente.
  v2.porUuid.forEach(d => {
    if (!d.matricula || porMatricula.has(normMat(d.matricula))) return;
    const c = conLaV2({ vehiculo_uuid: d.vehiculoUuid, matricula: d.matricula, vigilado: false }, d, cat, ahoraMs);
    coches.push(c);
    indexa(c, porVehiculo, porMatricula, porUnidad);
  });

  // Por conductor: los de la lista, conectados; los demás que conocemos (por su
  // tramo o porque la v2 los vio antes), desconectados.
  const porConductor = new Map();
  v2.porUuid.forEach(d => {
    const coche = (d.vehiculoUuid && porVehiculo.get(d.vehiculoUuid)) || null;
    porConductor.set(d.uuid, {
      uuid: d.uuid, situacion: d.situacion, etiqueta: (cat.get(d.situacion) || {}).etiqueta || d.situacion,
      conectado: CONECTADO.has(d.situacion), desde: d.desde,
      vehiculoUuid: d.vehiculoUuid, matricula: (coche && coche.matricula) || d.matricula, fuente: 'v2',
    });
  });
  const etqDesc = (cat.get('desconectado') || {}).etiqueta || 'Desconectado';
  tramos.forEach((t, uuid) => {
    if (porConductor.has(uuid)) return;
    if (t.situacion === 'desconectado') { porConductor.set(uuid, { uuid, ...t, conectado: false, fuente: 'tramo' }); return; }
    const visto = v2.visto.conductor.get(uuid);
    porConductor.set(uuid, {
      uuid, situacion: 'desconectado', etiqueta: etqDesc, conectado: false,
      desde: visto ? new Date(visto.at) : null,
      vehiculoUuid: t.vehiculoUuid, matricula: t.matricula, fuente: 'v2',
    });
  });
  v2.visto.conductor.forEach((visto, uuid) => {
    if (porConductor.has(uuid)) return;
    porConductor.set(uuid, {
      uuid, situacion: 'desconectado', etiqueta: etqDesc, conectado: false, desde: new Date(visto.at),
      vehiculoUuid: visto.vehiculoUuid, matricula: visto.matricula, fuente: 'v2',
    });
  });

  return {
    at: new Date(), ms: Date.now() - t0, fuente: 'v2', v2At: v2.at,
    coches, porVehiculo, porMatricula, porUnidad, porConductor,
  };
}

/** La foto: con la v2 si hay lista válida; si no, con la base. */
function construir() {
  const v2 = enLinea.vigente();
  return v2 ? construirV2(v2) : construirBD();
}

// ── La caché, el «single-flight» y los avisos ───────────────────────────────

const bus = new EventEmitter();
bus.setMaxListeners(50);
let version = 0;             // sube con cada aviso de que algo ha cambiado
let actual = null;           // { foto, version, t }
let enCurso = null;          // la construcción en marcha, si la hay
let construidas = 0;

/**
 * La foto del ahora. Si la guardada sigue valiendo, esa; si se está haciendo
 * una, la misma; si no, se hace. Nunca hay dos a la vez.
 */
function foto() {
  if (actual && actual.version === version && Date.now() - actual.t < TOPE_MS) return Promise.resolve(actual.foto);
  if (enCurso) return enCurso;
  const v = version;
  enCurso = construir()
    .then(f => { actual = { foto: f, version: v, t: Date.now() }; construidas++; return f; })
    .finally(() => { enCurso = null; });
  return enCurso;
}

/**
 * Algo ha cambiado: la foto guardada ya no vale. No se rehace aquí —si nadie
 * mira, no hace falta—; se rehace en la siguiente petición.
 */
function invalidar(motivo) {
  version++;
  bus.emit('cambio', motivo || '');
}

/** Para quien guarde algo hecho con la foto: se le avisa al cambiar. Devuelve cómo darse de baja. */
function alCambiar(fn) {
  bus.on('cambio', fn);
  return () => bus.off('cambio', fn);
}

/** Para diagnosticar sin abrir la base. */
const estado = () => ({
  version, construidas, enCurso: !!enCurso,
  vigente: !!(actual && actual.version === version && Date.now() - actual.t < TOPE_MS),
  ultima: actual ? { at: actual.foto.at, ms: actual.foto.ms, fuente: actual.foto.fuente, coches: actual.foto.coches.length, conductores: actual.foto.porConductor.size } : null,
  v2: enLinea.estado(),
});

module.exports = { foto, invalidar, alCambiar, estado, masFresco, CONECTADO };
