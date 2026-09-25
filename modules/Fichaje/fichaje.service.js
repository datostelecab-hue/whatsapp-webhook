// ============================================================
// FICHAJE — servicio
// ============================================================
// LA PUERTA. Quién tiene que fichar, si puede fichar ahora, y qué se puede
// corregir. El repositorio solo guarda; aquí están las reglas.
//
// Lo que se guarda: entrada, salida y dónde estaban al pulsar. Nada más. Se
// descartaron las pausas a propósito: dos pulsaciones al día se olvidan mucho
// menos que cuatro, y un registro con pausas a medias es peor que uno sin ellas.
//
// ── QUIÉN APRUEBA (25/09/2026) ──────────────────────────────────────────────
// Cada uno puede PEDIR que se corrija su fichaje (db/159). Aprobarlo —y también
// corregir a mano y confirmar horas— es de UNA sola persona: la que tiene la
// llave '/fichaje/revisar'. La base no deja que la tengan dos, y aquí se exige
// que la tenga DE VERDAD, en su matriz: ni superadmin ni desarrollador aprueban
// por su rol. Mirar el registro de todos sí lo pueden hacer.

const repo = require('./fichaje.repo');
const usuarios = require('../Usuarios/usuarios.service');
const permisos = require('../../services/permisos');

const TZ = 'Europe/Madrid';
const LLAVE = '/fichaje/revisar';

// Hasta dónde se puede pedir una corrección: lo de hace más de dos meses ya se
// ha cobrado, y se habla con quien lleva el registro.
const DIAS_ATRAS = 60;
// Más de dieciséis horas seguidas no es una jornada, es una hora mal escrita.
const MAX_JORNADA_MIN = 16 * 60;
const MOTIVO_MAX = 500;

/** 'AAAA-MM-DD' de hoy en Madrid. */
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

/** 'AAAA-MM-DD' de un instante, en Madrid. */
const diaDe = t => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(t));

/** '09:05' de un instante, en Madrid. */
const horaDe = t => new Date(t).toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** '24/09' de un 'AAAA-MM-DD': lo que se lee en un mensaje. */
const diaCorto = iso => String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7);

/** Si dos instantes (o dos vacíos) son el mismo. */
const mismo = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

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

// ── La semana, que es como se mira una jornada ─────────────────────────────
// Se cuenta de LUNES a domingo, como el cuadrante y como el convenio. Las
// cuentas se hacen sobre fechas en ISO montadas a mediodía UTC: así ni el
// cambio de hora ni la zona del servidor pueden mover un día. Ver la trampa de
// las fechas en el vault.
const masDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = iso => masDias(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7));

