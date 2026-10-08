// ============================================================
// FLOTA DE MAPON — qué sabe hacer cada unidad
// ============================================================
// Camilo, 08/10/2026: «un Excel de toda la flota que aparezca en Mapon, Madrid
// y Barcelona, para dar un diagnóstico por matrícula de qué funciones tiene:
// abrir puertas, cerrar puertas, CAN, GPS bueno… todo lo que puedan tener».
//
// Una fila por UNIDAD de Mapon (no por coche: una matrícula con dos equipos sale
// dos veces, y se dice cuál usa el ERP). Las funciones salen de dos sitios:
//
//   · unit/list con todos sus bloques (CAN, relés, contacto, combustible,
//     equipo, eléctrico): lo que la unidad CUENTA de sí misma.
//   · unit_commands/get_available, unidad a unidad: las órdenes que ADMITE
//     (abrir y cerrar puertas, maletero, warnings, ventanillas…). Los nombres
//     los define cada instalación: se preguntan, no se adivinan.
//
// Y una prueba de verdad que no da Mapon: si el bot ha abierto o cerrado ese
// coche alguna vez (puerta_comando). Que un comando esté en el catálogo no
// garantiza que llegue al coche (ver docs/integraciones/Mapon.md, ventanillas).
//
// SOLO LECTURA: no se ejecuta ningún comando ni se cambia ningún relé.

const mapon = require('../../services/mapon');
const repo = require('./maponFlota.repo');

const HORA = 3600 * 1000;
const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const lleno = v => v != null && (Array.isArray(v) ? v.length > 0 : typeof v === 'object' ? Object.keys(v).length > 0 : v !== '');

// Las órdenes que se reconocen por su nombre en el catálogo de Mapon. Lo que no
// esté aquí sale igual, en «Otros comandos».
const ORDENES = {
  abrirPuertas: ['open_doors', 'unlock_doors', 'unlock'],
  cerrarPuertas: ['close_doors', 'lock_doors', 'lock'],
  maletero: ['open_trunk', 'trunk'],
  warnings: ['hazard_lights', 'hazards'],
  ventanillas: ['open_windows', 'close_windows'],
};
const CONOCIDAS = new Set(Object.values(ORDENES).flat());

const ESTADO = { driving: 'Circulando', standing: 'Parado', nodata: 'Sin datos', nogps: 'Sin GPS', service: 'En servicio técnico' };

