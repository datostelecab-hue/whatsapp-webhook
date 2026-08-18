/**
 * Alertas de Mapon para el departamento de Operaciones.
 *
 * Mapon NO tiene webhook: sus canales de entrega son email, SMS y pop-up en su
 * plataforma. La única forma de traerse los eventos es consultarlos con
 * alert/list.json, que devuelve lo YA disparado por los setups configurados en
 * Mapon (los de la cuenta se ven con listarSetups()).
 *
 * El setup de exceso de velocidad está a 130 km/h, así que todo lo que pase de
 * 150 ya viene incluido en la respuesta; el umbral de aquí solo marca cuáles
 * son graves, NO hace falta tocar la configuración de Mapon para cambiarlo.
 *
 * Este servicio es la única puerta a la API de Mapon del módulo: cuando se
 * añada el aviso por WhatsApp, el cron llamará a leerAlertas() igual que la
 * pantalla, sin duplicar la lógica de normalización.
 */

const API = 'https://mapon.com/api/v1';

// La clave vive en la variable de entorno MAPON_API_KEY (Render). Ya no se guarda
// en el código: si falta, las alertas de Mapon simplemente no se piden.
const KEY = process.env.MAPON_API_KEY || '';

// Velocidad a partir de la cual una alerta se considera grave (la que en su día
// disparará el aviso por WhatsApp). Ajustable sin tocar código.
const UMBRAL = Number(process.env.MAPON_UMBRAL_VELOCIDAD || 150);

// Tipos de alerta que la cuenta tiene habilitados (alert/setup_types.json), con
// su presentación. Si Mapon devuelve uno que no esté aquí se pinta igualmente
// con el texto que manda la propia API.
const TIPOS = {
  speeding:       { titulo: 'Exceso de velocidad',      icono: 'fa-gauge-high' },
  in_object:      { titulo: 'Entrada/Salida de zona',   icono: 'fa-location-dot' },
  no_power:       { titulo: 'Alimentación OFF',         icono: 'fa-plug-circle-xmark' },
  supply_voltage: { titulo: 'Voltaje de suministro',    icono: 'fa-car-battery' },
  battery_level:  { titulo: 'Nivel de batería',         icono: 'fa-battery-quarter' },
  moving:         { titulo: 'Vehículo en movimiento',   icono: 'fa-car-side' }
};

// Límites de la API de Mapon: ventana máxima de 31 días y 150 resultados por
// página. El tope de páginas evita que un rango largo dispare 25 peticiones
// seguidas (la cuenta admite 5 concurrentes).
const MAX_DIAS = 31;
const POR_PAGINA = 150;
const MAX_PAGINAS = 10;

const ZONA = 'Europe/Madrid';

const txt = v => String(v == null ? '' : v).trim();

// ============================================================
// FECHAS
// ============================================================

/** Interpreta dd/mm/aaaa (o aaaa-mm-dd) y devuelve un Date, o null. */
function parseFecha(s) {
  const t = txt(s);
  if (!t) return null;
  let d, mes, a;
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    d = +m[1]; mes = +m[2]; a = +(m[3].length === 2 ? '20' + m[3] : m[3]);
  } else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    a = +m[1]; mes = +m[2]; d = +m[3];
  } else {
    return null;
  }
  const fecha = new Date(a, mes - 1, d);
  if (fecha.getFullYear() !== a || fecha.getMonth() !== mes - 1 || fecha.getDate() !== d) {
    return null;   // día/mes inexistente (p. ej. 32/13)
  }
  return fecha;
}

/** Date → 'aaaa-mm-ddTHH:MM:SSZ', que es el formato que exige Mapon. */
function aUTC(fecha) {
  return fecha.toISOString().slice(0, 19) + 'Z';
}

/**
 * Los eventos llegan en UTC pero Operaciones los mira en hora peninsular, que
 * en verano va +2. Se parte el formateo en fecha y hora porque la pantalla las
 * muestra en columnas separadas.
 */
function enLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { fecha: '', hora: '', orden: 0 };
  const partes = new Intl.DateTimeFormat('es-ES', {
    timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  return {
    fecha: `${partes.day}/${partes.month}/${partes.year}`,
    hora: `${partes.hour}:${partes.minute}`,
    orden: d.getTime()
  };
}

// ============================================================
// UNIDADES (unit_id → matrícula)
// ============================================================
// Las alertas solo traen unit_id; la matrícula está en unit/list.json. Son 144
// unidades y cambian de Pascuas a Ramos, así que se cachean 10 minutos en vez
// de pedirlas en cada consulta.

let cacheUnidades = { ts: 0, mapa: new Map() };
const TTL_UNIDADES = 10 * 60 * 1000;

async function unidades() {
  if (cacheUnidades.mapa.size && Date.now() - cacheUnidades.ts < TTL_UNIDADES) {
    return cacheUnidades.mapa;
  }
  const r = await fetch(`${API}/unit/list.json?key=${KEY}`);
  const json = await r.json();
  const lista = (json && json.data && json.data.units) || [];
  if (!lista.length && cacheUnidades.mapa.size) return cacheUnidades.mapa;   // fallo puntual: se sigue con lo anterior

  const mapa = new Map();
  lista.forEach(u => {
    mapa.set(u.unit_id, {
      matricula: txt(u.number) || txt(u.label) || `#${u.unit_id}`,
      vehiculo: [txt(u.make), txt(u.model)].filter(Boolean).join(' ') || txt(u.label) || 'Vehículo'
    });
  });
  cacheUnidades = { ts: Date.now(), mapa };
  console.log(`🛰️  [MAPON] Padrón de unidades actualizado: ${mapa.size}`);
  return mapa;
}

// ============================================================
// NORMALIZACIÓN DE EVENTOS
// ============================================================

/**
 * alert_val cambia de forma según el tipo: en speeding y no_power es un JSON
 * metido dentro de un string, y en in_object es 'Zona|IN'. Se devuelve siempre
 * un objeto para que quien lo use no tenga que saber de qué tipo venía.
 */
function parseValor(alertVal) {
  const t = txt(alertVal);
  if (!t) return {};
  if (t.startsWith('{')) {
    try { return JSON.parse(t); } catch (e) { return {}; }
  }
  const trozos = t.split('|');
  return { zona: trozos[0] || '', sentido: trozos[1] || '' };
}

/**
 * 'alta'   → llega o supera el umbral (candidata al aviso por WhatsApp)
 * 'media'  → se pasa del límite en 10 km/h o más
 * 'baja'   → el resto de excesos y los demás tipos de alerta
 */
function severidad(tipo, velocidad, limite) {
  if (tipo !== 'speeding') return 'baja';
  if (velocidad >= UMBRAL) return 'alta';
  if (limite && velocidad - limite >= 10) return 'media';
  return 'baja';
}

function normalizar(evento, mapaUnidades) {
  const val = parseValor(evento.alert_val);
  const unidad = mapaUnidades.get(evento.unit_id) || {};
  const { fecha, hora, orden } = enLocal(evento.time);
  const tipo = txt(evento.alert_type);

  const velocidad = Number(val.speed) || null;
  const limite = Number(val.speed_limit) || null;

  return {
    // Los eventos NO traen id propio, así que la clave única es unidad + hora +
    // tipo. Es lo que evitará repetir avisos cuando el cron consulte con solape.
    id: `${evento.unit_id}|${evento.time}|${tipo}`,
    unitId: evento.unit_id,
    matricula: unidad.matricula || `#${evento.unit_id}`,
    vehiculo: unidad.vehiculo || '—',
    tipo,
    tipoTitulo: (TIPOS[tipo] && TIPOS[tipo].titulo) || tipo,
    icono: (TIPOS[tipo] && TIPOS[tipo].icono) || 'fa-circle-exclamation',
    fecha,
    hora,
    orden,
    iso: evento.time,
    velocidad,
    limite,
    exceso: velocidad && limite ? velocidad - limite : null,
    zona: val.zona || null,
    sentido: val.sentido || null,
    severidad: severidad(tipo, velocidad, limite),
    msg: txt(evento.msg)
  };
}

// ============================================================
// LECTURA DE ALERTAS
// ============================================================

/**
 * Trae las alertas disparadas en un rango.
 *
 *   desde / hasta  Date o texto dd/mm/aaaa. Por defecto, los últimos 7 días.
 *   tipo           'speeding', 'no_power'… o vacío para todas.
 *
 * Devuelve { alertas, total, umbral, desde, hasta, truncado } ordenado de más
 * reciente a más antiguo. `truncado` avisa de que había más páginas de las que
 * se piden, para no dar por completa una lista que no lo está.
 */
async function leerAlertas({ desde, hasta, tipo } = {}) {
  const fin = (desde || hasta) ? (parseFecha(hasta) || new Date()) : new Date();
  // El día final se toma completo: si Operaciones pide "hasta hoy", entran las
  // alertas de esta misma tarde y no solo las de hasta las 00:00.
  if (hasta) fin.setHours(23, 59, 59, 0);

  let ini = parseFecha(desde);
  if (!ini) { ini = new Date(fin); ini.setDate(ini.getDate() - 7); }
  ini.setHours(0, 0, 0, 0);

  if (ini > fin) throw new Error('La fecha inicial es posterior a la final');
  const dias = Math.round((fin - ini) / 86400000);
  if (dias > MAX_DIAS) throw new Error(`Mapon solo permite consultar ${MAX_DIAS} días seguidos (has pedido ${dias})`);

  const mapaUnidades = await unidades();

  const base = `${API}/alert/list.json?key=${KEY}`
    + `&from=${encodeURIComponent(aUTC(ini))}&till=${encodeURIComponent(aUTC(fin))}`
    + `&limit=${POR_PAGINA}`
    + (tipo ? `&alert_type=${encodeURIComponent(tipo)}` : '');

  const alertas = [];
  let pagina = 1, totalPaginas = 1, total = 0;

  while (pagina <= totalPaginas && pagina <= MAX_PAGINAS) {
    const r = await fetch(`${base}&page=${pagina}`);
    const json = await r.json();

    if (json && json.error) {
      throw new Error(`Mapon: ${json.error.msg || json.error.text || 'error desconocido'}`);
    }

    (json.data || []).forEach(e => alertas.push(normalizar(e, mapaUnidades)));

    const meta = json._meta || {};
    totalPaginas = Number(meta.total_pages) || 1;
    total = Number(meta.total) || alertas.length;
    pagina++;
  }

  alertas.sort((a, b) => b.orden - a.orden);

  return {
    alertas,
    total,
    umbral: UMBRAL,
    desde: aUTC(ini),
    hasta: aUTC(fin),
    truncado: totalPaginas > MAX_PAGINAS
  };
}

/**
 * Excesos que llegan al umbral (150 por defecto). Es lo que consumirá el cron
 * del aviso por WhatsApp cuando se monte esa parte.
 */
async function leerExcesosGraves(rango = {}) {
  const r = await leerAlertas({ ...rango, tipo: 'speeding' });
  return { ...r, alertas: r.alertas.filter(a => a.velocidad >= UMBRAL) };
}

// ============================================================
// AUDITORÍA DE FLOTA (Operaciones): km diarios y combustible
// ============================================================

/** ISO UTC → clave de día en hora peninsular ('aaaa-mm-dd', ordena bien como texto). */
function diaLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

/** Resuelve el rango desde/hasta igual que leerAlertas (día final completo, tope 31 días). */
function resolverRango({ desde, hasta } = {}, porDefectoDias = 7) {
  const fin = (desde || hasta) ? (parseFecha(hasta) || new Date()) : new Date();
  if (hasta) fin.setHours(23, 59, 59, 0);
  let ini = parseFecha(desde);
  if (!ini) { ini = new Date(fin); ini.setDate(ini.getDate() - porDefectoDias); }
  ini.setHours(0, 0, 0, 0);
  if (ini > fin) throw new Error('La fecha inicial es posterior a la final');
  const dias = Math.round((fin - ini) / 86400000);
  if (dias > MAX_DIAS) throw new Error(`Mapon solo permite consultar ${MAX_DIAS} días seguidos (has pedido ${dias})`);
  return { ini, fin };
}

/** GET a la API de Mapon con control del formato de error {error:{code,msg}}. */
async function pedir(ruta, params) {
  const r = await fetch(`${API}/${ruta}?key=${KEY}&${params}`);
  const json = await r.json();
  if (json && json.error) {
    throw new Error(`Mapon (${ruta}): ${json.error.msg || json.error.code || 'error desconocido'}`);
  }
  return json;
}

/**
 * POST a la API de Mapon (endpoints de escritura: driver/create, driver/update…).
 *
 * Los parámetros se mandan A LA VEZ en la query y en el cuerpo: la documentación de
 * Mapon los describe siempre como parámetros de la petición sin precisar dónde, y
 * según el endpoint lee unos u otros. Mandando ambos funciona en los dos casos.
 * El error se propaga con el cuerpo crudo, que es lo único que permite diagnosticar
 * (p. ej. una clave sin permiso de escritura).
 */
async function pedirPost(ruta, params) {
  const qs = new URLSearchParams({ key: KEY });
  const body = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined) return;
    const val = v === null ? '' : String(v);
    qs.append(k, val);
    body.append(k, val);
  });
  const r = await fetch(`${API}/${ruta}?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (e) { /* respuesta no-JSON: se ve en el error */ }
  if (!json) throw new Error(`Mapon (${ruta}) HTTP ${r.status}: ${texto.slice(0, 200)}`);
  if (json.error) {
    const e = json.error;
    throw new Error(`Mapon (${ruta}) error ${e.code || '?'}: ${e.msg || e.text || JSON.stringify(e)}`);
  }
  return json;
}

// ── Conductores en Mapon (para enlazar quién lleva cada coche) ────────────────

const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Busca una unidad por matrícula en el padrón cacheado. Devuelve {unitId,...} o null. */
async function unidadPorMatricula(matricula) {
  const buscada = normMat(matricula);
  if (!buscada) return null;
  const mapa = await unidades();
  for (const [unitId, info] of mapa) {
    if (normMat(info.matricula) === buscada) return { unitId, ...info };
  }
  return null;
}

/** Todos los conductores dados de alta en Mapon. */
async function listarConductores() {
  const j = await pedir('driver/list.json', '');
  const d = j && j.data;
  return (d && (d.drivers || (Array.isArray(d) ? d : null))) || [];
}

/** Crea un conductor. Mapon exige nombre Y apellidos. Devuelve su id. */
async function crearConductor({ nombre, apellidos, telefono, unitId }) {
  const j = await pedirPost('driver/create.json', {
    name: nombre, surname: apellidos || '-', phone: telefono || undefined,
    unit: unitId || undefined
  });
  const d = (j && j.data) || {};
  const id = d.driver_id || d.id || (d.driver && (d.driver.id || d.driver.driver_id)) || null;
  // Si Mapon dijo OK pero no encontramos el id, es que la respuesta tiene otra forma:
  // hay que verla, porque el conductor SÍ se ha creado y así no lo sabríamos.
  if (!id) throw new Error(`Mapon creó el conductor pero no reconozco su id en: ${JSON.stringify(j).slice(0, 200)}`);
  return id;
}

/** Asigna el coche al conductor (lo que hace visible su nombre en la unidad). */
const asignarConductor = (driverId, unitId) => pedirPost('driver/update.json', { driver_id: driverId, unit: unitId });

/** Le quita el coche (unit vacío = desasignar, según la doc de Mapon). */
const desasignarConductor = driverId => pedirPost('driver/update.json', { driver_id: driverId, unit: '' });

/**
 * Unidad que Mapon tiene asignada AHORA a un conductor, o null. Se necesita para
 * poder DEVOLVERLE su coche al terminar el turno: driver/update con `unit` mueve al
 * conductor, así que sin esto un fichaje de prueba dejaría a un conductor real sin
 * el vehículo que tenía puesto.
 */
async function unidadDeConductor(driverId) {
  if (!driverId) return null;
  const j = await pedir('unit/list.json', 'include=drivers');
  const id = String(driverId);
  for (const u of (j.data && j.data.units) || []) {
    const d = u.drivers || {};
    for (const k of ['driver1', 'driver2']) {
      const dr = d[k];
      if (dr && String(dr.id) === id) return { unitId: u.unit_id, matricula: txt(u.number), plaza: k };
    }
  }
  return null;
}

/** Conductores que Mapon tiene asignados AHORA a una unidad (include=drivers). */
async function conductoresDeUnidad(unitId) {
  const j = await pedir('unit/list.json', `unit_id=${encodeURIComponent(unitId)}&include=drivers`);
  const u = ((j.data && j.data.units) || [])[0] || {};
  return u.drivers || {};
}

/**
 * Relés instalados en la flota (include=relays). Es lo PRIMERO que hay que mirar antes
 * de plantearse cualquier corte de motor: si el vehículo no lleva el relé físico, la
 * lista viene vacía y no hay nada que activar por API.
 *
 * De cada relé interesa: `type` ('engine_block' = corte de motor), `relay_state` (si
 * está activo AHORA), `enabled` y `control_while_moving` (si el equipo permite o no
 * accionarlo en marcha — Mapon rechaza el corte con el coche en movimiento).
 */
async function relesDeFlota() {
  const j = await pedir('unit/list.json', incluir('relays', 'ignition'));
  const unidades = (j.data && j.data.units) || [];
  const filas = unidades.map(u => ({
    unitId: u.unit_id,
    matricula: txt(u.number) || `#${u.unit_id}`,
    estado: (u.state && u.state.name) || '',
    reles: (u.relays || []).map(r => ({
      relay_id: r.relay_id, tipo: r.type, titulo: txt(r.title),
      activo: r.relay_state, habilitado: r.enabled,
      invertido: r.inverted, controlEnMarcha: r.control_while_moving
    }))
  }));
  const conRele = filas.filter(f => f.reles.length);
  const conCorte = filas.filter(f => f.reles.some(r => r.tipo === 'engine_block'));
  return {
    totalVehiculos: filas.length,
    conAlgunRele: conRele.length,
    conCorteDeMotor: conCorte.length,
    // Si esto sale 0, la respuesta a "¿podemos bloquear el motor?" es NO por hardware.
    veredicto: conCorte.length
      ? `${conCorte.length} de ${filas.length} vehículos tienen relé de corte de motor`
      : 'NINGÚN vehículo reporta relé de corte de motor: haría falta instalarlo',
    vehiculos: conRele.length ? conRele : filas.slice(0, 10)
  };
}