/** Su propia semana (la del día que se le pase), con las horas ya sumadas. */
async function miSemana(usuarioId, dia) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : hoyMadrid();
  const desde = lunesDe(d), hasta = masDias(desde, 6);
  // Lo que ha pedido corregir esa semana, lo más nuevo primero. De cada jornada
  // (o de cada día, si pidió una jornada entera) se enseña la ÚLTIMA petición
  // si sigue pendiente o si se la rechazaron: si la última se aprobó, la
  // jornada ya lo dice sola («corregido»).
  const pedidas = (await repo.correccionesDe(usuarioId, desde, hasta)).map(c => ({
    id: Number(c.id), fichajeId: c.fichaje_id ? Number(c.fichaje_id) : null, nueva: c.nueva,
    dia: c.dia, entrada: c.entrada, salida: c.salida, motivo: c.motivo, estado: c.estado,
    pedidaAt: c.pedida_at, resueltaAt: c.resuelta_at, resueltaPor: c.resuelta_por, respuesta: c.respuesta,
    minutos: minutos(c.entrada, c.salida),
  }));
  const aLaVista = c => (c && (c.estado === 'pendiente' || c.estado === 'rechazada') ? c : null);
  const deJornada = id => aLaVista(pedidas.find(c => !c.nueva && c.fichajeId === id));
  const deDia = dd => aLaVista(pedidas.find(c => c.nueva && !c.fichajeId && c.dia === dd));

  const filas = (await repo.delRango(usuarioId, desde, hasta)).map(f => ({
    ...f,
    id: Number(f.id),
    minutos: minutos(f.entrada, f.salida),
    // Lo que se pulsó, si luego se corrigió. Es lo que hace auditable el registro.
    corregido: !!f.corregido_at,
    // Abierta mientras se trabaja, pendiente hasta que alguien la mira,
    // aprobada cuando la dan por buena. No se guarda: se deduce, y así no
    // puede contradecir a las horas (ver db/132).
    estado: !f.salida ? 'abierta' : (f.aprobado_at ? 'aprobada' : 'pendiente'),
    correccion: deJornada(Number(f.id)),
  }));
  const total = filas.reduce((s, f) => s + (f.minutos || 0), 0);
  const cerradas = filas.filter(f => f.salida);

  // LOS SIETE DÍAS, SIEMPRE, aunque no se fichara ninguno. Una semana con tres
  // renglones no deja ver lo que falta; con siete, el hueco se ve solo.
  //
  // Sábado y domingo salen como LIBRA porque aquí se libra el fin de semana.
  // Pero si ese día hay fichaje, manda el fichaje: quien trabajó un sábado no
  // libró, y sus horas suman a la semana como las de cualquier otro día.
  const hoy = hoyMadrid();
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const dia = masDias(desde, i);
    const suyos = filas.filter(f => f.dia === dia);
    dias.push({
      dia, finde: i >= 5, futuro: dia > hoy, pasado: dia < hoy,
      libra: i >= 5 && !suyos.length,
      minutos: suyos.reduce((a, f) => a + (f.minutos || 0), 0),
      fichajes: suyos,
      // La jornada entera que pidió para ese día, si la pidió.
      pedida: deDia(dia),
    });
  }
  const aprueba = await quienAprueba();

  return {
    desde, hasta, dia: d, hoy, dias,
    filas, totalMinutos: total, total: comoTexto(total),
    // El fin de semana, aparte: son las horas que alguien echó cuando le tocaba
    // librar, y es justo lo que se quiere ver de un vistazo.
    finde: comoTexto(dias.filter(x => x.finde).reduce((a, x) => a + x.minutos, 0)),
    abiertas: filas.filter(f => !f.salida).length,
    // Las horas que ya cuentan de verdad, separadas de las que aún no ha
    // confirmado nadie: es lo primero que se mira al abrir el mes propio.
    aprobadas: comoTexto(cerradas.filter(f => f.estado === 'aprobada').reduce((s, f) => s + (f.minutos || 0), 0)),
    porConfirmar: cerradas.filter(f => f.estado === 'pendiente').length,
    // Para la pantalla: desde qué día se puede pedir una corrección, y quién
    // la va a aprobar (se le dice a la persona antes de pedirla).
    corregirDesde: masDias(hoy, -DIAS_ATRAS),
    aprueba: aprueba ? aprueba.quien : null,
    correccionesPendientes: pedidas.filter(c => c.estado === 'pendiente').length,
  };
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
    aprobado: !!f.aprobado_at,
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
 * LA SEMANA DE TODOS: una fila por persona, una columna por día.
 *
 * Es la pantalla que contesta las dos preguntas que se hacen de verdad —cuánto
 * lleva cada uno esta semana y qué día falta— sin tener que abrir siete partes
 * diarios y sumarlos a mano.
 *
 * Cada casilla lleva sus minutos y si queda algo por confirmar en ese día: un
 * número que todavía puede cambiar no se lee igual que uno cerrado.
 */
async function semanaDeTodos(dia) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : hoyMadrid();
  const desde = lunesDe(d), hasta = masDias(desde, 6);
  const hoy = hoyMadrid();
  const filas = await repo.semanaDeTodos(desde, hasta);

  const porPersona = new Map();
  filas.forEach(f => {
    if (!porPersona.has(f.usuario_id)) {
      porPersona.set(f.usuario_id, {
        usuarioId: Number(f.usuario_id), quien: f.quien,
        // Quien ya no ficha pero fichó esa semana sale marcado: si no, parece
        // que se le olvidó el resto de la semana y lo que pasa es otra cosa.
        yaNoFicha: !f.ficha_obligatorio,
        dias: [], minutos: 0, porConfirmar: 0, abiertas: 0,
      });
    }
    const p = porPersona.get(f.usuario_id);
    if (!f.id) return;                       // salió por el LEFT JOIN: no fichó nada
    const min = minutos(f.entrada, f.salida) || 0;
    p.minutos += min;
    if (!f.salida) p.abiertas++;
    else if (!f.aprobado_at) p.porConfirmar++;
    p.dias.push({ dia: f.dia, minutos: min, abierta: !f.salida, pendiente: !!f.salida && !f.aprobado_at });
  });

  // La rejilla: siete casillas por persona, estén o no. Una semana con huecos
  // se lee sola; una lista de solo lo que hay, no.
  const semana = [];
  for (let i = 0; i < 7; i++) semana.push({ dia: masDias(desde, i), finde: i >= 5 });

  const personas = [...porPersona.values()].map(p => ({
    usuarioId: p.usuarioId, quien: p.quien, yaNoFicha: p.yaNoFicha,
    minutos: p.minutos, total: comoTexto(p.minutos),
    porConfirmar: p.porConfirmar, abiertas: p.abiertas,
    casillas: semana.map(c => {
      const suyos = p.dias.filter(x => x.dia === c.dia);
      const min = suyos.reduce((a, x) => a + x.minutos, 0);
      return {
        dia: c.dia, finde: c.finde, minutos: min, cuantos: suyos.length,
        // Sábado y domingo se libran, salvo que ese día haya fichaje.
        libra: c.finde && !suyos.length,
        futuro: c.dia > hoy,
        abierta: suyos.some(x => x.abierta),
        pendiente: suyos.some(x => x.pendiente),
      };
    }),
  }));

  const totalMin = personas.reduce((a, p) => a + p.minutos, 0);
  return {
    desde, hasta, dia: d, hoy, semana, personas,
    // El pie de la tabla: lo que echó la empresa cada día y en toda la semana.
    porDia: semana.map((c, i) => comoTexto(personas.reduce((a, p) => a + p.casillas[i].minutos, 0))),
    totalMinutos: totalMin, total: comoTexto(totalMin),
    porConfirmar: personas.reduce((a, p) => a + p.porConfirmar, 0),
  };
}

