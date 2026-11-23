// ============================================================
// PORTAL DE CONDUCTORES — EL COCHE: vincular, puertas y desvincular
// ============================================================
// Camilo, 20/11/2026: «créales el módulo de vincular coche, ahí podrán abrir y
// cerrar coches, solo luego de vincularse, sino no. Es empezar a migrar el
// ciclo de motor sacándolo de WhatsApp y dejándolo en su app».
//
// NO HAY UNA SEGUNDA LÓGICA DEL COCHE. Todo pasa por las MISMAS funciones que
// el bot de WhatsApp (services/fichaje.js y services/puertasBot.js), con el
// teléfono de su ficha, que es como el bot sabe quién es. Así:
//   · vincular aquí y desvincular por WhatsApp (o al revés) es el mismo coche;
//   · las reglas del motor no se duplican: desbloquear al vincular, NUNCA
//     cortar con el contacto puesto, las órdenes de un coche en fila, el coche
//     que pasa de manos…;
//   · abrir y cerrar solo con un coche vinculado, y solo el SUYO.
// Aquí solo se traduce cada respuesta a un mensaje para la web, con las
// palabras del bot desde el 13/11/2026: «vincular», nunca «turno» ni «fichar».
//
// UBICACIÓN EN VIVO Y LAS CINCO FOTOS (23/11/2026). Camilo: «en el apartado
// del coche que le toca, tiene que poner "Ver ubicación en vivo". Que le
// aparezca el estado tal cual, si está rodando, si está parado y bloqueado, si
// está fichado por alguien, etc.» Y: «cuando termine el turno, el sistema le
// pedirá 5 fotos (…) los conductores ligados al coche pueden ver las fotos con
// las que terminó el turno anterior a él, todo eso se guardará en R2, las
// fotos tendrán que ser obligatorias para cerrar el turno (…) es una
// transición, así que todavía se puede terminar el turno por WhatsApp sin
// pedir fotos, pero en la app tiene que ser obligatorio».
//   · EL COCHE QUE LE TOCA: el que tiene vinculado; si no, el de hoy en su
//     planificación («Mis turnos»).
//   · EN VIVO: lo del mapa de flota (modules/Mapa: Mapon, el motor y quién lo
//     tiene vinculado), solo de ese coche.
//   · LAS FOTOS: adjuntos del turno de fichaje (tipo «turno_fotos», dueño el
//     id de su fila en fichaje_turno), en R2. Las ve quien tiene ese coche hoy.
//     El turno cerrado por WhatsApp no tiene: se dice que estarán próximamente.
'use strict';

const { Readable } = require('stream');

const fichaje = require('../../services/fichaje');
const puertas = require('../../services/puertasBot');
const { SEDE_FLOTA } = require('../../services/nucleo');

/** La matrícula como la escribe Tráfico: mayúsculas, sin espacios ni guiones. */
const limpiar = m => String(m || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12);
const hora = seg => fichaje.horaES(seg);

const SIN_TELEFONO = { ok: false, tono: 'error', titulo: 'Tu ficha no tiene teléfono',
  texto: ['El coche se vincula con el teléfono de tu ficha. Habla con RRHH para que lo pongan.'] };
const NO_PARTICIPA = { ok: false, tono: 'error', titulo: 'No tienes activado el uso de coches',
  texto: ['Si crees que es un error, avisa a Tráfico.'] };
const FALLO = que => ({ ok: false, tono: 'error', titulo: `No se ha podido ${que}`,
  texto: ['Prueba otra vez en un momento. Si sigue igual, comunícate con Tráfico.'] });
const SIN_MAPON = 'Ahora mismo no se puede tocar el motor ni las puertas por un problema con un proveedor externo, ajeno a Telecab. ' +
  'Si el coche no arranca o no puedes entrar, comunícate con Tráfico.';

/** Lo que hace falta de quien mira: su teléfono (de su ficha) y si usa coches. */
async function quien(persona) {
  if (!persona || !persona.telefono) return { error: SIN_TELEFONO };
  const p = await fichaje.participa(persona.telefono);
  if (!p) return { error: NO_PARTICIPA };
  return { telefono: persona.telefono, p };
}

/** El coche que tiene vinculado ahora (o ninguno). */
async function estado(persona) {
  const q = await quien(persona);
  if (q.error) return { puede: false, aviso: q.error };
  const { abierto, turno } = await fichaje.estado(q.telefono);
  if (!abierto) return { puede: true, vinculado: false };
  return {
    puede: true, vinculado: true, matricula: turno.matricula, desde: hora(turno.inicio),
    entregando: turno.relevo ? hora(turno.relevo) : null, oficina: turno.tipo === 'viaje',
  };
}