// ── Corte de motor (relé) ─────────────────────────────────────────────────────
// El parámetro `include` de Mapon se manda como ARRAY (include[]=a&include[]=b). Con
// varios valores separados por comas no los interpreta y devuelve la unidad SIN esos
// bloques — que parece "no tiene relés" cuando en realidad no se los hemos pedido bien.
const incluir = (...vals) => vals.filter(Boolean).map(v => `include[]=${encodeURIComponent(v)}`).join('&');
// OJO: unit/change_relay solo confirma que la ORDEN salió, no que el relé cambiara.
// Para saber el estado real hay que volver a leer unit/list con include=relays; por eso
// todas las operaciones de aquí confirman después.

/** Relés y estado de marcha de UNA unidad. */
async function relesDeUnidad(unitId) {
  const j = await pedir('unit/list.json', `unit_id=${encodeURIComponent(unitId)}&${incluir('relays', 'ignition')}`);
  const u = ((j.data && j.data.units) || [])[0];
  if (!u) return null;
  return {
    unitId: u.unit_id, matricula: txt(u.number),
    estado: (u.state && u.state.name) || '',            // driving / standing / nodata…
    enMarcha: (u.state && u.state.name) === 'driving',
    velocidad: Number(u.speed) || 0,
    reles: (u.relays || []).map(r => ({
      relay_id: r.relay_id, tipo: r.type, titulo: txt(r.title),
      estado: r.relay_state, habilitado: r.enabled,
      invertido: r.inverted, controlEnMarcha: r.control_while_moving
    }))
  };
}