/**
 * Lo que espera un visto bueno, de todo el mundo.
 *
 * Es la pantalla de quien lleva el módulo: aquí están las jornadas cerradas que
 * nadie ha confirmado, con sus horas ya sumadas para poder leerlas de un
 * vistazo antes de darlas por buenas.
 */
async function pendientes() {
  const filas = (await repo.pendientes()).map(f => ({
    ...f,
    id: Number(f.id), usuario_id: Number(f.usuario_id),
    minutos: minutos(f.entrada, f.salida),
    corregido: !!f.corregido_at,
    correccionPedida: !!f.correccion_pedida,
  }));
  const total = filas.reduce((s, f) => s + (f.minutos || 0), 0);
  return { filas, cuantas: filas.length, totalMinutos: total, total: comoTexto(total) };
}

/**
 * Da por buenas unas horas. Devuelve cuántas se sellaron de verdad.
 *
 * No se queja si alguna ya estaba aprobada o sigue abierta: se queda fuera y
 * ya está. Aprobar en tanda no puede fallar entero por una fila rara — el que
 * aprueba está mirando una lista que pudo cambiar hace diez segundos.
 */
async function aprobar(ids, autor) {
  if (!autor) throw new Error('No se sabe quién está aprobando');
  await exigirLlave(autor);
  const hechos = await repo.aprobar(ids, autor);
  return { aprobados: hechos.length, ids: hechos };
}

// Lo que escribe una persona al corregir es HORA DE MADRID y llega sin zona:
// 'AAAA-MM-DDTHH:MM'. Se exige ese formato exacto y se rechaza cualquier otro
// —una Z al final, un desfase, un instante ya convertido— porque la base lo va
// a leer como hora de aquí: colar un UTC ahí dentro mueve el fichaje dos horas
// sin que nadie se entere. Mejor un error claro que una hora mentirosa.
const HORA_ESCRITA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
function horaDeMadrid(v, campo) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (s === 'abierta') return s;                    // volver a dejarla sin cerrar
  if (!HORA_ESCRITA.test(s)) {
    throw new Error('La ' + campo + ' tiene que venir como AAAA-MM-DDTHH:MM, en hora de Madrid');
  }
  return s.length === 16 ? s + ':00' : s;
}

/**
 * Corrige o crea un fichaje. El candado está en la ruta ('/fichaje/revisar');
 * aquí se exige lo que hace que la corrección valga: un motivo.
 *
 * Y ojo: corregir TUMBA la aprobación, la vuelva a pedir quien la tumbó o no.
 * Lo hace el repositorio en el mismo UPDATE.
 */
async function corregir({ id, usuarioId, entrada, salida }, { autor, motivo }) {
  await exigirLlave(autor);
  const m = String(motivo || '').trim();
  if (m.length < 4) throw new Error('Hay que escribir el motivo de la corrección');
  const e = horaDeMadrid(entrada, 'entrada'), sa = horaDeMadrid(salida, 'salida');
  if (id) return repo.corregir(Number(id), { entrada: e, salida: sa }, { usuarioId: autor, motivo: m });
  if (!usuarioId || !e) throw new Error('Para crear un fichaje hacen falta la persona y la hora de entrada');
  return repo.crearAMano(Number(usuarioId), { entrada: e, salida: sa }, { autor, motivo: m });
}

