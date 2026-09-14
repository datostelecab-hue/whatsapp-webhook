// ============================================================
// FICHAJE — servicio
// ============================================================
// LA PUERTA. Quién tiene que fichar, si puede fichar ahora, y qué se puede
// corregir. El repositorio solo guarda; aquí están las reglas.
//
// Lo que se guarda: entrada, salida y dónde estaban al pulsar. Nada más. Se
// descartaron las pausas a propósito: dos pulsaciones al día se olvidan mucho
// menos que cuatro, y un registro con pausas a medias es peor que uno sin ellas.

const repo = require('./fichaje.repo');
const usuarios = require('../Usuarios/usuarios.service');

const TZ = 'Europe/Madrid';

/** 'AAAA-MM-DD' de hoy en Madrid. */
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

/** Minutos entre dos instantes, o null si falta alguno. */
const minutos = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);

/** '7 h 25 min'. Lo que se lee, no un número de minutos. */
function comoTexto(min) {
  if (min == null) return '';
  return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
}

/**
 * En qué punto está alguien AHORA MISMO.
 *
 * Lo pregunta la barra de arriba en cada pantalla, así que devuelve lo justo y
 * se apoya en dos consultas cortas por índice.
 */
async function estado(usuarioId) {
  const u = await usuarios.buscarUsuarioPorId(usuarioId);
  const debe = !!(u && u.fichaObligatorio);
  if (!debe) return { debeFichar: false, abierto: null };

  const a = await repo.abierto(usuarioId);
  return {
    debeFichar: true,
    quien: u.nombre,
    abierto: a ? {
      id: Number(a.id), dia: a.dia, entrada: a.entrada,
      minutos: minutos(a.entrada, new Date()),
    } : null,
    // Si su jornada abierta es de OTRO día, es que se fue sin fichar la salida.
    // Se avisa en la propia barra: es el error más común y el que menos se nota.
    olvidada: !!(a && a.dia !== hoyMadrid()),
    hoy: hoyMadrid(),
  };
}

/** Abre la jornada. `ubi` es lo que haya dicho el navegador. */
async function entrar(usuarioId, ubi) {
  const u = await usuarios.buscarUsuarioPorId(usuarioId);
  if (!u || !u.fichaObligatorio) throw new Error('Tu cuenta no tiene el fichaje activado');
  const f = await repo.entrar(usuarioId, ubi);
  console.log(`⏱️  [FICHAJE] ${u.email} ENTRA (ubicación: ${f.entrada_ubicacion})`);
  return f;
}

/** Cierra la jornada. */
async function salir(usuarioId, ubi) {
  const f = await repo.salir(usuarioId, ubi);
  if (!f) throw new Error('No tienes ninguna jornada abierta');
  const u = await usuarios.buscarUsuarioPorId(usuarioId);
  console.log(`⏱️  [FICHAJE] ${u ? u.email : usuarioId} SALE · ${comoTexto(minutos(f.entrada, f.salida))}`);
  return f;
}

/** Su propio mes, con las horas ya sumadas. */
async function miMes(usuarioId, mes) {
  const m = /^\d{4}-\d{2}$/.test(String(mes || '')) ? mes : hoyMadrid().slice(0, 7);
  const filas = (await repo.delMes(usuarioId, m)).map(f => ({
    ...f,
    id: Number(f.id),
    minutos: minutos(f.entrada, f.salida),
    // Lo que se pulsó, si luego se corrigió. Es lo que hace auditable el registro.
    corregido: !!f.corregido_at,
  }));
  const total = filas.reduce((s, f) => s + (f.minutos || 0), 0);
  return { mes: m, filas, totalMinutos: total, total: comoTexto(total), abiertas: filas.filter(f => !f.salida).length };
}

/** El parte de un día: quién fichó y quién no. Para el desarrollador. */
async function parteDelDia(dia) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : hoyMadrid();
  const filas = (await repo.delDia(d)).map(f => ({
    ...f,
    usuario_id: Number(f.usuario_id),
    id: f.id ? Number(f.id) : null,
    minutos: minutos(f.entrada, f.salida),
    estado: !f.id ? 'sin_fichar' : (!f.salida ? 'abierta' : 'cerrada'),
  }));
  return {
    dia: d, filas,
    sinFichar: filas.filter(f => f.estado === 'sin_fichar').length,
    abiertas: filas.filter(f => f.estado === 'abierta').length,
    // Las que se guardaron sin posición: el hueco que hay que reclamar.
    sinUbicacion: filas.filter(f => f.id && f.entrada_ubicacion !== 'ok').length,
  };
}

/**
 * Corrige o crea un fichaje. SOLO EL DESARROLLADOR — el candado está en el
 * controlador; aquí se exige lo que hace que la corrección valga: un motivo.
 */
async function corregir({ id, usuarioId, entrada, salida }, { autor, motivo }) {
  const m = String(motivo || '').trim();
  if (m.length < 4) throw new Error('Hay que escribir el motivo de la corrección');
  if (id) return repo.corregir(Number(id), { entrada, salida }, { usuarioId: autor, motivo: m });
  if (!usuarioId || !entrada) throw new Error('Para crear un fichaje hacen falta la persona y la hora de entrada');
  return repo.crearAMano(Number(usuarioId), { entrada, salida }, { autor, motivo: m });
}

/** Lo que quedó sin cerrar en días pasados. */
const sinCerrar = () => repo.sinCerrar();

/** Quién tiene que fichar hoy. */
const losQueFichan = () => usuarios.losQueFichan();

module.exports = {
  estado, entrar, salir, miMes, parteDelDia, corregir, sinCerrar, losQueFichan,
  comoTexto, hoyMadrid,
};