/**
 * Volcado CRUDO de una unidad probando varias formas de pedir los extras, para saber
 * si el vehículo de verdad no tiene relé o es que no lo estamos pidiendo bien. Devuelve
 * las claves que trae cada variante, sin interpretar nada.
 */
async function crudoUnidad(unitId) {
  const variantes = {
    'include[]=relays': `unit_id=${encodeURIComponent(unitId)}&include[]=relays`,
    'include=relays': `unit_id=${encodeURIComponent(unitId)}&include=relays`,
    'include[]=relays&include[]=io_din': `unit_id=${encodeURIComponent(unitId)}&include[]=relays&include[]=io_din`,
    'sin include': `unit_id=${encodeURIComponent(unitId)}`
  };
  const out = {};
  for (const [etiqueta, params] of Object.entries(variantes)) {
    try {
      const j = await pedir('unit/list.json', params);
      const u = ((j.data && j.data.units) || [])[0] || {};
      out[etiqueta] = {
        claves: Object.keys(u),
        relays: u.relays !== undefined ? u.relays : '(ausente)',
        io_din: u.io_din !== undefined ? u.io_din : '(ausente)'
      };
    } catch (e) { out[etiqueta] = { error: e.message }; }
  }
  // Los comandos remotos son la OTRA vía posible de corte de motor (connected-car).
  try {
    const j = await pedir('unit_commands/get_available.json', `unit_id=${encodeURIComponent(unitId)}`);
    out.comandosDisponibles = j.data || j;
  } catch (e) { out.comandosDisponibles = { error: e.message }; }
  return out;
}

