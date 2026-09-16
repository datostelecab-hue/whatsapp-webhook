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
const BTN_MOTOR = 'turno_motor';
// Abre el panel del turno desde el bot de puertas, sin salir de la conversación.
const BTN_PANEL = 'turno_panel';

// Espera de matrícula tras pulsar "Iniciar turno" (en memoria: si Render reinicia, el
// conductor solo tiene que volver a pulsar el botón).
const esperando = new Map();
const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);
const MAT = /^[A-Za-z0-9]{6,8}$/;

/** Panel principal: según haya turno abierto o no, ofrece unos botones u otros. */
async function panel(telefono, cabecera) {
  const { abierto, turno } = await fichaje.estado(telefono);
  // El mismo nombre que se pone en Mapon: su ficha, su usuario o, si no hay
  // ninguno, el de la lista de pruebas.
  const nombre = (await fichaje.nombreParaSaludar(telefono)) || 'conductor';
  if (abierto) {
    const desde = fichaje.horaES(turno.inicio);
    const txt = (cabecera ? cabecera + '\n\n' : '') +
      `🟢 *Turno abierto*\n🚘 ${turno.matricula}\n🕐 Desde las ${desde}\n\n` +
      `Cuando acabes, apaga el coche y pulsa *Terminar turno*: te digo los km que has hecho.`;
    await enviarBotones(telefono, txt, [
      { id: BTN_TERMINAR, titulo: '🔴 Terminar turno' },
      { id: BTN_KM, titulo: '📍 Ver km ahora' },
      { id: BTN_MOTOR, titulo: '🔓 Desbloquear' }
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

  // SOLO SE QUEDA LO QUE ES SUYO.
  //
  // Antes cualquier texto de un teléfono en pruebas abría el panel del turno y
  // devolvía `true`, y con eso el mensaje **nunca llegaba al bot de puertas**:
  // apuntar a alguien a las pruebas del fichaje le quitaba las puertas sin que
  // nadie lo hubiera decidido. Los dos bots comparten número, así que el fichaje
  // se queda su palabra y devuelve el resto.
  if (!/^(turno|turnos|fichaje|fichar|fichar turno)$/i.test(t)) return false;
  await panel(telefono);
  return true;
}

/**
 * El botón de turno para el panel de PUERTAS, o null si ese número no participa
 * en las pruebas del fichaje.
 *
 * Vive aquí para que el bot de puertas no tenga que saber nada del fichaje:
 * pregunta, y pone lo que le den. Es lo que permite a la misma persona abrir el
 * coche y fichar sin cambiar de conversación.
 */
const botonDeTurno = telefono => (fichaje.esPruebas(telefono)
  ? { type: 'reply', reply: { id: BTN_PANEL, title: '🕑 Turno' } }
  : null);

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
  if (buttonId === BTN_PANEL) { await panel(telefono); return true; }
  if (buttonId === BTN_TERMINAR) { await cerrarTurno(telefono); return true; }
  if (buttonId === BTN_KM) { await verKm(telefono); return true; }
  if (buttonId === BTN_MOTOR) { await desbloquear(telefono); return true; }
  return false;
}

async function abrirTurno(telefono, matricula) {
  const nombre = (await fichaje.nombreParaSaludar(telefono)) || 'Conductor';
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
  // Se distingue "lo he desbloqueado" de "ya estaba libre". Al principio casi
  // ningún coche estará bloqueado, y decir "desbloqueado" cuando no se ha tocado
  // nada enseña a no fiarse del mensaje.
  const m = r.motor || {};
  const motor = !r.bloqueoActivo ? ''
    : m.hecho
      ? (m.yaEstaba ? '\n🔓 El motor ya estaba libre' : '\n🔓 *Motor desbloqueado* — ya puedes arrancar')
      : `\n🔒 *ATENCIÓN: el motor NO se ha desbloqueado*\n_${m.motivo || 'motivo desconocido'}_\n` +
        'Pulsa *Desbloquear* para reintentarlo; si sigue igual, avisa a Tráfico.';
  await enviarBotones(telefono,
    `🟢 *Turno iniciado*\n\n🚘 ${t.matricula}${r.vehiculo ? ` · ${r.vehiculo}` : ''}\n🕐 ${fichaje.horaES(t.inicio)}\n` +
    `${r.enlazado ? '🔗 Enlazado a tu nombre en Mapon'
      : `⚠️ No se pudo enlazar en Mapon (el turno queda registrado igual)\n_${(r.errorMapon || 'motivo desconocido').slice(0, 220)}_`}` +
    `${motor}\n\nA partir de ahora cuento los km. Cuando acabes, ` +
    `${r.bloqueoActivo ? '*apaga el coche* y pulsa *Terminar turno*.' : 'pulsa *Terminar turno*.'}`,
    [{ id: BTN_TERMINAR, titulo: '🔴 Terminar turno' }, { id: BTN_KM, titulo: '📍 Ver km ahora' },
     { id: BTN_MOTOR, titulo: '🔓 Desbloquear' }]);
}

/**
 * Reintenta el desbloqueo con el turno ya abierto.
 *
 * Si el primer intento falló —el coche estaba sin cobertura, o rodando— el
 * conductor se queda con el motor cortado y sin nada que pulsar. Antes solo
 * quedaba cerrar el turno y volver a abrirlo, y eso ensucia el libro.
 */
async function desbloquear(telefono) {
  const { abierto, turno } = await fichaje.estado(telefono);
  if (!abierto) return panel(telefono, 'No tienes ningún turno abierto.');

  const antes = await fichaje.estadoMotor(turno.unitId);
  if (!fichaje.BLOQUEO_ACTIVO) {
    return panel(telefono, '🔌 El corte de motor está *apagado* en el servidor, así que no hay nada que desbloquear.');
  }
  if (antes.sabemos && !antes.bloqueado) {
    return panel(telefono, `🔓 El motor de *${turno.matricula}* ya está libre.`);
  }
  const r = await fichaje.liberarMotor(turno.unitId);
  await panel(telefono, r.hecho
    ? `🔓 *Motor desbloqueado* en ${turno.matricula}. Ya puedes arrancar.`
    : `🔒 Sigue sin desbloquearse.
_${r.motivo}_

Vuelve a intentarlo en un minuto; si no, avisa a Tráfico.`);
}

async function verKm(telefono) {
  const { abierto, turno } = await fichaje.estado(telefono);
  if (!abierto) return panel(telefono, 'No tienes ningún turno abierto.');
  const km = await fichaje.kmDelTurno(turno);
  const dur = fichaje.duracion(Math.floor(Date.now() / 1000) - turno.inicio);
  await enviarBotones(telefono,
    km ? `📍 *Llevas ${km.km} km* en ${turno.matricula}\n🕐 ${dur} de turno · ${km.trayectos} trayecto(s)`
       : `📍 Turno en ${turno.matricula} · ${dur}\n(No he podido leer los km ahora mismo)`,
    [{ id: BTN_TERMINAR, titulo: '🔴 Terminar turno' }, { id: BTN_KM, titulo: '📍 Actualizar' },
     { id: BTN_MOTOR, titulo: '🔓 Desbloquear' }]);
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
  // Va conduciendo. El turno se queda ABIERTO a propósito: terminar es lo que
  // corta el motor, y hacerlo rodando lo inmovilizaría donde quiera que pare.
  if (!r.ok && r.motivo === 'coche-en-marcha') {
    await enviarBotones(telefono,
      `🚗 *Estás en marcha* (${r.velocidad} km/h).\n\n` +
      'Al terminar el turno se bloquea el motor, así que *primero aparca* en un sitio ' +
      'seguro y apaga el coche. Cuando estés parado, vuelve a pulsar *Terminar turno*.\n\n' +
      '_Tu turno sigue abierto: no has perdido nada._',
      [{ id: BTN_TERMINAR, titulo: '🔴 Terminar turno' }, { id: BTN_KM, titulo: '📍 Ver km ahora' }]);
    return;
  }
  // PARADO PERO ENCENDIDO: NO SE TERMINA, Y NO HAY ATAJO.
  //
  // Terminar aquí corta el motor con el contacto puesto, y entonces el coche ya no
  // se deja apagar —arranca, anda, y el botón de apagado deja de responder—. Es
  // peor que no bloquearlo: se le deja el coche encendido y sin salida.
  //
  // Hubo un botón de "ya lo apagué" para saltarse esto y se quitó a propósito: con
  // el coche en marcha el turno NO ha terminado, y un atajo aquí solo sirve para
  // volver al problema. Si Mapon aún no se ha enterado, se espera unos segundos y
  // se vuelve a pulsar; si Mapon calla del todo, `terminar` ya deja cerrar.
  if (!r.ok && r.motivo === 'coche-encendido') {
    await enviarBotones(telefono,
      '🔑 *Apaga el coche primero*\n\n' +
      'Tienes el contacto puesto, así que tu turno no ha terminado. Al cerrarlo se ' +
      'bloquea el motor, y si lo hago ahora *te quedas sin poder apagarlo*.\n\n' +
      'Apágalo del todo y vuelve a pulsar *Terminar turno*.\n\n' +
      '_Tu turno sigue abierto: no has perdido nada._',
      [{ id: BTN_TERMINAR, titulo: '🔴 Terminar turno' },
       { id: BTN_KM, titulo: '📍 Ver km ahora' }]);
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
  const m = r.motor || {};
  const motor = !r.bloqueoActivo ? ''
    : m.hecho
      ? (m.yaEstaba ? '\n🔒 El motor ya estaba bloqueado' : '\n🔒 Motor bloqueado hasta el próximo turno')
      : `\n⚠️ El motor NO se ha bloqueado (_${m.motivo || 'motivo desconocido'}_)` +
        (m.reintentable ? '\n_Se reintentará solo cuando el coche lleve un rato parado._' : '');
  await enviarBotones(telefono,
    `🔴 *Turno terminado*\n\n🚘 ${t.matricula}\n🕐 ${fichaje.horaES(t.inicio)} → ${fichaje.horaES(t.fin)} (${dur})\n` +
    `🛣️ *${t.km == null ? '—' : t.km} km* recorridos${atrib}${motor}\n\nGracias. Queda registrado.`,
    [{ id: BTN_INICIAR, titulo: '🟢 Iniciar turno' }]);
}

module.exports = { manejarTexto, manejarBoton, panel, botonDeTurno };