// ── Quién aprueba ──────────────────────────────────────────────────────────

/** Si alguien tiene la llave de aprobar DE VERDAD: en su matriz, no por su rol. */
async function tieneLlave(usuarioId) {
  if (!usuarioId) return false;
  return (await permisos.clavesDe(usuarioId)).has(LLAVE);
}

async function exigirLlave(usuarioId) {
  if (await tieneLlave(usuarioId)) return;
  const q = await quienAprueba();
  throw new Error('Esto solo lo puede hacer quien lleva el registro de jornada' +
    (q ? ' (' + q.quien + ')' : '') + ': la llave la tiene una sola persona y no va con el rol');
}

// Quién tiene la llave cambia muy de vez en cuando: un minuto de memoria basta.
let cacheQuien = null, tsQuien = 0;
async function quienAprueba() {
  if (Date.now() - tsQuien > 60 * 1000) { cacheQuien = await repo.quienAprueba(); tsQuien = Date.now(); }
  return cacheQuien;
}

// ── Cada uno pide la corrección de lo suyo (db/159) ───────────────────────

/**
 * Pide corregir una jornada propia, o una jornada que no fichó.
 *
 * NO cambia el fichaje: lo deja pedido para que lo apruebe quien lleva el
 * registro. La única excepción es la jornada que se quedó ABIERTA de un día
 * pasado: se cierra ya con la hora de ahora (como si pulsara «Salir», que es
 * lo que habría hecho) para que pueda volver a fichar hoy, y la hora buena de
 * salida es lo que queda pedido.
 *
 * El id de la persona sale SIEMPRE de la sesión: cada uno corrige lo suyo.
 */
async function pedirCorreccion(usuarioId, { fichajeId, entrada, salida, motivo } = {}) {
  const u = await usuarios.buscarUsuarioPorId(usuarioId);
  if (!u || !u.fichaObligatorio) throw new Error('Tu cuenta no tiene el fichaje activado');

  const m = String(motivo || '').trim();
  if (m.length < 4) throw new Error('Escribe el motivo: quien lo aprueba tiene que saber qué pasó');
  if (m.length > MOTIVO_MAX) throw new Error('El motivo es demasiado largo (máximo ' + MOTIVO_MAX + ' caracteres)');
  const e = horaDeMadrid(entrada, 'entrada'), sa = horaDeMadrid(salida, 'salida');
  if (e === 'abierta' || sa === 'abierta') throw new Error('Una corrección no puede dejar la jornada abierta');

  const hoy = hoyMadrid();
  let f = null, cerrarAhora = false;
  if (fichajeId) {
    f = await repo.fichajePorId(Number(fichajeId));
    if (!f || Number(f.usuario_id) !== Number(usuarioId)) throw new Error('Esa jornada no es tuya');
  } else if (!e || !sa) {
    throw new Error('Para pedir una jornada que no fichaste hacen falta la entrada y la salida');
  }

  // Lo que no se escribe se queda como está.
  const pEntrada = e ? await repo.aInstante(e) : f.entrada;
  const pSalida = sa ? await repo.aInstante(sa) : (f ? f.salida : null);

  if (f && !f.salida && f.dia < hoy) {
    // Se fue sin fichar la salida: sin ella no hay nada que pedir.
    if (!sa) throw new Error('Esa jornada es del ' + diaCorto(f.dia) + ' y sigue abierta: pon a qué hora saliste');
    cerrarAhora = true;
  }
  if (f && !cerrarAhora && mismo(pEntrada, f.entrada) && mismo(pSalida, f.salida)) {
    throw new Error('Lo que pides es lo que ya hay: no cambia nada');
  }

  const ahora = Date.now(), margen = 5 * 60 * 1000;
  if (new Date(pEntrada).getTime() > ahora + margen) throw new Error('La entrada no puede ser en el futuro');
  if (pSalida && new Date(pSalida).getTime() > ahora + margen) throw new Error('La salida no puede ser en el futuro');
  if (pSalida && new Date(pSalida) <= new Date(pEntrada)) throw new Error('La salida tiene que ser después de la entrada');
  if (pSalida && minutos(pEntrada, pSalida) > MAX_JORNADA_MIN) {
    throw new Error('Más de 16 horas seguidas no es una jornada: revisa las horas');
  }
  const limite = masDias(hoy, -DIAS_ATRAS);
  if (diaDe(pEntrada) < limite || (f && f.dia < limite)) {
    throw new Error('Solo se pueden pedir correcciones de los últimos ' + DIAS_ATRAS +
      ' días. Para algo más antiguo, habla con quien lleva el registro');
  }
  const pisa = await repo.haySolape(usuarioId, pEntrada, pSalida, f ? f.id : null);
  if (pisa) {
    throw new Error('Se pisa con tu jornada de ' + horaDe(pisa.entrada) + ' a ' +
      (pisa.salida ? horaDe(pisa.salida) : 'ahora') + ' del ' + diaCorto(diaDe(pisa.entrada)));
  }

  const r = await repo.pedirCorreccion({
    usuarioId, fichajeId: f ? f.id : null, nueva: !f,
    entrada: pEntrada, salida: pSalida, motivo: m, cerrarAhora,
  });
  console.log(`✏️  [FICHAJE] ${u.email} pide ${f ? 'corregir la jornada ' + f.id : 'una jornada el ' + r.dia}` +
    `${cerrarAhora ? ' (se cierra ya la que estaba abierta)' : ''}: ${m.slice(0, 80)}`);
  return { correccion: { ...r, id: Number(r.id) }, cerrada: cerrarAhora };
}

