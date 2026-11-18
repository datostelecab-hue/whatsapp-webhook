// ============================================================
// RUEDAS — cada 30.000 km, un cambio de ruedas (db/265, 18/11/2026)
// ============================================================
// Camilo: «quiero un nuevo submódulo como el de mantenimientos, pero que diga
// "Ruedas", que cada 25K de KM se pase y avise, los KM de los últimos
// mantenimientos deben de sacarse de cambio de ruedas, hay unos de pinchazos en
// las facturas por los que esos no cuentan». Y: «que le llegue al chat de
// Óscar, que es el responsable de taller, también una notificación, pero el
// chat de Telecab, que se llame "Notificaciones Telecab"». El mismo 18/11 lo
// subió: «cambiemos el parámetro de revisión de llantas a los 30K km».
//
// LAS REGLAS
//   · EL ÚLTIMO CAMBIO de cada coche: el mantenimiento más reciente (por fecha
//     y, si empatan, por km) que es un cambio de ruedas:
//       - una pieza de neumático NUEVO en una factura («CUB. 205/55R16…»,
//         «NEUMÁTICOS DELANTEROS … + MONTAJE»): no los pinchazos, ni los
//         reutilizados, ni la ecotasa, el equilibrado o la alineación solos;
//       - o un cambio apuntado a mano en esta pestaña (tipo neumáticos, a mano).
//   · LO QUE LLEVA: el odómetro de hoy (el mismo de Revisión por km) menos los
//     km de ese cambio. A los 30.000 km «toca»; desde el 85 % (o si al ritmo de
//     los últimos 30 días le quedan 15 días o menos), «a punto».
//   · SIN CAMBIO APUNTADO, o con un cambio sin km: «sin dato» hasta que se
//     apunte a mano (Camilo: «Sin dato y apuntarlo a mano»).
//   · EL AVISO: un número en «Mantenimientos» del menú con los que tocan, y una
//     vez al día, por el chat (canal «notificaciones-telecab»), a quien tenga el
//     puesto de responsable de taller, los coches que han pasado de 30.000 km
//     desde la última vez: una vez por cambio.
'use strict';

const repo = require('./ruedas.repo');
const taller = require('./taller.repo');
const contadores = require('../../services/contadores');
const tareasProgramadas = require('../../services/tareasProgramadas');
const { SEDE_FLOTA } = require('../../services/nucleo');

/** Cada cuántos km se cambian las ruedas (Camilo: «cada 25K»; el 18/11, «a los 30K km»). */
const INTERVALO = Number(process.env.TALLER_KM_RUEDAS) || 30000;
const AVISO_PCT = 0.85;
const AVISO_DIAS = 15;
/** Más que esto desde el último cambio no es un cambio pendiente: es un dato mal metido. */
const IMPOSIBLE = 150000;

const ESTADOS = [
  { codigo: 'toca',     etiqueta: 'Toca cambiar' },
  { codigo: 'pronto',   etiqueta: 'A punto' },
  { codigo: 'ok',       etiqueta: 'Al día' },
  { codigo: 'sin_dato', etiqueta: 'Sin dato' },
  { codigo: 'revisar',  etiqueta: 'Dato imposible' },
];

// ── Qué es un cambio de ruedas ─────────────────────────────────────────────
const plano = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const NUEVA = /\bCUB\b|\bCUB\.|CUBIERTA|NEUMATIC/;
const NO_ES = /PINCHAZO|REUTILIZ|ECOTASA|RETIRADA|SENSOR|PRESION|VALVULA|EQUILIBR|ALINEAC|PARALELO/;

/** ¿Es una cubierta nueva esta línea de factura? */
const esRuedaNueva = descripcion => { const d = plano(descripcion); return NUEVA.test(d) && !NO_ES.test(d); };

/**
 * Si un mantenimiento es un cambio de ruedas, cuántas ruedas (null si no se
 * sabe); si no lo es, 0. Puro.
 */
function ruedasDe(m) {
  if (m.origen === 'manual' && m.tipo === 'neumaticos') {
    const n = Number((String(m.descripcion || '').match(/(\d)\s*rueda/i) || [])[1]);
    return n || null;
  }
  const nuevas = (m.piezas || []).filter(p => esRuedaNueva(p.d));
  if (!nuevas.length) return 0;
  return nuevas.reduce((s, p) => s + (Number(p.c) || 1), 0);
}

const esPinchazo = m => (m.piezas || []).some(p => /PINCHAZO/.test(plano(p.d)));

