/**
 * Conversación de FICHAJE DE TURNO en WhatsApp (capa de mensajes).
 *
 * Vive aparte del bot para que el enganche en routes/botPuertas.js sea de unas pocas
 * líneas: manejarTexto/manejarBoton devuelven `true` si se han hecho cargo del
 * mensaje, y `false` si no es cosa suya (entonces el bot sigue como siempre).
 *
 * EN PRUEBAS: solo actúa para los teléfonos de FICHAJE_TELEFONOS. Para cualquier otro
 * número devuelve false siempre, así que el comportamiento del bot no cambia en nada.
 */

const fichaje = require('./fichaje');
const { enviarTexto, enviarBotones } = require('./whatsapp');

const BTN_INICIAR = 'turno_iniciar';
const BTN_TERMINAR = 'turno_terminar';
const BTN_KM = 'turno_km';

// Espera de matrícula tras pulsar "Iniciar turno" (en memoria: si Render reinicia, el
// conductor solo tiene que volver a pulsar el botón).
const esperando = new Map();
const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);
const MAT = /^[A-Za-z0-9]{6,8}$/;

/** Panel principal: según haya turno abierto o no, ofrece unos botones u otros. */
async function panel(telefono, cabecera) {
  const { abierto, turno } = await fichaje.estado(telefono);
  const nombre = fichaje.nombreDe(telefono) || 'conductor';
  if (abierto) {
    const desde = fichaje.horaES(turno.inicio);
    const txt = (cabecera ? cabecera + '\n\n' : '') +
      `🟢 *Turno abierto*\n🚘 ${turno.matricula}\n🕐 Desde las ${desde}\n\n` +
      `Cuando acabes pulsa *Terminar turno* y te digo los km que has hecho.`;
    await enviarBotones(telefono, txt, [
      { id: BTN_TERMINAR, titulo: '🔴 Terminar turno' },
      { id: BTN_KM, titulo: '📍 Ver km ahora' }
    ]);
  } else {
    const txt = (cabecera ? cabecera + '\n\n' : `👋 Hola ${nombre}.\n\n`) +
      'No tienes ningún turno abierto. Pulsa *Iniciar turno* y dime la matrícula del coche que vas a llevar.';
    await enviarBotones(telefono, txt, [{ id: BTN_INICIAR, titulo: '🟢 Iniciar turno' }]);
  }
  return true;
}

/** Texto recibido. Devuelve true si el fichaje se ha ocupado del mensaje. */
async function manejarTexto(telefono, texto) {
  if (!fichaje.esPruebas(telefono)) return false;
  const t = String(texto || '').trim();

  // Si se le pidió la matrícula, lo siguiente que escriba se interpreta como tal.
  if (esperando.get(tel9(telefono))) {
    if (!MAT.test(t)) {
      await enviarTexto(telefono, '❌ Eso no parece una matrícula. Escríbela sin espacios ni guiones (ejemplo: *1234ABC*), o escribe *cancelar*.');
      if (/^cancelar$/i.test(t)) { esperando.delete(tel9(telefono)); await panel(telefono, '❎ Cancelado.'); }
      return true;
    }
    esperando.delete(tel9(telefono));
    await abrirTurno(telefono, t);
    return true;
  }

  if (/^cancelar$/i.test(t)) { await panel(telefono, '❎ Cancelado.'); return true; }
  if (/km/i.test(t) && t.length < 12) { await verKm(telefono); return true; }
  await panel(telefono);
  return true;
}

/** Botón pulsado. Devuelve true si era del fichaje. */
async function manejarBoton(telefono, buttonId) {
  if (!fichaje.esPruebas(telefono)) return false;
  if (buttonId === BTN_INICIAR) {
    const { abierto } = await fichaje.estado(telefono);
    if (abierto) { await panel(telefono, '⚠️ Ya tenías un turno abierto.'); return true; }
    esperando.set(tel9(telefono), Date.now());
    await enviarTexto(telefono, '🚘 Escribe la *matrícula* del coche que vas a llevar (sin espacios ni guiones).\n\nEjemplo: *1234ABC*');
    return true;
  }
  if (buttonId === BTN_TERMINAR) { await cerrarTurno(telefono); return true; }
  if (buttonId === BTN_KM) { await verKm(telefono); return true; }
  return false;
}

