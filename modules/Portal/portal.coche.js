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
'use strict';

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

module.exports = { estado, vincular, moverPuertas, desvincular, _limpiar: limpiar };