/**
 * Lo de ruedas de cada coche: Map(vehiculoId → { cambios, pinchazos }), cada
 * lista del más reciente al más antiguo (por fecha y, si empatan, por km). El
 * último cambio es cambios[0]. Los pinchazos se enseñan, pero no cuentan. Puro.
 */
function historialRuedas(candidatos) {
  const out = new Map();
  const de = v => { if (!out.has(v)) out.set(v, { cambios: [], pinchazos: [] }); return out.get(v); };
  const dato = (m, extra) => ({ id: m.id, km: m.km, fecha: m.fecha, taller: m.taller || null, referencia: m.referencia || null,
    origen: m.origen, ...extra });
  candidatos.forEach(m => {
    const ruedas = ruedasDe(m);
    if (ruedas !== 0) de(m.vehiculo_id).cambios.push(dato(m, { ruedas }));
    else if (esPinchazo(m)) de(m.vehiculo_id).pinchazos.push(dato(m, {}));
  });
  const orden = (a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.km || 0) - (a.km || 0) || b.id - a.id;
  out.forEach(h => { h.cambios.sort(orden); h.pinchazos.sort(orden); });
  return out;
}

/** El semáforo de un coche. Puro. */
function semaforo({ odometro, cambio, kmDia, intervalo = INTERVALO }) {
  if (!cambio || cambio.km == null || odometro == null) {
    return { estado: 'sin_dato', desde: null, restan: null, dias: null, porcentaje: null,
      motivo: !cambio ? 'sin_cambio' : cambio.km == null ? 'cambio_sin_km' : 'sin_odometro' };
  }
  const desde = Number(odometro) - Number(cambio.km);
  if (desde < 0 || desde > IMPOSIBLE) return { estado: 'revisar', desde, restan: null, dias: null, porcentaje: null, motivo: null };
  const restan = intervalo - desde;
  const dias = kmDia && kmDia > 0 && restan > 0 ? Math.round(restan / kmDia) : null;
  const estado = desde >= intervalo ? 'toca'
    : desde >= intervalo * AVISO_PCT || (dias != null && dias <= AVISO_DIAS) ? 'pronto' : 'ok';
  return { estado, desde, restan, dias, porcentaje: Math.min(150, Math.round(desde / intervalo * 100)), motivo: null };
}

// ── La pestaña ─────────────────────────────────────────────────────────────
/** La flota con su último cambio de ruedas y su semáforo. `sedes`, las de quien mira. */
async function cuadro({ sedes } = {}) {
  const [coches, candidatos] = await Promise.all([taller.cuadro({ sedes }), repo.candidatos()]);
  const historial = historialRuedas(candidatos);
  const filas = coches.map(c => {
    const h = historial.get(Number(c.id)) || { cambios: [], pinchazos: [] };
    const cambio = h.cambios[0] || null;
    return {
      id: c.id, matricula: c.matricula, vehiculo: c.vehiculo, zona: c.zona, estadoOperativo: c.estadoOperativo,
      conMapon: c.conMapon, odometro: c.odometro, odometroFuente: c.odometroFuente, kmDia: c.kmDia,
      cambio, cambios: h.cambios, pinchazos: h.pinchazos,
      intervalo: INTERVALO, ...semaforo({ odometro: c.odometro, cambio, kmDia: c.kmDia }),
    };
  });
  const cuenta = e => filas.filter(f => f.estado === e).length;
  return {
    filas, intervalo: INTERVALO, estados: ESTADOS,
    resumen: { total: filas.length, toca: cuenta('toca'), pronto: cuenta('pronto'), ok: cuenta('ok'),
      sinDato: cuenta('sin_dato'), revisar: cuenta('revisar') },
  };
}

/**
 * Apuntar a mano el último cambio de ruedas de un coche (para los que no lo
 * tienen en ninguna factura). Es un mantenimiento a mano de neumáticos.
 */
async function apuntar(datos = {}, { usuarioId, sedes } = {}) {
  const ruedas = Number(datos.ruedas) || null;
  if (ruedas != null && ![2, 4].includes(ruedas)) throw new Error('Se cambian 2 o 4 ruedas');
  if (datos.km == null || datos.km === '') throw new Error('Sin los km del cambio no se puede contar: apúntalos');
  const fila = (await taller.cuadro({ sedes })).find(c => Number(c.id) === Number(datos.vehiculoId));
  if (!fila) throw new Error('Ese coche no es de tu sede');
  const nota = String(datos.nota || '').trim();
  const r = await taller.registrar({
    vehiculoId: datos.vehiculoId, tipo: 'neumaticos', fecha: datos.fecha, km: datos.km, taller: datos.taller,
    descripcion: `Cambio de ruedas${ruedas ? ` (${ruedas} ruedas)` : ''} · apuntado en Ruedas${nota ? ` · ${nota}` : ''}`,
  }, { usuarioId });
  olvidar();
  return r;
}