/** Fecha de Mapon ('aaaa-mm-ddTHH:MM:SSZ' o 'aaaa-mm-dd HH:MM:SS', en UTC) → ms, o null. */
function msDe(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return null;
  const ms = Date.parse(t.includes('T') ? t : t.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

/** El equipo, en una línea, con lo que traiga el bloque `device`. */
function equipoDe(d) {
  if (!d || typeof d !== 'object') return '';
  const partes = [d.model, d.name, d.type, d.device_type].filter(x => x && typeof x !== 'object');
  const id = d.imei || d.serial_number || d.serial;
  return [...new Set(partes.map(String))].join(' · ') + (id ? `${partes.length ? ' · ' : ''}${id}` : '');
}

/**
 * EL DIAGNÓSTICO DE UNA UNIDAD. Puro: recibe lo que dijo Mapon de ella, su
 * catálogo de órdenes (o `{ error }` si no se pudo preguntar) y lo que sabe
 * Telecab, y devuelve una fila con cada función a true, false o null (no se
 * sabe).
 */
function diagnosticar(u, comandos, { ahora = Date.now(), coche = null, puertas = null, duplicado = null } = {}) {
  const estadoCod = u.state && typeof u.state === 'object' ? u.state.name : u.state;
  const ultimo = msDe(u.last_update);
  const hayPosicion = Number(u.lat) !== 0 && Number.isFinite(Number(u.lat)) && Number.isFinite(Number(u.lng)) && u.lat != null;
  const envia = ultimo != null && ahora - ultimo < 24 * HORA;
  const senal = !!estadoCod && !['nogps', 'nodata'].includes(estadoCod) && hayPosicion;
  const odom = u.can && u.can.odom ? Number(u.can.odom.value) : NaN;
  const can = u.can && typeof u.can === 'object' ? Object.keys(u.can) : [];
  const fuelCan = can.some(k => /fuel/i.test(k));
  const errorComandos = comandos && comandos.error ? comandos.error : null;
  const nombres = errorComandos ? null : (comandos || []).map(c => String(c).toLowerCase());
  const tiene = lista => (nombres ? lista.some(n => nombres.includes(n)) : null);
  const corte = mapon.tieneReleCorte(u);
  const matricula = String(u.number || u.label || `#${u.unit_id}`).trim();
  const obs = [];
  if (errorComandos) obs.push(`No se pudo leer su catálogo de órdenes: ${errorComandos}`);
  if (duplicado) obs.push(duplicado.enUso ? `Esta matrícula tiene ${duplicado.total} equipos en Mapon: este es el que usa el ERP`
    : `Esta matrícula tiene ${duplicado.total} equipos en Mapon: este SOBRA (el ERP usa el ${duplicado.usado}); conviene darlo de baja en Mapon`);
  if (!coche) obs.push('No está enlazada a ningún coche de Telecab');
  else if (coche.baja) obs.push('El coche está dado de baja en Telecab');
  if (puertas && puertas.fallos && !(puertas.aperturas_ok || puertas.cierres_ok)) obs.push(`El bot lo ha intentado ${puertas.fallos} vez/veces y nunca ha funcionado`);

  return {
    unitId: String(u.unit_id),
    matricula,
    matriculaNorm: normMat(matricula),
    vehiculo: [u.make, u.model].filter(Boolean).join(' ') || u.vehicle_title || u.label || '',
    equipo: equipoDe(u.device),
    sede: coche ? (coche.sede === 'barcelona' ? 'Barcelona' : 'Madrid') : 'Sin enlazar',
    estadoTelecab: coche ? (coche.baja ? 'Baja' : (coche.estado_operativo || '')) : '',
    enUso: duplicado ? duplicado.enUso : true,
    estado: ESTADO[estadoCod] || estadoCod || '',
    ultimoDato: ultimo,
    horasSinDatos: ultimo != null ? Math.max(0, Math.round((ahora - ultimo) / HORA)) : null,
    // ── Lo que cuenta la unidad ──
    enviaDatos: envia,
    gpsSenal: senal,
    gpsBueno: envia && senal,
    can: Number.isFinite(odom) && odom > 0,
    kmCan: Number.isFinite(odom) && odom > 0 ? Math.round(odom) : null,
    datosCan: can.join(', '),
    combustible: lleno(u.fuel) || fuelCan,
    contacto: !!(u.ignition && typeof u.ignition === 'object' && u.ignition.value != null),
    corteMotor: corte === true,
    electrico: lleno(u.ev_values),
    // ── Lo que admite (su catálogo de órdenes) ──
    abrirPuertas: tiene(ORDENES.abrirPuertas),
    cerrarPuertas: tiene(ORDENES.cerrarPuertas),
    maletero: tiene(ORDENES.maletero),
    warnings: tiene(ORDENES.warnings),
    ventanillas: tiene(ORDENES.ventanillas),
    otrosComandos: nombres ? nombres.filter(n => !CONOCIDAS.has(n)).join(', ') : '',
    // ── Lo que ha hecho de verdad el bot ──
    puertasProbadas: !!(puertas && (puertas.aperturas_ok || puertas.cierres_ok)),
    aperturasOk: puertas ? puertas.aperturas_ok || 0 : 0,
    cierresOk: puertas ? puertas.cierres_ok || 0 : 0,
    ultimaPuertaOk: puertas && puertas.ultima_ok ? new Date(puertas.ultima_ok).getTime() : null,
    observaciones: obs.join(' · '),
  };
}

/** Ejecuta `fn` sobre la lista de `n` en `n`: ~170 preguntas a Mapon sin saturarla. */
async function enTandas(lista, n, fn) {
  const out = new Array(lista.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const k = i++; out[k] = await fn(lista[k], k); }
  }));
  return out;
}

