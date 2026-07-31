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

// Mientras las credenciales no estén en variables de entorno de Render, se deja
// la clave actual como respaldo para no romper lo que ya funciona. Defínela en
// el panel como MAPON_API_KEY y este fichero deja de tener el secreto escrito.
const KEY = process.env.MAPON_API_KEY || 'd1ff9336961ee25a46091c08663de3612d6a4955';

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
  unidades, parseFecha, parseValor, normalizar
};