/** El relé de corte de motor de una unidad (o el primero que haya), o null. */
const releDeCorte = info => !info ? null
  : (info.reles.find(r => r.tipo === 'engine_block') || info.reles[0] || null);

/**
 * Manda la orden de cambio de relé.
 *
 * `unit/change_relay` es un método RESTRINGIDO: si la clave no lo tiene habilitado,
 * Mapon responde 1006 "Method not available" (no es un fallo del coche ni de los
 * parámetros). Solo lo puede activar el soporte de Mapon sobre la API key.
 */
async function cambiarRele({ unitId, relayId, estado }) {
  try {
    return await pedirPost('unit/change_relay.json', { unit_id: unitId, relay_id: relayId, relay_state: estado ? 1 : 0 });
  } catch (e) {
    if (/1006|method not available/i.test(e.message)) {
      throw new Error('La API key NO tiene habilitado el corte de motor (unit/change_relay, error 1006 "Method not available"). ' +
        'Hay que pedirle a soporte de Mapon que active ese método para la clave; desde la app sí funciona porque usa otra vía.');
    }
    throw e;
  }
}

/**
 * Prueba el cambio de relé por POST y por GET y devuelve QUÉ respondió cada uno, sin
 * interpretar. Sirve para distinguir tres cosas que se confunden:
 *   · "Invalid request path"  → la ruta está mal escrita (no es el caso si sale 1006)
 *   · error de parámetros      → mandamos mal los datos
 *   · 1006 "Method not available" → la ruta existe y los datos están bien, pero la
 *     clave NO tiene permiso para ese método (es lo que hay que resolver en Mapon)
 */