// ── El número del menú ─────────────────────────────────────────────────────
// La flota entera cuesta una consulta (odómetro y ritmo de cada coche): se
// guarda diez minutos, que los números del menú se piden cada dos.
let memoria = null;
const MEMORIA_MS = 10 * 60 * 1000;
function olvidar() { memoria = null; contadores.cambio('ruedas'); }
async function cuantosTocan() {
  if (memoria && Date.now() - memoria.at < MEMORIA_MS) return memoria.n;
  const c = await cuadro({ sedes: [SEDE_FLOTA] });
  memoria = { at: Date.now(), n: c.resumen.toca };
  return memoria.n;
}

const veTaller = quien => quien && (quien.permisos === null
  || (Array.isArray(quien.permisos) && quien.permisos.some(p => p === '/taller' || p.startsWith('/taller/'))));
contadores.registrarFuente('ruedas', {
  async contar(quien) {
    if (!veTaller(quien)) return {};
    const n = await cuantosTocan();
    return { 'taller.ruedas': { n, tono: n ? 'aviso' : 'info', titulo: `${n} ${n === 1 ? 'coche' : 'coches'} con las ruedas por cambiar (${miles(INTERVALO)} km)` } };
  },
});

// ── El aviso por el chat ───────────────────────────────────────────────────
const miles = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const ddmmaaaa = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

/** El texto del aviso de unos coches. Puro. */
function textoAviso(filas) {
  const una = f => `• ${f.matricula}${f.vehiculo ? ` (${f.vehiculo})` : ''}: lleva ${miles(f.desde)} km desde el último cambio` +
    ` (${[ddmmaaaa(f.cambio.fecha), `${miles(f.cambio.km)} km`, f.cambio.taller].filter(Boolean).join(', ')}).`;
  const cabeza = filas.length === 1
    ? `Ruedas: a un coche le toca cambiar las ruedas (${miles(INTERVALO)} km).`
    : `Ruedas: a ${filas.length} coches les toca cambiar las ruedas (${miles(INTERVALO)} km).`;
  return [cabeza, ...filas.map(una), 'Lo tienes en Mantenimientos › Ruedas: /taller?vista=ruedas'].join('\n');
}

/**
 * El repaso diario: los coches de la flota que han llegado a los 30.000 km y de
 * los que aún no se ha avisado (por su último cambio), en un mensaje al canal
 * «notificaciones-telecab», mencionando a los responsables de taller.
 */
async function avisar({ cli, filas = null } = {}) {
  let ya;
  try { ya = await repo.avisados(cli); } catch (e) { if (repo.faltaMigracion(e)) return { sinMigracion: true }; throw e; }
  // `filas`: solo las pruebas, que no tienen odómetros de Mapon.
  const todas = filas || (await cuadro({ sedes: [SEDE_FLOTA] })).filas;
  const nuevos = todas.filter(f => f.estado === 'toca' && f.cambio && !ya.has(`${f.id}|${f.cambio.id || 0}`));
  if (!nuevos.length) return { avisados: 0 };
  const para = await repo.responsablesTaller(cli);
  if (!para.length) return { avisados: 0, sinResponsable: true };
  const chat = require('../Chat/chat.service');
  const m = await chat.avisoDelSistema({ para, texto: textoAviso(nuevos) });
  for (const f of nuevos) {
    await repo.apuntarAviso(cli, { vehiculoId: f.id, cambioId: f.cambio.id, kmDesde: f.desde, mensajeId: m && m.id });
  }
  return { avisados: nuevos.length, para: para.length };
}

tareasProgramadas.registrar({
  clave: 'taller.ruedas',
  descripcion: 'Avisa por el chat (Notificaciones Telecab) de los coches que llegan a los 30.000 km sin cambiar las ruedas',
  desde: '2026-11-18',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '08:00' }),
  hacer: avisar,
});

module.exports = {
  cuadro, apuntar, avisar, olvidar, INTERVALO, ESTADOS,
  // Para las pruebas:
  _ruedasDe: ruedasDe, _historialRuedas: historialRuedas, _semaforo: semaforo, _textoAviso: textoAviso, _esRuedaNueva: esRuedaNueva,
};