/** Vincular un coche: lo mismo que escribir la matrícula al bot. Desbloquea el motor. */
async function vincular(persona, matriculaEscrita) {
  const q = await quien(persona);
  if (q.error) return q.error;
  const matricula = limpiar(matriculaEscrita);
  if (matricula.length < 4) return { ok: false, tono: 'error', titulo: 'Escribe la matrícula', texto: ['Todo junto, por ejemplo 1234ABC.'] };
  let r;
  try { r = await fichaje.iniciar({ telefono: q.telefono, matricula }); }
  catch (e) { console.error('❌ [Portal] vincular:', e.message); return FALLO('vincular el coche'); }
  if (!r.ok) {
    const revisa = 'Revisa la matrícula y escríbela otra vez, todo junto (por ejemplo 1234ABC). Si es correcta, comunícate con Tráfico.';
    const m = {
      'no-participa': NO_PARTICIPA,
      'otra-sede': { titulo: `El ${r.matricula} es un coche de ${r.sede}`, texto: ['Desde aquí no se lleva.', revisa] },
      'coche-sin-sede': { titulo: `El ${r.matricula} no es un coche de ${r.sedePersona}`, texto: [revisa] },
      'sin-matricula': { titulo: `No encuentro la matrícula ${matricula}`, texto: [revisa] },
      // Barcelona: solo el coche que le da el planificador ese día (23/11/2026).
      'no-es-su-coche': { titulo: `El ${r.matricula} no es tu coche de hoy`,
        texto: [require('../../services/fichajeBot').textoNoEsSuCoche(r).replace(/^❌ /, '')] },
      'ocupado-en-marcha': { titulo: `El ${r.turno && r.turno.matricula} está en marcha`,
        texto: [`Va a ${r.velocidad} km/h y lo tiene ${r.turno && r.turno.nombre}. Cuando esté parado y apagado, vuelve a vincularlo y pasa a ser tuyo.`] },
      'ocupado-encendido': { titulo: `El ${r.turno && r.turno.matricula} tiene el contacto puesto`,
        texto: [`Apágalo y vuelve a vincularlo: se le desvincula a ${r.turno && r.turno.nombre} y el coche pasa a ser tuyo.`] },
      'coche-ocupado': { titulo: `El ${r.turno && r.turno.matricula} figura todavía con ${r.turno && r.turno.nombre}`,
        texto: ['Pídele que lo entregue o lo desvincule y vuelve a probar. Si no puedes localizarle, avisa a Tráfico.'] },
      'ya-abierto': { tono: 'aviso', titulo: 'Ya tienes un coche vinculado', texto: ['Desvincúlalo antes de coger otro.'] },
    }[r.motivo];
    return { ok: false, tono: 'error', ...(m || FALLO('vincular el coche')) };
  }
  // A quien tenía el coche se le avisa por WhatsApp, como cuando se vincula por el
  // bot: si no, se queda esperando a que alguien le diga que ya puede irse.
  if (r.relevoDe) {
    try { require('../../services/fichajeBot').avisarAlQueEntrega(r.relevoDe, r.quien && r.quien.nombre).catch(() => {}); }
    catch (_) { /* sin bot, sin aviso: el coche ya es suyo igual */ }
  }
  const texto = [];
  const mo = r.motor || {};
  let tono = 'ok';
  // El motor, lo primero: si no se pudo soltar, hay que saberlo antes de subirse.
  if (r.bloqueoActivo) {
    if (mo.hecho) texto.push(mo.yaEstaba ? 'El motor ya está libre: puedes arrancar.' : 'Motor desbloqueado: ya puedes arrancar.');
    else { tono = 'error'; texto.push(`El motor NO se ha desbloqueado (${mo.motivo || 'motivo desconocido'}). Vuelve a vincularlo en un momento; si sigue igual, avisa a Tráfico.`); }
  }
  if (r.sinMapon) { tono = 'aviso'; texto.push(SIN_MAPON); }
  if (r.relevoDe) texto.push(`El coche figuraba con ${r.relevoDe.nombre}: se le ha desvinculado y desde ahora el responsable eres tú.`);
  return { ok: true, tono, titulo: `${r.turno.matricula} vinculado`, texto };
}