async function probarRele({ unitId, relayId, estado }) {
  const params = { unit_id: unitId, relay_id: relayId, relay_state: estado ? 1 : 0 };
  const out = {};
  try { out.POST = { ok: true, respuesta: await pedirPost('unit/change_relay.json', params) }; }
  catch (e) { out.POST = { ok: false, error: e.message }; }
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  try { out.GET = { ok: true, respuesta: await pedir('unit/change_relay.json', qs) }; }
  catch (e) { out.GET = { ok: false, error: e.message }; }
  // Una ruta inventada, como control: si ESTA da un error distinto al de change_relay,
  // confirma que change_relay existe de verdad y que el problema es de permiso.
  try { out.rutaInventada = { ok: true, respuesta: await pedir('unit/no_existe_de_verdad.json', '') }; }
  catch (e) { out.rutaInventada = { ok: false, error: e.message }; }
  return out;
}

/**
 * Cambia el relé y CONFIRMA leyendo el estado real. Devuelve
 * { ok, antes, despues, confirmado, intentos }. `ok:false` con `confirmado:false`
 * significa que la orden salió pero el equipo no la aplicó (sin cobertura, p. ej.).
 */
async function cambiarReleConfirmado({ unitId, relayId, estado, intentos = 5, esperaMs = 2000 }) {
  const previo = await relesDeUnidad(unitId);
  const rPrev = (previo && previo.reles.find(r => String(r.relay_id) === String(relayId))) || null;
  await cambiarRele({ unitId, relayId, estado });
  for (let i = 1; i <= intentos; i++) {
    await new Promise(r => setTimeout(r, esperaMs));
    const ahora = await relesDeUnidad(unitId);
    const rAhora = (ahora && ahora.reles.find(x => String(x.relay_id) === String(relayId))) || null;
    if (rAhora && !!rAhora.estado === !!estado) {
      return { ok: true, confirmado: true, intentos: i, antes: rPrev, despues: rAhora };
    }
    if (i === intentos) return { ok: false, confirmado: false, intentos: i, antes: rPrev, despues: rAhora };
  }
}

/**
 * Km recorridos por una unidad en una ventana, y cuántos de esos trayectos vienen
 * ya atribuidos a un conductor por la propia Mapon (include=driver_id). Lo segundo
 * es la comprobación de si Mapon SELLA el conductor en el histórico o lo resuelve
 * al vuelo: hasta saberlo, la atribución buena es la de nuestro libro de turnos.
 */
async function kmEnVentana({ unitId, fromTs, tillTs }) {
  const j = await pedir('route/list.json',
    `from=${encodeURIComponent(aUTC(new Date(fromTs * 1000)))}` +
    `&till=${encodeURIComponent(aUTC(new Date(tillTs * 1000)))}` +
    `&unit_id=${encodeURIComponent(unitId)}&include=driver_id`);
  const u = ((j.data && j.data.units) || [])[0] || {};
  let metros = 0, trayectos = 0, conConductor = 0;
  const driversVistos = new Set();
  (u.routes || []).forEach(rt => {
    if (rt.type !== 'route') return;
    metros += Number(rt.distance) || 0;
    trayectos++;
    const d = Number(rt.driver_id) || 0;
    if (d > 0) { conConductor++; driversVistos.add(d); }
  });
  return { km: Math.round(metros / 100) / 10, trayectos, conConductor, drivers: [...driversVistos] };
}

/**
 * Como kmEnVentana pero RECORTANDO al intervalo. route/list devuelve ENTERO
 * cualquier trayecto que toque la ventana, así que un tramo de conducción que
 * venía de antes contaba completo (caso 0348MMZ: "60,7 km en descanso" que en
 * realidad eran de toda la mañana; Mapon daba ~2 km reales tras las 11:41).
 * Aquí un trayecto solo aporta los metros de sus puntos GPS que caen dentro de
 * [fromTs, tillTs]:
 *   · trayecto entero dentro  → su odómetro Mapon (más fiel que la traza);
 *   · trayecto que cruza      → suma haversine de los segmentos interiores;
 *   · sin traza (raro)        → solo cuenta si EMPEZÓ dentro de la ventana.
 */
function haversineKmMapon(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dlat = r(b.lat - a.lat), dln = r(b.lng - a.lng);
  const q = Math.sin(dlat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

async function kmEnVentanaExacto({ unitId, fromTs, tillTs }) {
  const { trips } = await leerRecorridoUnidad({ unitId, fromTs, tillTs });
  let km = 0, trayectos = 0;
  for (const tr of trips) {
    const pts = tr.puntos || [];
    if (!pts.length) {
      if (tr.inicioTs != null && tr.inicioTs >= fromTs && tr.inicioTs <= tillTs) {
        km += (tr.distancia || 0) / 1000;
        if (tr.distancia > 0) trayectos++;
      }
      continue;
    }
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    if (t0 >= fromTs && t1 <= tillTs) {           // entero dentro
      km += (tr.distancia || 0) / 1000;
      if (tr.distancia > 0) trayectos++;
      continue;
    }
    let dentro = 0;                                // cruza el borde: se recorta
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].t >= fromTs && pts[i].t <= tillTs) {
        dentro += haversineKmMapon(pts[i - 1], pts[i]);
      }
    }
    if (dentro > 0.05) trayectos++;
    km += dentro;
  }
  return { km: Math.round(km * 10) / 10, trayectos };
}

