/**
 * Conversación de FICHAJE en WhatsApp (capa de mensajes).
 *
 * Vive aparte del bot para que el enganche en routes/botPuertas.js sea de unas pocas
 * líneas: manejarTexto/manejarBoton devuelven `true` si se han hecho cargo del
 * mensaje, y `false` si no es cosa suya (entonces el bot sigue como siempre).
 *
 * QUIÉN: solo quien tenga el fichaje ENCENDIDO en el ERP (`fichaje.participa`).
 * Para cualquier otro número devuelve false siempre y el bot no cambia en nada.
 *
 * DOS FLUJOS, según quién escribe (24/09/2026):
 *   · Un CONDUCTOR hace TURNOS. Se le propone el coche que le da hoy el cuadrante
 *     («Iniciar 1234ABC»), y en el cambio de turno pulsa «Voy al relevo».
 *   · Alguien de la EMPRESA hace VIAJES: «Por favor, indica la matrícula» →
 *     empieza el viaje (se suelta el motor) → al terminar se bloquea.
 * Y desde el panel de puertas, tras escribir una matrícula, el tercer botón
 * empieza el turno o el viaje EN ESE COCHE, sin volver a pedirla.
 */

const fichaje = require('./fichaje');
const { enviarTexto, enviarBotones } = require('./whatsapp');

const BTN_INICIAR = 'turno_iniciar';          // pide la matrícula
const BTN_INICIAR_EN = 'turno_iniciar:';      // + matrícula: empieza en ese coche
const BTN_OTRO = 'turno_otro';                // no es el coche del cuadrante: pide la matrícula
const BTN_TERMINAR = 'turno_terminar';
const BTN_KM = 'turno_km';
const BTN_MOTOR = 'turno_motor';
const BTN_RELEVO = 'turno_relevo';
const BTN_RELEVO_NO = 'turno_relevo_no';
// Abre el panel del fichaje desde el bot de puertas, sin salir de la conversación.
const BTN_PANEL = 'turno_panel';

// Espera de matrícula (en memoria: si Render reinicia, basta con volver a pulsar).
// CADUCA: sin eso, quien dejó la pregunta a medias y escribe «hola» tres horas
// después recibía «eso no parece una matrícula».
const ESPERA_MS = 10 * 60 * 1000;
const esperando = new Map();   // tel9 -> hasta
const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);
const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
// La misma regla que el bot de puertas: toda matrícula española lleva algún
// dígito. Sin él, «buenas» pasaba por matrícula.
const MAT = /^(?=.*\d)[A-Za-z0-9]{6,8}$/;
// Las palabras que son del fichaje. NO «turnos» ni «relevo»: esas son del bot
// de puertas y enseñan la semana; quitárselas dejaría a la gente sin sus turnos.
const PALABRAS = /^(turno|fichar|fichaje|fichar turno|viaje|iniciar turno|iniciar viaje|terminar turno|terminar viaje|km)$/i;

// Solo la hora (12:46), para lo que pasa dentro del mismo turno. horaES da
// también el día (24/9, 12:46), que hace falta al empezar pero sobra aquí.
const hora = ts => fichaje.horaES(ts).split(", ").pop();

const esperaMatricula = telefono => {
  const hasta = esperando.get(tel9(telefono));
  if (!hasta) return false;
  if (hasta < Date.now()) { esperando.delete(tel9(telefono)); return false; }
  return true;
};

/** Las palabras de cada flujo: un conductor hace turnos; la empresa, viajes. */
const W = tipo => (tipo === 'viaje'
  ? { cosa: 'viaje', Cosa: 'Viaje', iniciar: '🟢 Iniciar viaje', terminar: '🔴 Terminar viaje', mi: '🕑 Mi viaje' }
  : { cosa: 'turno', Cosa: 'Turno', iniciar: '🟢 Iniciar turno', terminar: '🔴 Terminar turno', mi: '🕑 Mi turno' });

