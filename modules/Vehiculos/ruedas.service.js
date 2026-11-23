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
//   · LAS REVISIONES (db/275, 23/11/2026, Camilo: «que se pueda inputar
//     también la última revisión, no mantenimiento sino revisión con su
//     respectiva observación»): el día, los km si se saben y lo visto. NO son
//     un cambio: no reinician los 30.000 km. Se anulan con motivo, no se borran.
//   · LA REVISIÓN DA 15.000 KM MÁS, UNA POR TRAMO (db/276, 23/11/2026, Camilo:
//     «si hay unas ruedas con 30000 KM recorridos y se apunta una revisión,
//     entonces sí o sí se cambia a los 45000, no hay más revisiones, solo una
//     revisión por tramo»). El TRAMO es desde el último cambio. Con una revisión
//     en el tramo, el cambio toca a los 45.000 (fijo, se revise cuando se
//     revise) y no se admite otra hasta el próximo cambio.
//   · EL AVISO: un número en «Mantenimientos» del menú con los que tocan, y una
//     vez al día, por el chat (canal «notificaciones-telecab»), a quien tenga el
//     puesto de responsable de taller, los coches que han pasado de 30.000 km
//     desde la última vez: una vez por cambio.
'use strict';

const repo = require('./ruedas.repo');
const taller = require('./taller.repo');
const contadores = require('../../services/contadores');
const libro = require('../../services/libro');
const tareasProgramadas = require('../../services/tareasProgramadas');
const { SEDE_FLOTA } = require('../../services/nucleo');

/** Cada cuántos km se cambian las ruedas (Camilo: «cada 25K»; el 18/11, «a los 30K km»). */
const INTERVALO = Number(process.env.TALLER_KM_RUEDAS) || 30000;
/** Lo que da una revisión: 15.000 km más (Camilo, 23/11/2026). */
const PRORROGA = 15000;
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

/**
 * La revisión del tramo: la más reciente desde el último cambio (si no hay
 * cambio, cualquiera). Una por tramo: es la que da los 15.000 km. Puro.
 */