/** Abrir o cerrar las puertas: solo con un coche vinculado, y solo el suyo. */
async function moverPuertas(persona, abrir) {
  const q = await quien(persona);
  if (q.error) return q.error;
  const { abierto, turno } = await fichaje.estado(q.telefono);
  if (!abierto) return { ok: false, tono: 'aviso', titulo: 'Primero vincula el coche', texto: ['Las puertas se abren y se cierran solo con un coche vinculado.'] };
  let r;
  try {
    r = await puertas.ejecutar({
      telefono: q.telefono, conductorId: turno.conductorId, nombre: turno.nombre,
      matricula: turno.matricula, unitId: turno.unitId, abrir,
      sede: q.p.soloCerrar ? null : (q.p.sede || SEDE_FLOTA),
    });
  } catch (e) { console.error('❌ [Portal] puertas:', e.message); r = { ok: false }; }
  if (!r.ok) {
    return r.sinMapon ? { ok: false, tono: 'error', titulo: 'No se pueden mover las puertas', texto: [SIN_MAPON] }
      : FALLO(abrir ? 'abrir las puertas' : 'cerrar las puertas');
  }
  return { ok: true, tono: 'ok', titulo: abrir ? 'Puertas abiertas' : 'Puertas cerradas', texto: [turno.matricula] };
}

/**
 * Desvincular: lo mismo que «Desvincular vehículo» del bot. Bloquea el motor,
 * así que NO se hace en marcha ni con el contacto puesto (la regla de oro: con
 * el corte puesto y el contacto dado, el coche ya no se deja apagar).
 */
async function desvincular(persona) {
  const q = await quien(persona);
  if (q.error) return q.error;
  let r;
  try { r = await fichaje.terminar(q.telefono); }
  catch (e) { console.error('❌ [Portal] desvincular:', e.message); return FALLO('desvincular el coche'); }
  if (!r.ok && r.motivo === 'coche-en-marcha') {
    return { ok: false, tono: 'aviso', titulo: 'Estás en marcha', texto: [
      `Vas a ${r.velocidad} km/h. Al desvincular se bloquea el motor: aparca en un sitio seguro, apaga el coche y vuelve a pulsar «Desvincular vehículo».`,
      'El coche sigue vinculado a ti.'] };
  }
  if (!r.ok && r.motivo === 'coche-encendido') {
    return { ok: false, tono: 'aviso', titulo: 'Apaga el coche primero', texto: [
      'Tienes el contacto puesto. Al desvincular se bloquea el motor, y si se hace ahora te quedas sin poder apagarlo.',
      'Apágalo del todo y vuelve a pulsar «Desvincular vehículo». El coche sigue vinculado a ti.'] };
  }
  if (!r.ok) return { ok: false, tono: 'aviso', titulo: 'No tenías ningún coche vinculado', texto: [] };
  const t = r.turno;
  const texto = [`Vinculado de ${hora(t.inicio)} a ${hora(t.fin)} (${fichaje.duracion(t.fin - t.inicio)}): ${t.km == null ? '—' : t.km} km.`];
  const mo = r.motor || {};
  const faltan = (r.faltan || []).join(', ');
  if (r.bloqueoActivo && !mo.sinControl) {
    if (mo.seQuedaLibre) texto.push(`El motor se queda libre: este coche también lo lleva ${faltan || 'otra persona'}.`);
    else if (mo.sinMapon) texto.push('El motor no se ha podido bloquear por un problema con un proveedor externo, ajeno a Telecab. Comunícate con Tráfico.');
    else if (mo.cogidoPor && (!mo.deshecho || mo.suelto)) texto.push(`El motor se queda libre: el coche ya lo tiene ${mo.cogidoPor}.`);
    else if (mo.hecho) texto.push(mo.yaEstaba ? 'El motor ya estaba bloqueado.' : 'Motor bloqueado hasta que alguien vuelva a vincularlo.');
    else texto.push(`El motor NO se ha bloqueado (${mo.motivo || 'motivo desconocido'}).${mo.reintentable ? ' Queda apuntado para Tráfico: no tienes que hacer nada más.' : ''}`);
  }
  return { ok: true, tono: 'ok', titulo: `${t.matricula} desvinculado`, texto };
}

// ── El coche que le toca: el vinculado, o el de hoy en su planificación ─────
async function matriculaDeHoy(persona) {
  const e = await estado(persona);
  if (e.vinculado) return { matricula: limpiar(e.matricula), vinculado: true };
  try {
    const t = await require('./portal.service').turnos(persona);
    const hoy = (t.dias || []).find(d => d.hoy && d.matricula);
    if (hoy) return { matricula: limpiar(hoy.matricula), vinculado: false, turno: hoy.turno || '' };
  } catch (err) { console.error('❌ [Portal] el coche de hoy:', err.message); }
  return { matricula: null, vinculado: false };
}