// El cambio de turno, con las palabras exactas. «Entregando coche» no valía: no
// dice si es antes o después de dárselo al compañero. Lo que importa es el
// MOMENTO: se pulsa al ARRANCAR hacia el sitio del relevo, no al llegar.
const AYUDA_RELEVO = '🔄 *Cambio de turno:* justo *antes de arrancar* hacia el sitio donde le das el coche ' +
  'a tu compañero, pulsa *Voy al relevo*. Al salir, no al llegar.';

/** Los botones con el turno o el viaje abierto. */
function botonesAbierto(t) {
  const w = W(t.tipo);
  if (t.tipo === 'turno') {
    return t.relevo
      ? [{ id: BTN_TERMINAR, titulo: w.terminar }, { id: BTN_RELEVO_NO, titulo: '↩️ Aún no he salido' },
         { id: BTN_MOTOR, titulo: '🔓 Desbloquear' }]
      : [{ id: BTN_RELEVO, titulo: '🔄 Voy al relevo' }, { id: BTN_TERMINAR, titulo: w.terminar },
         { id: BTN_MOTOR, titulo: '🔓 Desbloquear' }];
  }
  return [{ id: BTN_TERMINAR, titulo: w.terminar }, { id: BTN_KM, titulo: '📍 Ver km ahora' },
    { id: BTN_MOTOR, titulo: '🔓 Desbloquear' }];
}

/** Lo que se le dice con el turno o el viaje abierto. */
function textoAbierto(t, cabecera) {
  const w = W(t.tipo);
  const cab = cabecera ? cabecera + '\n\n' : '';
  const base = `🟢 *${w.Cosa} abierto*\n🚘 ${t.matricula}\n🕐 Desde las ${fichaje.horaES(t.inicio)}\n\n`;
  if (t.tipo !== 'turno') {
    return cab + base + 'Cuando acabes, *apaga el coche* y pulsa *Terminar viaje*: el motor se queda bloqueado.';
  }
  if (t.relevo) {
    return cab + base + `🔄 *De camino al relevo* desde las ${hora(t.relevo)}.\n\n` +
      'Cuando le des el coche a tu compañero, apágalo y pulsa *Terminar turno*. ' +
      'Si tu compañero ficha y empieza su turno antes, el tuyo se cierra solo.';
  }
  return cab + base + AYUDA_RELEVO + '\n\nAl acabar tu turno, *apaga el coche* y pulsa *Terminar turno*.';
}

/** Pide la matrícula y se queda esperándola. */
async function pedirMatricula(telefono, cabecera) {
  esperando.set(tel9(telefono), Date.now() + ESPERA_MS);
  await enviarTexto(telefono, (cabecera ? cabecera + '\n\n' : '') +
    '🚘 Por favor, indica la *matrícula* del coche (sin espacios ni guiones).\n\nEjemplo: *1234ABC*\n\n' +
    '_Escribe *cancelar* para salir._');
}

/**
 * El panel: según haya algo abierto o no, unos botones u otros. Devuelve false
 * si ese número no participa (y entonces no se le ha mandado nada).
 */