async function abrirTurno(telefono, matricula) {
  const nombre = fichaje.nombreDe(telefono) || 'Conductor';
  let r;
  try {
    r = await fichaje.iniciar({ telefono, nombre, matricula });
  } catch (e) {
    console.error('❌ [FICHAJE] iniciar:', e.message);
    await enviarTexto(telefono, `❌ No se pudo abrir el turno: ${e.message}`);
    return;
  }
  if (!r.ok) {
    if (r.motivo === 'sin-matricula') {
      await enviarTexto(telefono, `❌ La matrícula *${matricula}* no está en Mapon. Comprueba que sea la correcta y vuelve a pulsar *Iniciar turno*.`);
      return panel(telefono);
    }
    if (r.motivo === 'coche-ocupado') {
      await enviarTexto(telefono, `⚠️ Ese coche ya lo tiene *${r.turno.nombre}* desde las ${fichaje.horaES(r.turno.inicio)}. Si es un error, avisa a Tráfico.`);
      return panel(telefono);
    }
    if (r.motivo === 'ya-abierto') return panel(telefono, '⚠️ Ya tenías un turno abierto.');
    await enviarTexto(telefono, '❌ No se pudo abrir el turno.');
    return;
  }
  const t = r.turno;
  // El estado del motor va DESTACADO: si no se pudo liberar, hay que saberlo antes de
  // subirse al coche, no descubrirlo al girar la llave.
  const motor = !r.bloqueoActivo ? ''
    : (r.motor && r.motor.hecho)
      ? '\n🔓 *Motor desbloqueado* — ya puedes arrancar'
      : `\n🔒 *ATENCIÓN: el motor NO se ha desbloqueado*\n_${(r.motor && r.motor.motivo) || 'motivo desconocido'}_\nAvisa a Tráfico antes de nada.`;
  await enviarBotones(telefono,
    `🟢 *Turno iniciado*\n\n🚘 ${t.matricula}${r.vehiculo ? ` · ${r.vehiculo}` : ''}\n🕐 ${fichaje.horaES(t.inicio)}\n` +
    `${r.enlazado ? '🔗 Enlazado a tu nombre en Mapon'
      : `⚠️ No se pudo enlazar en Mapon (el turno queda registrado igual)\n_${(r.errorMapon || 'motivo desconocido').slice(0, 220)}_`}` +
    `${motor}\n\nA partir de ahora cuento los km. Cuando acabes, pulsa *Terminar turno*.`,
    [{ id: BTN_TERMINAR, titulo: '🔴 Terminar turno' }, { id: BTN_KM, titulo: '📍 Ver km ahora' }]);
}

async function verKm(telefono) {
  const { abierto, turno } = await fichaje.estado(telefono);
  if (!abierto) return panel(telefono, 'No tienes ningún turno abierto.');
  const km = await fichaje.kmDelTurno(turno);
  const dur = fichaje.duracion(Math.floor(Date.now() / 1000) - turno.inicio);
  await enviarBotones(telefono,
    km ? `📍 *Llevas ${km.km} km* en ${turno.matricula}\n🕐 ${dur} de turno · ${km.trayectos} trayecto(s)`
       : `📍 Turno en ${turno.matricula} · ${dur}\n(No he podido leer los km ahora mismo)`,
    [{ id: BTN_TERMINAR, titulo: '🔴 Terminar turno' }, { id: BTN_KM, titulo: '📍 Actualizar' }]);
}

async function cerrarTurno(telefono) {
  let r;
  try {
    r = await fichaje.terminar(telefono);
  } catch (e) {
    console.error('❌ [FICHAJE] terminar:', e.message);
    await enviarTexto(telefono, `❌ No se pudo cerrar el turno: ${e.message}`);
    return;
  }
  if (!r.ok) return panel(telefono, '⚠️ No tenías ningún turno abierto.');
  const t = r.turno;
  const dur = fichaje.duracion(t.fin - t.inicio);
  // El dato de atribución sirve para saber si Mapon SELLA el conductor en el histórico
  // o lo resuelve al vuelo; hasta confirmarlo, la prueba buena es el libro de turnos.
  const atrib = r.km && r.km.trayectos
    ? `\n🔎 Mapon atribuyó ${r.km.conConductor}/${r.km.trayectos} trayecto(s) a un conductor`
    : '';
  const motor = !r.bloqueoActivo ? ''
    : (r.motor && r.motor.hecho)
      ? '\n🔒 Motor bloqueado hasta el próximo turno'
      : `\n⚠️ El motor NO se ha bloqueado (_${(r.motor && r.motor.motivo) || 'motivo desconocido'}_)`;
  await enviarBotones(telefono,
    `🔴 *Turno terminado*\n\n🚘 ${t.matricula}\n🕐 ${fichaje.horaES(t.inicio)} → ${fichaje.horaES(t.fin)} (${dur})\n` +
    `🛣️ *${t.km == null ? '—' : t.km} km* recorridos${atrib}${motor}\n\nGracias. Queda registrado.`,
    [{ id: BTN_INICIAR, titulo: '🟢 Iniciar turno' }]);
}

module.exports = { manejarTexto, manejarBoton, panel };