function revisionDelTramo(cambio, revisiones) {
  const lista = revisiones || [];
  if (!cambio || !cambio.fecha) return lista[0] || null;
  return lista.find(r => r.fecha >= cambio.fecha) || null;
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
  const [coches, candidatos, revs] = await Promise.all([taller.cuadro({ sedes }), repo.candidatos(), repo.revisiones()]);
  const historial = historialRuedas(candidatos);
  const revisionesDe = new Map();
  revs.forEach(x => {
    if (!revisionesDe.has(x.vehiculo_id)) revisionesDe.set(x.vehiculo_id, []);
    revisionesDe.get(x.vehiculo_id).push({ id: x.id, fecha: x.fecha, km: x.km, observacion: x.observacion, por: x.por });
  });
  const filas = coches.map(c => {
    const h = historial.get(Number(c.id)) || { cambios: [], pinchazos: [] };
    const cambio = h.cambios[0] || null;
    const revisiones = revisionesDe.get(Number(c.id)) || [];
    const revisionTramo = revisionDelTramo(cambio, revisiones);
    const intervalo = INTERVALO + (revisionTramo ? PRORROGA : 0);
    return {
      id: c.id, matricula: c.matricula, vehiculo: c.vehiculo, zona: c.zona, estadoOperativo: c.estadoOperativo,
      conMapon: c.conMapon, odometro: c.odometro, odometroFuente: c.odometroFuente, kmDia: c.kmDia,
      cambio, cambios: h.cambios, pinchazos: h.pinchazos,
      revision: revisiones[0] || null, revisiones, revisionTramo,
      intervalo, ...semaforo({ odometro: c.odometro, cambio, kmDia: c.kmDia, intervalo }),
    };
  });
  const cuenta = e => filas.filter(f => f.estado === e).length;
  return {
    filas, intervalo: INTERVALO, prorroga: PRORROGA, estados: ESTADOS,
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

// ── Las revisiones (db/275) ────────────────────────────────────────────────
const MAX_OBSERVACION = 1000;
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

/** Una fecha escrita como sea → 'AAAA-MM-DD', por componentes (nunca new Date(cadena)). Puro. */
function aIso(v) {
  const s = String(v == null ? '' : v).trim();
  const dd = n => String(n).padStart(2, '0');
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${dd(+m[2])}-${dd(+m[1])}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${dd(+m[2])}-${dd(+m[3])}` : null;
}

/** Apuntar una revisión de ruedas: el día, los km (si se saben) y lo visto. No es un cambio. */
async function apuntarRevision(datos = {}, { usuarioId, sedes } = {}) {
  const fecha = aIso(datos.fecha);
  if (!fecha) throw new Error('Pon el día de la revisión (dd/mm/aaaa)');
  if (fecha > hoyMadrid()) throw new Error('La revisión no puede ser de un día que no ha llegado');
  const observacion = String(datos.observacion || '').trim();
  if (!observacion) throw new Error('Escribe la observación: cómo están las ruedas');
  if (observacion.length > MAX_OBSERVACION) throw new Error(`La observación, como mucho de ${MAX_OBSERVACION} letras`);
  let km = null;
  if (datos.km != null && String(datos.km).trim() !== '') {
    km = Math.round(Number(String(datos.km).replace(/[.\s]/g, '').replace(',', '.')));
    if (!Number.isFinite(km) || km < 0 || km > 2000000) throw new Error('Esos km no pueden ser');
  }
  const fila = (await cuadro({ sedes })).filas.find(c => Number(c.id) === Number(datos.vehiculoId));
  if (!fila) throw new Error('Ese coche no es de tu sede');
  if (km != null && fila.odometro != null && km > Number(fila.odometro) + 2000) {
    throw new Error(`${fila.matricula} marca ${miles(fila.odometro)} km y estás apuntando ${miles(km)}. Revisa el dato.`);
  }
  // Una revisión por tramo (db/276): ya da los 15.000 km; la siguiente, tras el próximo cambio.
  if (fila.revisionTramo) {
    throw new Error(`${fila.matricula} ya tiene su revisión en este tramo (${ddmmaaaa(fila.revisionTramo.fecha)}): ` +
      `el cambio toca a los ${miles(INTERVALO + PRORROGA)} km. La próxima revisión, después de cambiar las ruedas.`);
  }
  if (fila.cambio && fila.cambio.fecha && fecha < fila.cambio.fecha) {
    throw new Error(`El último cambio de ruedas de ${fila.matricula} es del ${ddmmaaaa(fila.cambio.fecha)}: la revisión no puede ser de antes`);
  }
  const id = await libro.conFirma({ usuarioId, origen: 'taller.ruedas', accion: 'alta' },
    cli => repo.apuntarRevision(cli, { vehiculoId: fila.id, fecha, km, observacion, usuarioId }));
  olvidar();   // con la revisión, el límite pasa a 45.000
  return { id };
}

/** Anular una revisión mal apuntada, con su motivo (no se borra). */
async function anularRevision({ id, motivo } = {}, { usuarioId, sedes } = {}) {
  const m = String(motivo || '').trim();
  if (!m) throw new Error('Di por qué se anula');
  const r = await repo.revision(null, Number(id));
  if (!r) throw new Error('Esa revisión no existe o ya está anulada');
  const fila = (await taller.cuadro({ sedes })).find(c => Number(c.id) === r.vehiculoId);
  if (!fila) throw new Error('Ese coche no es de tu sede');
  await libro.conFirma({ usuarioId, origen: 'taller.ruedas', accion: 'anulacion', motivo: m.slice(0, 500) },
    cli => repo.anularRevision(cli, { id: r.id, motivo: m.slice(0, 500), usuarioId }));
  olvidar();   // el límite del coche puede cambiar (vuelve a 30.000)
  return { ok: true };
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
    ` (${[ddmmaaaa(f.cambio.fecha), `${miles(f.cambio.km)} km`, f.cambio.taller].filter(Boolean).join(', ')})` +
    (f.revisionTramo ? `; ya tuvo su revisión (${ddmmaaaa(f.revisionTramo.fecha)}) y el límite era ${miles(f.intervalo)} km: hay que cambiarlas.` : '.');
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
  const clave = f => `${f.id}|${f.cambio.id || 0}|${(f.revisionTramo && f.revisionTramo.id) || 0}`;
  const nuevos = todas.filter(f => f.estado === 'toca' && f.cambio && !ya.has(clave(f)));
  if (!nuevos.length) return { avisados: 0 };
  const para = await repo.responsablesTaller(cli);
  if (!para.length) return { avisados: 0, sinResponsable: true };
  const chat = require('../Chat/chat.service');
  const m = await chat.avisoDelSistema({ para, texto: textoAviso(nuevos) });
  for (const f of nuevos) {
    await repo.apuntarAviso(cli, { vehiculoId: f.id, cambioId: f.cambio.id, revisionId: f.revisionTramo && f.revisionTramo.id,
      kmDesde: f.desde, mensajeId: m && m.id });
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
  cuadro, apuntar, avisar, olvidar, apuntarRevision, anularRevision, INTERVALO, PRORROGA, ESTADOS,
  // Para las pruebas:
  _ruedasDe: ruedasDe, _historialRuedas: historialRuedas, _semaforo: semaforo, _revisionDelTramo: revisionDelTramo, _textoAviso: textoAviso, _esRuedaNueva: esRuedaNueva,
};