async function panel(telefono, cabecera) {
  const p = await fichaje.participa(telefono);
  if (!p) return false;
  const { abierto, turno } = await fichaje.estado(telefono);
  if (abierto) {
    await enviarBotones(telefono, textoAbierto(turno, cabecera), botonesAbierto(turno));
    return true;
  }
  if (p.soloCerrar) {
    await enviarTexto(telefono, (cabecera ? cabecera + '\n\n' : '') + 'No tienes nada abierto.');
    return true;
  }
  const hola = cabecera ? cabecera + '\n\n' : `👋 Hola ${p.nombre || ''}.\n\n`;

  // LA EMPRESA: directo a la matrícula. Es su flujo: dice el coche y empieza.
  if (p.tipo === 'viaje') {
    await pedirMatricula(telefono, hola.trim());
    return true;
  }

  // EL CONDUCTOR: se le propone el coche que le da hoy el cuadrante. Es lo normal,
  // y un botón es un paso menos que escribir la matrícula (y un error menos).
  const coches = (await fichaje.cochesDelPlan(telefono)).slice(0, 2);
  if (coches.length) {
    const cual = coches.map(c => `*${c.matricula}*${c.turno ? ` (turno de ${c.turno.toLowerCase()})` : ''}`).join(' o ');
    await enviarBotones(telefono,
      `${hola}Hoy tienes el ${cual}. ¿Empiezas tu turno${coches.length > 1 ? '' : ' en él'}?\n\n` +
      'Si vas a llevar otro coche, pulsa *Otro coche*.',
      [...coches.map(c => ({ id: BTN_INICIAR_EN + normMat(c.matricula), titulo: `🟢 Iniciar ${normMat(c.matricula)}` })),
       { id: BTN_OTRO, titulo: '🚘 Otro coche' }]);
    return true;
  }
  await enviarBotones(telefono,
    `${hola}No tienes ningún turno abierto. Pulsa *Iniciar turno* y dime la matrícula del coche que vas a llevar.`,
    [{ id: BTN_INICIAR, titulo: '🟢 Iniciar turno' }]);
  return true;
}

/** Texto recibido. Devuelve true si el fichaje se ha ocupado del mensaje. */
async function manejarTexto(telefono, texto) {
  const t = String(texto || '').trim();

  // Si se le pidió la matrícula, lo siguiente que escriba se interpreta como tal.
  if (esperaMatricula(telefono)) {
    const p = await fichaje.participa(telefono);
    if (!p) { esperando.delete(tel9(telefono)); return false; }
    if (/^cancelar$/i.test(t)) {
      esperando.delete(tel9(telefono));
      await enviarTexto(telefono, '❎ Cancelado.');
      return true;
    }
    if (!MAT.test(t)) {
      await enviarTexto(telefono, '❌ Eso no parece una matrícula. Escríbela sin espacios ni guiones (ejemplo: *1234ABC*), o escribe *cancelar*.');
      return true;
    }
    esperando.delete(tel9(telefono));
    await abrir(telefono, normMat(t));
    return true;
  }

  // SOLO SE QUEDA LO QUE ES SUYO. Los dos bots comparten número: el fichaje se
  // queda sus palabras y devuelve el resto al de puertas. Y solo pregunta a la
  // base si es una de sus palabras, para no cargar cada mensaje del bot.
  if (!PALABRAS.test(t)) return false;
  const p = await fichaje.participa(telefono);
  if (!p) return false;
  if (/^km$/i.test(t)) { await verKm(telefono); return true; }
  await panel(telefono);
  return true;
}

/**
 * Enseña el panel del fichaje si ese número participa. Lo usa el bot de puertas
 * cuando alguien de la empresa con el fichaje encendido NO tiene el permiso de
 * puertas: en vez de «no tienes permiso», se le lleva a lo suyo.
 */
const panelSiParticipa = async telefono => ((await fichaje.participa(telefono)) ? panel(telefono) : false);

/**
 * El botón del fichaje para el panel de PUERTAS, o null si ese número no
 * participa. Con una matrícula ya elegida y nada abierto, el botón EMPIEZA el
 * turno o el viaje en ese coche: es el flujo «indica la matrícula → inicia».
 */
async function botonDeTurno(telefono, matricula) {
  const p = await fichaje.participa(telefono);
  if (!p) return null;
  const boton = (id, title) => ({ type: 'reply', reply: { id, title: String(title).slice(0, 20) } });
  const { abierto, turno } = await fichaje.estado(telefono);
  if (abierto) return boton(BTN_PANEL, W(turno.tipo).mi);
  if (p.soloCerrar) return null;
  const w = W(p.tipo);
  return matricula ? boton(BTN_INICIAR_EN + normMat(matricula), w.iniciar) : boton(BTN_PANEL, w.mi);
}