/** gmt de Mapon ('Y-m-d H:i:s' o ISO, siempre UTC) → unix segundos. */
function tsUTC(g) {
  let s = String(g == null ? '' : g).trim().replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';   // sin zona → es UTC
  const t = Date.parse(s);
  return isNaN(t) ? null : Math.floor(t / 1000);
}

/**
 * Recorrido punto a punto de UNA unidad (route/list con include=decoded_route).
 * Devuelve sus trayectos con la distancia Mapon (metros) y la traza GPS con hora,
 * para poder repartir cada metro según en qué estado estaba el conductor (BOLT).
 * `decoded_route` solo lo da Mapon pidiendo una única unidad, de ahí una llamada
 * por coche (pesado: se hace en el cron de la auditoría, no en cada consulta).
 *
 *   fromTs / tillTs   unix (segundos), UTC.
 */
async function leerRecorridoUnidad({ unitId, fromTs, tillTs }) {
  const from = aUTC(new Date(fromTs * 1000));
  const till = aUTC(new Date(tillTs * 1000));
  const json = await pedir('route/list.json',
    `from=${encodeURIComponent(from)}&till=${encodeURIComponent(till)}` +
    `&unit_id=${encodeURIComponent(unitId)}&include=decoded_route`);
  const u = ((json.data && json.data.units) || [])[0] || {};
  const trips = (u.routes || [])
    .filter(rt => rt.type === 'route')
    .map(rt => ({
      distancia: Number(rt.distance) || 0,               // metros (odómetro Mapon del tramo)
      inicioTs: rt.start && rt.start.time ? tsUTC(rt.start.time) : null,
      puntos: ((rt.decoded_route && rt.decoded_route.points) || [])
        .map(p => ({ t: tsUTC(p.gmt), lat: Number(p.lat), lng: Number(p.lng) }))
        .filter(p => p.t != null && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    }));
  return { unitId, trips };
}

/**
 * Km recorridos por vehículo y día natural (hora peninsular), sumando la
 * distancia GPS de los trayectos de route/list.json de TODA la flota.
 *
 * route/list no pagina: para que la respuesta no sea un mamotreto, el rango se
 * trocea en ventanas de pocos días que se piden EN SERIE (la cuenta admite 5
 * peticiones concurrentes y el cron de sanciones ya consume). Un trayecto que
 * cruza la medianoche cuenta entero en su día de INICIO; los que caen justo en
 * el corte de dos ventanas se deduplican por route_id.
 */
const DIAS_POR_VENTANA = 5;

async function leerKmPorDia({ desde, hasta } = {}) {
  const { ini, fin } = resolverRango({ desde, hasta });
  const mapaUnidades = await unidades();

  // Eje de días del rango (en local): la vista pinta una columna por día, con
  // dato o sin él.
  const dias = [];
  for (let d = new Date(ini); d <= fin; d.setDate(d.getDate() + 1)) {
    dias.push(diaLocal(d.toISOString()));
  }

  const porUnidad = new Map();   // unit_id -> { km: Map(dia -> metros), viajes }
  const vistos = new Set();      // unit_id|route_id (dedupe entre ventanas)

  for (let v = new Date(ini); v < fin;) {
    const vFin = new Date(v); vFin.setDate(vFin.getDate() + DIAS_POR_VENTANA);
    const hastaV = vFin < fin ? vFin : fin;
    const json = await pedir('route/list.json',
      `from=${encodeURIComponent(aUTC(v))}&till=${encodeURIComponent(aUTC(hastaV))}`);
    ((json.data && json.data.units) || []).forEach(u => {
      (u.routes || []).forEach(ruta => {
        if (ruta.type !== 'route') return;                    // las paradas no suman km
        const clave = `${u.unit_id}|${ruta.route_id}`;
        if (vistos.has(clave)) return;
        vistos.add(clave);
        const dia = diaLocal(ruta.start && ruta.start.time);
        if (!dia) return;
        const reg = porUnidad.get(u.unit_id) || { km: new Map(), viajes: 0 };
        reg.km.set(dia, (reg.km.get(dia) || 0) + (Number(ruta.distance) || 0));
        reg.viajes++;
        porUnidad.set(u.unit_id, reg);
      });
    });
    v = vFin;
  }

  const filas = [...porUnidad.entries()].map(([unitId, reg]) => {
    const unidad = mapaUnidades.get(unitId) || {};
    const km = {};
    let total = 0;
    reg.km.forEach((metros, dia) => {
      const k = Math.round(metros / 100) / 10;   // metros → km con 1 decimal
      km[dia] = k;
      total += k;
    });
    return {
      unitId,
      matricula: unidad.matricula || `#${unitId}`,
      vehiculo: unidad.vehiculo || '—',
      km,
      total: Math.round(total * 10) / 10,
      viajes: reg.viajes
    };
  }).sort((a, b) => a.matricula.localeCompare(b.matricula));

  return { dias, filas, desde: aUTC(ini), hasta: aUTC(fin) };
}

/**
 * Auditoría de combustible de toda la flota en una pasada:
 *   eventos  repostajes (subida de nivel) y caídas (bajada brusca: posible robo)
 *            de fuel/changes.json, con lugar y nivel previo.
 *   resumen  litros repostados/drenados/consumidos por unidad de fuel/summary.json.
 *
 * Cada dato viene por duplicado desde la fuente 'sensor' (varilla) y 'can'
 * (centralita). En turismos sin varillas la fuente real es el CAN, así que se
 * prefiere can y se cae a sensor si el CAN no trae nada.
 */
async function leerCombustible({ desde, hasta } = {}) {
  const { ini, fin } = resolverRango({ desde, hasta });
  const rango = `from=${encodeURIComponent(aUTC(ini))}&till=${encodeURIComponent(aUTC(fin))}`;
  const [cambios, resumenRaw, mapaUnidades] = await Promise.all([
    pedir('fuel/changes.json', rango),
    pedir('fuel/summary.json', rango),
    unidades()
  ]);

  const eventos = [];
  (cambios.data || []).forEach(u => {
    const unidad = mapaUnidades.get(u.unit_id) || {};
    const matricula = txt(u.number) || unidad.matricula || `#${u.unit_id}`;
    ['can', 'sensor'].forEach(fuente => {
      (u[fuente] || []).forEach(e => {
        const litros = Math.round((Number(e.fuel_change) || 0) * 10) / 10;
        if (!litros) return;
        const { fecha, hora, orden } = enLocal(e.gmt);
        eventos.push({
          unitId: u.unit_id,
          matricula,
          vehiculo: unidad.vehiculo || '—',
          tipo: litros > 0 ? 'repostaje' : 'caida',
          litros,
          nivelAntes: e.fuel_before != null ? Math.round(Number(e.fuel_before) * 10) / 10 : null,
          fecha, hora, orden,
          lat: e.lat != null ? Number(e.lat) : null,
          lng: e.lng != null ? Number(e.lng) : null,
          direccion: txt(e.address),
          fuente
        });
      });
    });
  });
  eventos.sort((a, b) => b.orden - a.orden);

  const num = v => (v == null || v === '' ? null : Math.round(Number(v) * 10) / 10);
  const resumen = (resumenRaw.data || []).map(u => {
    const can = u.can || {}, sensor = u.sensor || {};
    const conDatos = o => o && [o.fueled, o.total_consumed, o.drained, o.start, o.end]
      .some(v => v != null && v !== '');
    const fuente = conDatos(can) ? 'can' : (conDatos(sensor) ? 'sensor' : null);
    const d = fuente === 'can' ? can : sensor;
    const unidad = mapaUnidades.get(u.unit_id) || {};
    return {
      unitId: u.unit_id,
      matricula: unidad.matricula || `#${u.unit_id}`,
      vehiculo: unidad.vehiculo || '—',
      fuente,
      repostado: fuente ? num(d.fueled) : null,
      drenado: fuente ? num(d.drained) : null,
      consumido: fuente ? num(d.total_consumed) : null,
      consumoMedio: fuente ? num(d.avg_consumption) : null,
      medida: txt(u.fuel_consumption_measurement) || 'l/100km'
    };
  }).sort((a, b) => a.matricula.localeCompare(b.matricula));

  return { eventos, resumen, desde: aUTC(ini), hasta: aUTC(fin) };
}

/** Setups configurados en Mapon (diagnóstico: con qué límite está avisando). */
async function listarSetups() {
  const r = await fetch(`${API}/alert/list_setups.json?key=${KEY}`);
  const json = await r.json();
  return (json.setups || []).map(s => ({
    setupId: s.setup_id,
    tipo: s.alert_type,
    titulo: s.title,
    activo: !!s.active,
    caducado: !!s.expired
  }));
}

module.exports = {
  TIPOS, UMBRAL, MAX_DIAS,
  leerAlertas, leerExcesosGraves, listarSetups,
  leerKmPorDia, leerCombustible, leerRecorridoUnidad,
  unidadPorMatricula, listarConductores, crearConductor,
  asignarConductor, desasignarConductor, conductoresDeUnidad, unidadDeConductor, kmEnVentana, kmEnVentanaExacto,
  relesDeFlota, relesDeUnidad, releDeCorte, cambiarRele, cambiarReleConfirmado, crudoUnidad, probarRele,
  unidades, parseFecha, parseValor, normalizar
};