/** Retira una petición propia que nadie ha resuelto. */
async function retirarCorreccion(usuarioId, id) {
  const r = await repo.retirarCorreccion(Number(id), usuarioId);
  if (!r) throw new Error('Esa corrección ya no está pendiente');
  return { id: Number(r.id) };
}

/** Las peticiones que esperan, con cómo está la jornada ahora y cómo quedaría. */
async function correccionesPendientes() {
  const filas = (await repo.correccionesPendientes()).map(c => ({
    id: Number(c.id), usuarioId: Number(c.usuario_id), quien: c.quien,
    fichajeId: c.fichaje_id ? Number(c.fichaje_id) : null, nueva: c.nueva, dia: c.dia,
    entrada: c.entrada, salida: c.salida, motivo: c.motivo, pedidaAt: c.pedida_at,
    entradaAhora: c.entrada_ahora, salidaAhora: c.salida_ahora,
    // Sin salida pedida, se queda la que tenga (corrige solo la entrada de hoy).
    minutosPedidos: minutos(c.entrada, c.salida || c.salida_ahora),
    minutosAhora: minutos(c.entrada_ahora, c.salida_ahora),
    // La jornada cambió después de pedirlo (la corrigió alguien a mano): lo
    // que se aprueba es lo que se pide, pero conviene saberlo antes.
    cambioDespues: !c.nueva && (!mismo(c.entrada_antes, c.entrada_ahora) || !mismo(c.salida_antes, c.salida_ahora)),
  }));
  return { filas, cuantas: filas.length };
}

/** Cuántas esperan. Lo pregunta la barra de arriba de quien tiene la llave. */
const cuantasCorrecciones = () => repo.cuantasCorrecciones();

/**
 * Aprueba o rechaza una petición. Aprobar la aplica y deja la jornada
 * confirmada; rechazar exige decir por qué.
 */
async function resolverCorreccion(id, { aprobar, respuesta } = {}, autor) {
  await exigirLlave(autor);
  if (aprobar !== true && aprobar !== false) throw new Error('Falta decir si se aprueba o se rechaza');
  const resp = String(respuesta || '').trim();
  if (!aprobar && resp.length < 4) throw new Error('Di por qué la rechazas: quien la pidió tiene que saber qué hacer');
  if (resp.length > MOTIVO_MAX) throw new Error('La respuesta es demasiado larga (máximo ' + MOTIVO_MAX + ' caracteres)');
  const r = await repo.resolverCorreccion(Number(id), { aprobar, respuesta: resp || null, autor });
  console.log(`${aprobar ? '✅' : '❌'} [FICHAJE] Corrección ${r.id} ${r.estado}` +
    `${r.fichaje_id ? ' (jornada ' + r.fichaje_id + ')' : ''}${resp ? ': ' + resp.slice(0, 80) : ''}`);
  return { id: Number(r.id), estado: r.estado, fichajeId: r.fichaje_id ? Number(r.fichaje_id) : null };
}

/** Lo que quedó sin cerrar en días pasados. */
const sinCerrar = () => repo.sinCerrar();

/** Quién tiene que fichar hoy. */
const losQueFichan = () => usuarios.losQueFichan();

module.exports = {
  estado, entrar, salir, miSemana, parteDelDia, corregir, sinCerrar, losQueFichan,
  pendientes, aprobar, semanaDeTodos, comoTexto, hoyMadrid,
  tieneLlave, quienAprueba, pedirCorreccion, retirarCorreccion, correccionesPendientes,
  cuantasCorrecciones, resolverCorreccion, DIAS_ATRAS,
};