/** Botón pulsado. Devuelve true si era del fichaje. */
async function manejarBoton(telefono, buttonId) {
  const id = String(buttonId || '');
  if (!id.startsWith('turno_')) return false;
  const p = await fichaje.participa(telefono);
  if (!p) {
    await enviarTexto(telefono, 'ℹ️ No tienes el fichaje activado. Si crees que es un error, avisa a Tráfico.');
    return true;
  }
  if (id.startsWith(BTN_INICIAR_EN)) { await abrir(telefono, id.slice(BTN_INICIAR_EN.length)); return true; }
  if (id === BTN_INICIAR || id === BTN_OTRO) {
    const { abierto } = await fichaje.estado(telefono);
    if (abierto) { await panel(telefono, `⚠️ Ya tenías un ${W(p.tipo).cosa} abierto.`); return true; }
    await pedirMatricula(telefono);
    return true;
  }
  if (id === BTN_PANEL) { await panel(telefono); return true; }
  if (id === BTN_TERMINAR) { await cerrar(telefono); return true; }
  if (id === BTN_KM) { await verKm(telefono); return true; }
  if (id === BTN_MOTOR) { await desbloquear(telefono); return true; }
  if (id === BTN_RELEVO) { await relevo(telefono, true); return true; }
  if (id === BTN_RELEVO_NO) { await relevo(telefono, false); return true; }
  return false;
}

async function abrir(telefono, matricula) {
  let r;
  try {
    r = await fichaje.iniciar({ telefono, matricula });
  } catch (e) {
    console.error('❌ [FICHAJE] iniciar:', e.message);
    await enviarTexto(telefono, `❌ No se pudo empezar: ${e.message}`);
    return;
  }
  if (!r.ok) {
    if (r.motivo === 'no-participa') {
      await enviarTexto(telefono, 'ℹ️ No tienes el fichaje activado. Si crees que es un error, avisa a Tráfico.');
      return;
    }
    if (r.motivo === 'sin-matricula') {
      await pedirMatricula(telefono, `❌ La matrícula *${matricula}* no está en Mapon. Comprueba que sea la correcta.`);
      return;
    }
    if (r.motivo === 'coche-ocupado') {
      await enviarTexto(telefono,
        `⚠️ Ese coche lo tiene *${r.turno.nombre}* desde las ${fichaje.horaES(r.turno.inicio)}.\n\n` +
        'Si te lo está dando en un relevo, pídele que pulse *Voy al relevo* o *Terminar turno* y vuelve a intentarlo. ' +
        'Si no, avisa a Tráfico.');
      return;
    }
    if (r.motivo === 'ya-abierto') { await panel(telefono, '⚠️ Ya tenías algo abierto.'); return; }
    await enviarTexto(telefono, '❌ No se pudo empezar.');
    return;
  }
  const t = r.turno;
  const w = W(t.tipo);
  // El estado del motor va DESTACADO: si no se pudo liberar, hay que saberlo antes de
  // subirse al coche, no descubrirlo al girar la llave. Y se distingue "lo he
  // desbloqueado" de "ya estaba libre": decir "desbloqueado" cuando no se ha tocado
  // nada enseña a no fiarse del mensaje.
  const m = r.motor || {};
  const motor = !r.bloqueoActivo ? ''
    : m.hecho
      ? (m.yaEstaba ? '\n🔓 El motor ya estaba libre' : '\n🔓 *Motor desbloqueado* — ya puedes arrancar')
      : `\n🔒 *ATENCIÓN: el motor NO se ha desbloqueado*\n_${m.motivo || 'motivo desconocido'}_\n` +
        'Pulsa *Desbloquear* para reintentarlo; si sigue igual, avisa a Tráfico.';
  const relevo = r.relevoDe ? `\n🔄 *${r.relevoDe.nombre}* te ha dado el coche: su turno queda cerrado.` : '';
  const siguiente = t.tipo === 'turno'
    ? `\n\nA partir de ahora cuento los km.\n\n${AYUDA_RELEVO}\n\nAl acabar tu turno, ` +
      `${r.bloqueoActivo ? '*apaga el coche* y pulsa *Terminar turno*.' : 'pulsa *Terminar turno*.'}`
    : `\n\nCuando acabes, ${r.bloqueoActivo ? '*apaga el coche* y pulsa *Terminar viaje*: el motor se queda bloqueado.' : 'pulsa *Terminar viaje*.'}`;
  await enviarBotones(telefono,
    `🟢 *${w.Cosa} iniciado*\n\n🚘 ${t.matricula}${r.vehiculo ? ` · ${r.vehiculo}` : ''}\n🕐 ${fichaje.horaES(t.inicio)}\n` +
    `${r.enlazado ? '🔗 Enlazado a tu nombre en Mapon'
      : `⚠️ No se pudo enlazar en Mapon (queda registrado igual)\n_${(r.errorMapon || 'motivo desconocido').slice(0, 220)}_`}` +
    `${relevo}${motor}${siguiente}`,
    botonesAbierto(t));
}