/** El inventario entero: una fila por unidad, Madrid primero, por matrícula. */
async function inventario({ ahora = Date.now() } = {}) {
  const [unidades, coches, historial] = await Promise.all([mapon.inventario(), repo.coches(), repo.historialPuertas()]);
  if (!unidades.length) throw new Error('Mapon no ha devuelto ninguna unidad');

  // A qué coche va cada unidad: por el enlace y, si no lo tiene, por la matrícula.
  const porUnidad = new Map(), porMatricula = new Map();
  coches.forEach(c => {
    (c.unidades || []).forEach(id => porUnidad.set(String(id), c));
    if (c.matricula_norm && !c.baja) porMatricula.set(c.matricula_norm, c);
    else if (c.matricula_norm && !porMatricula.has(c.matricula_norm)) porMatricula.set(c.matricula_norm, c);
  });
  // Lo del bot, por unidad y por matrícula (los pedidos viejos no guardaban la unidad).
  const puertasU = new Map(), puertasM = new Map();
  const sumar = (mapa, k, h) => {
    if (!k) return;
    const a = mapa.get(k) || { aperturas_ok: 0, cierres_ok: 0, fallos: 0, ultima_ok: null };
    a.aperturas_ok += h.aperturas_ok; a.cierres_ok += h.cierres_ok; a.fallos += h.fallos;
    if (h.ultima_ok && (!a.ultima_ok || new Date(h.ultima_ok) > new Date(a.ultima_ok))) a.ultima_ok = h.ultima_ok;
    mapa.set(k, a);
  };
  historial.forEach(h => { if (h.unit_id) sumar(puertasU, String(h.unit_id), h); else sumar(puertasM, h.matricula, h); });

  // Matrículas con varios equipos: cuál usa el ERP (la misma regla que en todo el sistema).
  const grupos = new Map();
  unidades.forEach(u => {
    const k = normMat(u.number || u.label);
    if (!k) return;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(u);
  });
  const duplicados = new Map();
  grupos.forEach((lista, k) => {
    if (lista.length < 2) return;
    const enlazada = lista.find(u => porUnidad.has(String(u.unit_id)));
    const elegido = mapon.elegirEquipo(lista.map(u => ({
      unitId: u.unit_id,
      odometroCanM: u.can && u.can.odom ? Number(u.can.odom.value) * 1000 : null,
      releCorte: mapon.tieneReleCorte(u),
      estado: u.state && typeof u.state === 'object' ? u.state.name : u.state,
    })), { actual: enlazada ? enlazada.unit_id : null });
    lista.forEach(u => duplicados.set(String(u.unit_id), { total: lista.length, enUso: String(u.unit_id) === String(elegido.unitId), usado: elegido.unitId }));
  });

  // El catálogo de órdenes, unidad a unidad.
  const comandos = await enTandas(unidades, 4, u => mapon.comandosDisponibles(u.unit_id)
    .then(r => (r.comandos || []).map(c => c.command || c.name || c.id).filter(Boolean))
    .catch(e => ({ error: e.message })));

  const filas = unidades.map((u, i) => {
    const id = String(u.unit_id);
    const coche = porUnidad.get(id) || porMatricula.get(normMat(u.number || u.label)) || null;
    const puertas = puertasU.get(id) || (!duplicados.has(id) || duplicados.get(id).enUso ? puertasM.get(normMat(u.number || u.label)) : null) || null;
    return diagnosticar(u, comandos[i], { ahora, coche, puertas, duplicado: duplicados.get(id) || null });
  });
  const ORDEN = { Madrid: 0, Barcelona: 1, 'Sin enlazar': 2 };
  filas.sort((a, b) => ORDEN[a.sede] - ORDEN[b.sede] || a.matricula.localeCompare(b.matricula) || (b.enUso - a.enUso));
  return { filas, generado: ahora, sinCatalogo: filas.filter(f => f.abrirPuertas === null).length };
}

/** El Excel. */
async function excel() {
  const datos = await inventario();
  const bytes = await require('./maponFlota.excel').generar(datos);
  const hoy = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date()).replace(/\//g, '-');
  return { bytes, nombre: `Flota Mapon ${hoy}.xlsx` };
}

module.exports = { diagnosticar, inventario, excel, ORDENES };