const nombreDePila = n => String(n || '').trim().split(/\s+/)[0] || '';
const haceTexto = s => (s == null ? '' : s < 90 ? 'hace un momento' : s < 3600 ? `hace ${Math.round(s / 60)} min`
  : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} días`);

/**
 * EN VIVO: dónde está y cómo está el coche que le toca. Lo dice el mapa de
 * flota (caché de 5 s): la posición de Mapon, si rueda, el motor y quién lo
 * tiene vinculado. Nunca el teléfono de nadie.
 */
async function enVivo(persona) {
  const hoy = await matriculaDeHoy(persona);
  if (!hoy.matricula) return { ok: true, matricula: null };
  let c = null;
  try {
    const f = await require('../Mapa/mapa.service').frente({ sedes: [SEDE_FLOTA] });
    c = (f.coches || []).find(x => limpiar(x.matricula) === hoy.matricula) || null;
  } catch (err) { console.error('❌ [Portal] en vivo:', err.message); return { ok: false, matricula: hoy.matricula }; }
  if (!c) return { ok: true, matricula: hoy.matricula, sinDatos: true };
  const lineas = [];
  let tono = 'ok';
  if (c.rueda) lineas.push(`Rodando${c.velocidad != null ? ` a ${Math.round(c.velocidad)} km/h` : ''}`);
  else if (c.motor && c.motor.cortado) { lineas.push('Parado y bloqueado'); tono = 'gris'; }
  else lineas.push('Parado');
  if (hoy.vinculado) lineas.push('Lo tienes vinculado tú');
  else if (c.fichaje && c.fichaje.nombre) { lineas.push(`Vinculado a ${nombreDePila(c.fichaje.nombre)}`); tono = 'aviso'; }
  else lineas.push('Nadie lo tiene vinculado');
  if (c.conectado && c.situacionEtiqueta) lineas.push(`En BOLT: ${String(c.situacionEtiqueta).toLowerCase()}`);
  if (c.estadoVehiculo && c.operativo === false) { lineas.push(`Estado: ${c.estadoVehiculo}`); tono = 'aviso'; }
  return {
    ok: true, matricula: hoy.matricula, vinculado: hoy.vinculado,
    lat: c.lat, lng: c.lng, rumbo: c.rumbo, rueda: !!c.rueda,
    tono, lineas, posicion: c.lat == null ? 'Sin posición del GPS' : `Posición ${haceTexto(c.antiguedad)}`,
  };
}

// ── LAS CINCO FOTOS al desvincular (23/11/2026) ──────────────────────────────
const FOTOS = [
  { campo: 'foto_conductor', etiqueta: 'Lateral de tu puerta (la del conductor)' },
  { campo: 'foto_frontal', etiqueta: 'Frontal' },
  { campo: 'foto_copiloto', etiqueta: 'Lateral del copiloto' },
  { campo: 'foto_trasera', etiqueta: 'Trasera' },
  { campo: 'foto_asientos', etiqueta: 'Asientos de atrás (los del pasajero)' },
];
const TIPO_FOTOS = 'turno_fotos';
const TOPE_FOTO = 20 * 1024 * 1024;
const db = require('../../services/db');
const adjuntos = require('../../services/adjuntos');

/** La matrícula de un turno de fichaje (por su fila). */
async function matriculaDelTurno(filaId) {
  const r = await db.consulta('SELECT matricula FROM fichaje_turno WHERE id = $1', [Number(filaId)]);
  return r.rows[0] ? limpiar(r.rows[0].matricula) : null;
}

// Quién ve las fotos: en el portal, quien tiene ESE coche hoy; en el ERP, la
// oficina. Las sube solo el sistema (al desvincular desde el portal).
adjuntos.registrarDueno(TIPO_FOTOS, {
  etiqueta: 'Fotos del coche al terminar',
  ver: async (quien, id) => (quien.portal
    ? (quien.portal.matriculas || []).includes(await matriculaDelTurno(id))
    : true),
  adjuntar: async () => false,
});

/** Quien mira desde el portal, para los adjuntos: el coche que le toca hoy. */
async function quienPortal(persona) {
  const hoy = await matriculaDeHoy(persona);
  return { id: `portal-${persona.id}`, portal: { conductorId: persona.id, matriculas: hoy.matricula ? [hoy.matricula] : [] } };
}

/**
 * LAS FOTOS DEL TURNO ANTERIOR del coche que le toca: el último turno cerrado
 * de esa matrícula (de otra persona o suyo). Sin fotos (se cerró por WhatsApp),
 * se dice que estarán próximamente.
 */
async function fotosAnteriores(persona) {
  const hoy = await matriculaDeHoy(persona);
  if (!hoy.matricula) return null;
  const r = await db.consulta(
    `SELECT id, nombre, fin FROM fichaje_turno
      WHERE estado <> 'abierto' AND fin IS NOT NULL
        AND upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g')) = $1
      ORDER BY fin DESC LIMIT 1`, [hoy.matricula]);
  const t = r.rows[0];
  if (!t) return { matricula: hoy.matricula, turno: null, fotos: [] };
  let fotos = [];
  try {
    fotos = (await adjuntos.lista(TIPO_FOTOS, String(t.id), await quienPortal(persona)))
      .filter(a => /^image\//.test(a.mime || ''))
      .map(a => ({ id: a.id, etiqueta: (FOTOS[Number(String(a.nombre).split('-')[0]) - 1] || {}).etiqueta || 'Foto' }));
  } catch (err) { console.error('❌ [Portal] fotos anteriores:', err.message); }
  return { matricula: hoy.matricula, turno: { nombre: nombreDePila(t.nombre), fin: hora(Math.floor(new Date(t.fin).getTime() / 1000)) }, fotos };
}

/** Una foto, si es del coche que le toca hoy: { estado, cabeceras, cuerpo }. */
async function foto(persona, adjuntoId) {
  return adjuntos.servir(adjuntoId, await quienPortal(persona));
}

/**
 * DESVINCULAR DESDE EL PORTAL: con las CINCO fotos, obligatorias. Primero se
 * mira que estén las cinco y que sean fotos; luego se desvincula (con sus
 * reglas: no en marcha, no con el contacto); y con el coche ya desvinculado,
 * las fotos se guardan en R2 atadas a ese turno. Si guardarlas falla, el coche
 * ya está desvinculado: se dice, para avisar a Tráfico.
 */
async function desvincularConFotos(persona, ficheros = {}) {
  const faltan = FOTOS.filter(f => !(ficheros[f.campo] && ficheros[f.campo][0] && ficheros[f.campo][0].size));
  if (faltan.length) {
    return { ok: false, tono: 'aviso', titulo: 'Faltan fotos', texto: [
      `Para desvincular hacen falta las cinco fotos. Te falta${faltan.length === 1 ? '' : 'n'}: ${faltan.map(f => f.etiqueta.toLowerCase()).join(', ')}.`] };
  }
  const noFoto = FOTOS.filter(f => !/^image\//.test(ficheros[f.campo][0].mimetype || ''));
  if (noFoto.length) {
    return { ok: false, tono: 'aviso', titulo: 'Eso no es una foto', texto: [`Revisa: ${noFoto.map(f => f.etiqueta.toLowerCase()).join(', ')}.`] };
  }
  const q = await quien(persona);
  if (q.error) return q.error;
  const antes = await fichaje.estado(q.telefono);
  const filaId = antes.abierto && antes.turno ? antes.turno.filaId : null;
  const r = await desvincular(persona);
  if (!r.ok || !filaId) return r;
  let guardadas = 0;
  for (let i = 0; i < FOTOS.length; i++) {
    const f = ficheros[FOTOS[i].campo][0];
    try {
      await adjuntos.subirDelSistema({
        tipo: TIPO_FOTOS, duenoId: String(filaId), nombre: `${i + 1}-${FOTOS[i].campo.replace('foto_', '')}.jpg`,
        mime: f.mimetype, cuerpo: Readable.from(f.buffer), firmante: null, creadoPor: null,
        origen: `portal · ficha ${persona.id}`, tope: TOPE_FOTO,
      });
      guardadas++;
    } catch (err) { console.error(`❌ [Portal] foto ${FOTOS[i].campo} del turno ${filaId}:`, err.message); }
  }
  if (guardadas < FOTOS.length) {
    return { ...r, tono: 'aviso', texto: [...r.texto,
      `Se han guardado ${guardadas} de las 5 fotos: avisa a Tráfico de que el coche se ha desvinculado sin todas las fotos.`] };
  }
  return { ...r, texto: [...r.texto, 'Fotos guardadas: el siguiente conductor verá cómo dejaste el coche.'] };
}

module.exports = { estado, vincular, moverPuertas, desvincular, desvincularConFotos, enVivo, fotosAnteriores, foto,
  matriculaDeHoy, FOTOS, TOPE_FOTO, _limpiar: limpiar };