/** «Voy al relevo», o deshacerlo si se pulsó sin querer. */
async function relevo(telefono, si) {
  const r = await fichaje.marcarRelevo(telefono, si);
  if (!r.ok) {
    if (r.motivo === 'es-viaje') return panel(telefono, 'El relevo es para los turnos, no para los viajes.');
    return panel(telefono, 'No tienes ningún turno abierto.');
  }
  const t = r.turno;
  if (!si) {
    await enviarBotones(telefono,
      `↩️ *Quitado.* Sigues en tu turno en ${t.matricula}.\n\n${AYUDA_RELEVO}`, botonesAbierto(t));
    return;
  }
  await enviarBotones(telefono,
    `🔄 *Anotado: vas al relevo* desde las ${hora(t.relevo)}.\n\n` +
    'Cuando le des el coche a tu compañero, *apágalo* y pulsa *Terminar turno*. ' +
    'Si tu compañero ficha y empieza su turno antes, el tuyo se cierra solo.\n\n' +
    '_Si lo has pulsado sin querer, pulsa *Aún no he salido*._',
    botonesAbierto(t));
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
  if (!abierto) return panel(telefono, 'No tienes nada abierto.');

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
    : `🔒 Sigue sin desbloquearse.\n_${r.motivo}_\n\nVuelve a intentarlo en un minuto; si no, avisa a Tráfico.`);
}

async function verKm(telefono) {
  const { abierto, turno } = await fichaje.estado(telefono);
  if (!abierto) return panel(telefono, 'No tienes nada abierto.');
  const km = await fichaje.kmDelTurno(turno);
  const dur = fichaje.duracion(Math.floor(Date.now() / 1000) - turno.inicio);
  const w = W(turno.tipo);
  await enviarBotones(telefono,
    km ? `📍 *Llevas ${km.km} km* en ${turno.matricula}\n🕐 ${dur} de ${w.cosa} · ${km.trayectos} trayecto(s)`
       : `📍 ${w.Cosa} en ${turno.matricula} · ${dur}\n(No he podido leer los km ahora mismo)`,
    botonesAbierto(turno));
}

async function cerrar(telefono) {
  let r;
  try {
    r = await fichaje.terminar(telefono);
  } catch (e) {
    console.error('❌ [FICHAJE] terminar:', e.message);
    await enviarTexto(telefono, `❌ No se pudo terminar: ${e.message}`);
    return;
  }
  const abiertoAhora = r.turno || {};
  const w = W(abiertoAhora.tipo);
  // Va conduciendo. Se queda ABIERTO a propósito: terminar es lo que corta el
  // motor, y hacerlo rodando lo inmovilizaría donde quiera que pare.
  if (!r.ok && r.motivo === 'coche-en-marcha') {
    await enviarBotones(telefono,
      `🚗 *Estás en marcha* (${r.velocidad} km/h).\n\n` +
      `Al terminar se bloquea el motor, así que *primero aparca* en un sitio seguro y apaga el coche. ` +
      `Cuando estés parado, vuelve a pulsar *${w.terminar.slice(3)}*.\n\n` +
      `_Tu ${w.cosa} sigue abierto: no has perdido nada._`,
      [{ id: BTN_TERMINAR, titulo: w.terminar }, { id: BTN_KM, titulo: '📍 Ver km ahora' }]);
    return;
  }
  // PARADO PERO ENCENDIDO: NO SE TERMINA, Y NO HAY ATAJO.
  //
  // Terminar aquí corta el motor con el contacto puesto, y entonces el coche ya no
  // se deja apagar —arranca, anda, y el botón de apagado deja de responder—. Es
  // peor que no bloquearlo. Hubo un botón de "ya lo apagué" para saltarse esto y
  // se quitó a propósito: con el coche encendido no ha terminado.
  if (!r.ok && r.motivo === 'coche-encendido') {
    await enviarBotones(telefono,
      '🔑 *Apaga el coche primero*\n\n' +
      `Tienes el contacto puesto, así que tu ${w.cosa} no ha terminado. Al cerrarlo se ` +
      'bloquea el motor, y si lo hago ahora *te quedas sin poder apagarlo*.\n\n' +
      `Apágalo del todo y vuelve a pulsar *${w.terminar.slice(3)}*.\n\n` +
      `_Tu ${w.cosa} sigue abierto: no has perdido nada._`,
      [{ id: BTN_TERMINAR, titulo: w.terminar }, { id: BTN_KM, titulo: '📍 Ver km ahora' }]);
    return;
  }
  if (!r.ok) return panel(telefono, '⚠️ No tenías nada abierto.');
  const t = r.turno;
  const dur = fichaje.duracion(t.fin - t.inicio);
  // El dato de atribución sirve para saber si Mapon SELLA el conductor en el histórico
  // o lo resuelve al vuelo; hasta confirmarlo, la prueba buena es el libro de turnos.
  const atrib = r.km && r.km.trayectos
    ? `\n🔎 Mapon atribuyó ${r.km.conConductor}/${r.km.trayectos} trayecto(s) a un conductor`
    : '';
  const relevoTxt = t.relevo
    ? `\n🔄 Relevo: ${t.kmRelevo == null ? '—' : t.kmRelevo} km desde las ${hora(t.relevo)}` : '';
  const faltan = (r.faltan || []).map(n => `*${n}*`).join(', ');
  const m = r.motor || {};
  const motor = !r.bloqueoActivo ? ''
    : m.seQuedaLibre
      ? `\n🔓 El motor se queda *libre*: este coche también lo lleva ${faltan || 'alguien'}, que todavía no ficha por aquí.`
      : m.hecho
        ? (m.yaEstaba ? '\n🔒 El motor ya estaba bloqueado' : `\n🔒 Motor bloqueado hasta el próximo ${w.cosa}`) +
          (faltan ? `\n⚠️ Ojo: este coche lo lleva ${faltan}, que todavía no ficha. Si lo necesita, Tráfico se lo suelta desde el planificador.` : '')
        : `\n⚠️ El motor NO se ha bloqueado (_${m.motivo || 'motivo desconocido'}_)` +
          (m.reintentable ? '\n_Se reintentará solo cuando el coche lleve un rato parado._' : '');
  await enviarBotones(telefono,
    `🔴 *${w.Cosa} terminado*\n\n🚘 ${t.matricula}\n🕐 ${fichaje.horaES(t.inicio)} → ${fichaje.horaES(t.fin)} (${dur})\n` +
    `🛣️ *${t.km == null ? '—' : t.km} km* recorridos${relevoTxt}${atrib}${motor}\n\nGracias. Queda registrado.`,
    [{ id: BTN_PANEL, titulo: w.iniciar }]);
}

module.exports = { manejarTexto, manejarBoton, panel, panelSiParticipa, botonDeTurno };
