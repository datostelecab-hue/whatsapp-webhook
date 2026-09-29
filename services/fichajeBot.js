/**
 * La conversación del COCHE en WhatsApp: el turno del conductor y el viaje de la
 * gente de la empresa (capa de mensajes; la lógica está en services/fichaje.js).
 *
 * Vive aparte del bot para que el enganche en routes/botPuertas.js sea de unas pocas
 * líneas: manejarTexto/manejarBoton devuelven `true` si se han hecho cargo del
 * mensaje, y `false` si no es cosa suya (entonces sigue el panel de puertas).
 *
 * EL CONDUCTOR (desde el 28/09/2026, lo pidió Camilo así, en este orden):
 *   1. Un saludo cálido, solo con su nombre de pila.
 *   2. Que escriba la matrícula del coche que va a llevar, todo junto.
 *   3. Con la matrícula EMPIEZA SU TURNO en ese coche (se le desbloquea el motor)
 *      y le salen SIEMPRE los mismos botones, en dos mensajes:
 *        · Abrir puertas · Cerrar puertas · Entregar coche
 *        · Código de lavado (hasta el 15/10) · Ver mis turnos · Terminar turno
 *   Es para TODO conductor de alta: escribir la matrícula es la puerta de entrada
 *   al coche. El bloqueo del motor al terminar sí se enciende persona a persona.
 *   Si el coche figura con otro, SE LO QUEDA quien escribe la matrícula (29/09):
 *   al otro se le cierra el turno y se le avisa (ver fichaje.iniciar).
 *
 * LA EMPRESA (quien tenga el fichaje encendido en /usuarios) hace VIAJES, como
 * hasta ahora: «indica la matrícula» → empieza el viaje → al terminar se bloquea.
 *
 * PALABRAS: al conductor no se le dice «fichar» ni «fichaje». Esto no es el
 * registro de jornada (ese es /fichaje): es quién lleva qué coche y cuántos km
 * hace. Si se llamara igual, un turno abierto por WhatsApp y sin trabajar se
 * podría hacer pasar por horas fichadas.
 */

const fichaje = require('./fichaje');
const { enviarTexto, enviarBotones } = require('./whatsapp');
const puertas = require('./puertasBot');
const lavado = require('./lavadoBallenoil');

// Los botones del panel del conductor llevan LOS MISMOS ids que el panel de
// puertas de siempre: un botón de un mensaje viejo del chat sigue valiendo.
const BTN_ABRIR = 'abrir_puertas';
const BTN_CERRAR = 'cerrar_puertas';
const BTN_LAVADO = 'codigo_lavado';
const BTN_TURNOS = 'ver_turnos';
const BTN_CAMBIAR = 'cambiar_matricula';
const DEL_PANEL = new Set([BTN_ABRIR, BTN_CERRAR, BTN_LAVADO, BTN_TURNOS, BTN_CAMBIAR]);

const BTN_INICIAR = 'turno_iniciar';          // pide la matrícula
const BTN_INICIAR_EN = 'turno_iniciar:';      // + matrícula: empieza en ese coche
const BTN_OTRO = 'turno_otro';                // no es el coche del cuadrante: pide la matrícula
const BTN_TERMINAR = 'turno_terminar';
const BTN_KM = 'turno_km';
const BTN_MOTOR = 'turno_motor';
// «Entregar coche». El id es el de «Voy al relevo», que es lo que era: así los
// botones que ya estén en los chats siguen funcionando.
const BTN_ENTREGAR = 'turno_relevo';
const BTN_ENTREGAR_NO = 'turno_relevo_no';
// Abre el panel sin salir de la conversación.
const BTN_PANEL = 'turno_panel';

// Espera de matrícula (en memoria: si Render reinicia, basta con volver a pulsar).
// CADUCA: sin eso, quien dejó la pregunta a medias y escribe «hola» tres horas
// después recibía «eso no parece una matrícula».
const ESPERA_MS = 10 * 60 * 1000;
const esperando = new Map();   // tel9 -> hasta
// Cómo dejó las puertas cada uno. En memoria y solo para enseñarlo: si Render
// reinicia no se dice nada, que es mejor que decir algo que no se sabe.
const puertasDe = new Map();   // tel9 -> { matricula, abierta }
const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);
const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
// La misma regla que el bot de puertas: toda matrícula española lleva algún
// dígito. Sin él, «buenas» pasaba por matrícula.
const MAT = /^(?=.*\d)[A-Za-z0-9]{6,8}$/;
// Se le pide sin espacios ni guiones, pero si los pone se le entiende igual.
const comoMatricula = t => String(t || '').replace(/[\s.\-_]/g, '');
// Las palabras que abren el panel. NO «turnos» ni «relevo»: esas enseñan sus turnos.
const PALABRAS = /^(turno|fichar|fichaje|fichar turno|viaje|iniciar turno|iniciar viaje|terminar turno|terminar viaje|km|men[uú]|opciones)$/i;
const TURNOS_PALABRA = /^(ver\s+)?(mis\s+)?turnos?$|^relevos?$/i;
const LAVADO_PALABRA = /^(c[oó]digo\s+(de\s+)?)?lavado$/i;

// Solo la hora (12:46), para lo que pasa dentro del mismo turno. horaES da
// también el día (24/9, 12:46), que hace falta al empezar pero sobra aquí.
const hora = ts => fichaje.horaES(ts).split(', ').pop();

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

const conCabecera = (cabecera, texto) => (cabecera ? `${cabecera}\n\n${texto}` : texto);

// ══════════════════════════════════════════════════════════════════════════
// EL CONDUCTOR
// ══════════════════════════════════════════════════════════════════════════

// «Entregar coche», con las palabras exactas. Lo que importa es el MOMENTO: se
// pulsa al ARRANCAR hacia donde está el compañero, no al llegar. Desde esa hora
// se cuentan los km del trayecto de entrega, que es lo que se audita.
const AYUDA_ENTREGAR = '🚗 *Entregar coche*: púlsalo justo *antes de salir* hacia donde está tu compañero ' +
  'para darle el coche, no cuando ya se lo hayas dado.';

/** El saludo. Con su nombre de pila y nada más: es lo primero que lee. */
async function bienvenida(telefono, p, cabecera) {
  const hola = p.pila ? `👋 ¡Hola, ${p.pila}! Qué gusto saludarte.` : '👋 ¡Hola! Qué gusto saludarte.';
  await enviarTexto(telefono, conCabecera(cabecera, `${hola}\n\n` +
    'Para empezar, escríbeme la *matrícula* del coche que vas a llevar y te desbloqueo el motor.\n\n' +
    '✍️ Escríbela todo junto, *sin espacios ni guiones*. Ejemplo: *1234ABC*'));
}

/** Primer mensaje del panel: el coche, desde cuándo, y las puertas. */
async function mensajePuertas(telefono, t, cabecera, vehiculo) {
  const pu = puertasDe.get(tel9(telefono));
  const estadoPuertas = pu && pu.matricula === t.matricula
    ? `\n${pu.abierta ? '🔓 Puertas abiertas' : '🔒 Puertas cerradas'}` : '';
  const entrega = t.relevo
    ? `\n🚗 Saliste a entregar el coche a las ${hora(t.relevo)}`
    : `\n\n${AYUDA_ENTREGAR}`;
  await enviarBotones(telefono,
    conCabecera(cabecera, `🚘 *${t.matricula}*${vehiculo ? ` · ${vehiculo}` : ''}\n` +
      `🕐 En turno desde las ${hora(t.inicio)}${estadoPuertas}${entrega}`),
    [{ id: BTN_ABRIR, titulo: '🔓 Abrir puertas' }, { id: BTN_CERRAR, titulo: '🔒 Cerrar puertas' },
     { id: BTN_ENTREGAR, titulo: '🚗 Entregar coche' }]);
}

/** Segundo mensaje del panel. El lavado solo mientras queden días (hasta el 15/10). */
async function mensajeOpciones(telefono, texto = '📋 Más opciones:') {
  await enviarBotones(telefono, texto, [
    ...(lavado.visible() ? [{ id: BTN_LAVADO, titulo: '🧽 Código de lavado' }] : []),
    { id: BTN_TURNOS, titulo: '📅 Ver mis turnos' },
    { id: BTN_TERMINAR, titulo: '🔴 Terminar turno' },
  ]);
}

/** El panel entero: siempre los mismos botones, en dos mensajes. */
async function panelTurno(telefono, t, cabecera, vehiculo) {
  await mensajePuertas(telefono, t, cabecera, vehiculo);
  await mensajeOpciones(telefono);
}

/** Todo lo que escribe un conductor. Siempre se hace cargo (devuelve true). */
async function textoConductor(telefono, t, p) {
  const { abierto, turno } = await fichaje.estado(telefono);

  if (p.soloCerrar) {
    if (abierto) await panelTurno(telefono, turno, 'Tienes un turno sin cerrar.');
    else await enviarTexto(telefono, 'No tienes ningún turno abierto.');
    return true;
  }

  if (TURNOS_PALABRA.test(t)) { await verTurnos(telefono, p, abierto); return true; }
  if (LAVADO_PALABRA.test(t)) { await codigoLavado(telefono, p, abierto); return true; }
  if (/^desbloquear$/i.test(t)) { await desbloquear(telefono); return true; }
  if (/^km$/i.test(t)) { await verKm(telefono); return true; }

  const mat = comoMatricula(t);
  if (MAT.test(mat)) {
    const m = normMat(mat);
    if (!abierto) { await abrir(telefono, m); return true; }
    if (normMat(turno.matricula) === m) {
      await panelTurno(telefono, turno, `Ya estás en turno con el *${turno.matricula}*.`);
      return true;
    }
    // OTRO COCHE CON EL TURNO ABIERTO: no se cambia solo. Cambiar de coche es
    // cerrar un turno —y quizá bloquear un motor— y abrir otro; que lo decida él.
    await enviarTexto(telefono,
      `⚠️ Tienes el turno abierto con el *${turno.matricula}*.\n\n` +
      `Si has cambiado de coche, pulsa primero *Terminar turno* y luego escríbeme la matrícula del nuevo (*${m}*).`);
    await mensajeOpciones(telefono);
    return true;
  }

  if (abierto) {
    await panelTurno(telefono, turno, `👋 Hola${p.pila ? ', ' + p.pila : ''}. Sigues en turno con el *${turno.matricula}*.`);
  } else {
    await bienvenida(telefono, p);
  }
  return true;
}

/** Empieza el turno en ese coche y enseña el panel. */
async function abrir(telefono, matricula) {
  let r;
  try {
    r = await fichaje.iniciar({ telefono, matricula });
  } catch (e) {
    console.error('❌ [FICHAJE] iniciar:', e.message);
    await enviarTexto(telefono, '❌ Ahora mismo no he podido empezar tu turno. Vuelve a escribirme la matrícula en un momento.');
    return;
  }
  if (!r.ok) {
    if (r.motivo === 'no-participa') {
      await enviarTexto(telefono, 'ℹ️ No tienes activado el uso de coches por aquí. Si crees que es un error, avisa a Tráfico.');
      return;
    }
    if (r.motivo === 'sin-matricula') {
      await enviarTexto(telefono, `❌ No encuentro la matrícula *${matricula}*. Revísala y escríbemela otra vez, ` +
        'todo junto (ejemplo: *1234ABC*).');
      return;
    }
    // El coche tiene corte y al que lo tenía se le bloquearía: la misma regla
    // que «Terminar turno», parado y apagado antes de pasar de manos.
    if (r.motivo === 'ocupado-en-marcha') {
      await enviarTexto(telefono,
        `🚗 El *${r.turno.matricula}* está en marcha ahora mismo (${r.velocidad} km/h) y figura con *${r.turno.nombre}*.\n\n` +
        'Cuando esté parado y apagado, vuelve a escribirme la matrícula y el coche pasa a ser tuyo.');
      return;
    }
    if (r.motivo === 'ocupado-encendido') {
      await enviarTexto(telefono,
        `🔑 El *${r.turno.matricula}* tiene el contacto puesto. *Apágalo* y vuelve a escribirme la matrícula: ` +
        `se cierra el turno de *${r.turno.nombre}* y el coche pasa a ser tuyo.`);
      return;
    }
    // Solo si otro mensaje le ganó por milésimas al guardar: se reintenta y ya.
    if (r.motivo === 'coche-ocupado') {
      await enviarTexto(telefono,
        `⚠️ El *${r.turno.matricula}* figura todavía con *${r.turno.nombre}* desde las ${hora(r.turno.inicio)}.\n\n` +
        'Pídele que pulse *Entregar coche* o *Terminar turno* y vuelve a escribirme la matrícula. ' +
        'Si no puedes localizarle, avisa a Tráfico.');
      return;
    }
    if (r.motivo === 'ya-abierto') { await panel(telefono, '⚠️ Ya tenías algo abierto.'); return; }
    await enviarTexto(telefono, '❌ No he podido empezar tu turno.');
    return;
  }

  const t = r.turno;
  // A quien tenía el coche se le dice que su turno se ha cerrado: si no, se
  // queda esperando a que alguien le confirme que ya puede irse. También cuando
  // quien lo coge es alguien de la empresa (un viaje).
  if (r.relevoDe) avisarAlQueEntrega(r.relevoDe, r.quien && r.quien.nombre).catch(() => {});
  if (t.tipo !== 'turno') return abiertoViaje(telefono, r);

  // El estado del motor va DESTACADO: si no se pudo liberar, hay que saberlo antes de
  // subirse al coche, no descubrirlo al girar la llave. Y se distingue "lo he
  // desbloqueado" de "ya estaba libre": decir "desbloqueado" cuando no se ha tocado
  // nada enseña a no fiarse del mensaje.
  const m = r.motor || {};
  const sinMotor = r.bloqueoActivo && !m.hecho;
  const motor = !r.bloqueoActivo ? ''
    : m.hecho
      ? (m.yaEstaba ? '\n🔓 El motor ya está libre: puedes arrancar' : '\n🔓 *Motor desbloqueado*: ya puedes arrancar')
      : `\n🔒 *ATENCIÓN: el motor NO se ha desbloqueado*\n_${m.motivo || 'motivo desconocido'}_`;
  const relevo = !r.relevoDe ? ''
    : r.relevoDe.sinBoton
      ? `\n🔄 El coche figuraba con *${r.relevoDe.nombre}*: su turno queda cerrado y desde ahora el responsable eres tú.`
      : `\n🔄 *${r.relevoDe.nombre}* te ha dado el coche: su turno queda cerrado.`;
  const p = await fichaje.participa(telefono);
  const cabecera = `✅ *Turno iniciado*${p && p.pila ? ` — ¡buen turno, ${p.pila}!` : ''}${motor}${relevo}`;

  puertasDe.delete(tel9(telefono));
  if (sinMotor) {
    // Sin motor no hay turno que valga: el reintento va primero y a mano.
    await enviarBotones(telefono, `${cabecera}\n\nPulsa *Reintentar* en un momento; si sigue igual, avisa a Tráfico.`,
      [{ id: BTN_MOTOR, titulo: '🔓 Reintentar' }]);
    await panelTurno(telefono, t, null, r.vehiculo);
    return;
  }
  await panelTurno(telefono, t, cabecera, r.vehiculo);
}

/**
 * Al que tenía el coche: su turno (o su viaje) se ha cerrado porque otro lo ha
 * cogido. Si no pulsó «Entregar coche» se le dice quién lo tiene y que avise si
 * no se lo ha dado él: una matrícula mal escrita le quita el coche a otro, y
 * así se entera en el momento.
 */
async function avisarAlQueEntrega(t, quienEntra) {
  if (!t || !t.telefono) return;
  const w = W(t.tipo);
  const quien = quienEntra || 'tu compañero';
  const km = t.km == null ? '' : `\n🛣️ ${t.km} km` + (t.kmRelevo == null ? '' : ` (${t.kmRelevo} del trayecto de entrega)`);
  const titulo = t.sinBoton ? `🔄 *${quien} ha cogido el ${t.matricula}*` : '🔄 *Coche entregado*';
  const pie = t.sinBoton
    ? `Tu ${w.cosa} queda cerrado y el coche pasa a ser responsabilidad suya. Si no se lo has dado tú, avisa a Tráfico.`
    : `Tu ${w.cosa} queda cerrado. ¡Gracias y buen descanso! 👋`;
  await enviarTexto(t.telefono,
    `${titulo}\n\n🚘 ${t.matricula} → lo tiene *${quien}* desde las ${hora(t.fin)}\n` +
    `🕐 Tu ${w.cosa}: ${fichaje.horaES(t.inicio)} → ${fichaje.horaES(t.fin)} (${fichaje.duracion(t.fin - t.inicio)})${km}\n\n` + pie);
}

/** Abrir o cerrar las puertas del coche del turno. */
async function puertasConductor(telefono, p, abrirlas) {
  const { abierto, turno } = await fichaje.estado(telefono);
  if (!abierto) {
    await bienvenida(telefono, p, 'Primero dime qué coche llevas.');
    return;
  }
  const r = await puertas.ejecutar({
    telefono, conductorId: turno.conductorId, nombre: turno.nombre,
    matricula: turno.matricula, unitId: turno.unitId, abrir: abrirlas,
  });
  if (!r.ok) {
    await enviarTexto(telefono, `❌ No he podido ${abrirlas ? 'abrir' : 'cerrar'} las puertas. Inténtalo de nuevo.`);
    return;
  }
  puertasDe.set(tel9(telefono), { matricula: turno.matricula, abierta: abrirlas });
  await mensajePuertas(telefono, turno);
}

/** «Entregar coche», o deshacerlo si se pulsó sin querer. */
async function entregar(telefono, si) {
  const antes = await fichaje.estado(telefono);
  if (si && antes.abierto && antes.turno.relevo) {
    await enviarBotones(telefono,
      `🚗 Ya lo tenías anotado: saliste a entregar el coche a las ${hora(antes.turno.relevo)}.`,
      [{ id: BTN_ENTREGAR_NO, titulo: '↩️ Aún no he salido' }, { id: BTN_TERMINAR, titulo: '🔴 Terminar turno' }]);
    return;
  }
  const r = await fichaje.marcarRelevo(telefono, si);
  if (!r.ok) {
    if (r.motivo === 'es-viaje') return panel(telefono, 'Entregar el coche es para los turnos, no para los viajes.');
    return panel(telefono, 'No tienes ningún turno abierto.');
  }
  const t = r.turno;
  if (!si) {
    await mensajePuertas(telefono, t, `↩️ *Quitado.* Sigues en tu turno con el ${t.matricula}.`);
    return;
  }
  await enviarBotones(telefono,
    `🚗 *Anotado: sales a entregar el coche* (${hora(t.relevo)}).\n` +
    'Desde ahora cuento los km hasta que se lo des.\n\n' +
    'Cuando llegues, tu compañero solo tiene que escribirme la matrícula: tu turno se cierra solo. ' +
    'Si no hay nadie a quien dárselo, *apaga el coche* y pulsa *Terminar turno*.\n\n' +
    '_Si lo has pulsado sin querer, pulsa *Aún no he salido*._',
    [{ id: BTN_ENTREGAR_NO, titulo: '↩️ Aún no he salido' }, { id: BTN_TERMINAR, titulo: '🔴 Terminar turno' }]);
}

/** Sus turnos de hoy a 7 días. */
async function verTurnos(telefono, p, conTurno) {
  try {
    const { textoTurnos } = require('../modules/Planificacion/turnos.service');
    const r = await textoTurnos({ phone: telefono, nombreSesion: p && p.nombre });
    console.log(`📅 [Turnos] …${String(telefono).slice(-4)} → ${r.nombre || '?'} (por ${r.como})`);
    await enviarTexto(telefono, r.texto);
  } catch (e) {
    console.error('❌ [Turnos] textoTurnos:', e.message);
    await enviarTexto(telefono, 'No pude cargar tus turnos ahora mismo. Inténtalo en un momento, por favor.');
  }
  if (conTurno) await mensajeOpciones(telefono);
}

/** Un código de lavado Ballenoil (hasta el 15/10/2026). */
async function codigoLavado(telefono, p, conTurno) {
  if (!lavado.visible()) {
    await enviarTexto(telefono, 'ℹ️ Los códigos de lavado ya no se reparten por aquí.');
  } else {
    let r = null;
    try { r = await lavado.solicitar({ telefono, conductorId: p && p.conductorId, idBolt: p && p.nombre }); }
    catch (e) { console.error('❌ [Lavado] solicitar:', e.message); }
    if (r) console.log(`🧽 [Lavado] …${String(telefono).slice(-4)} → ${r.codigo}${r.repetido ? ' (repetido)' : ''}`);
    await enviarTexto(telefono, lavado.mensaje(r));
  }
  if (conTurno) await mensajeOpciones(telefono);
}

/** Los botones del panel del conductor (los ids de siempre). */
async function botonConductor(telefono, id, p) {
  const { abierto, turno } = await fichaje.estado(telefono);
  if (id === BTN_ABRIR || id === BTN_CERRAR) return puertasConductor(telefono, p, id === BTN_ABRIR);
  if (id === BTN_LAVADO) return codigoLavado(telefono, p, abierto);
  if (id === BTN_TURNOS) return verTurnos(telefono, p, abierto);
  if (id === BTN_CAMBIAR) {
    // De mensajes viejos: cambiar de coche es terminar el turno y empezar otro.
    if (abierto) {
      await enviarTexto(telefono, `Tienes el turno abierto con el *${turno.matricula}*. ` +
        'Para cambiar de coche, pulsa primero *Terminar turno* y luego escríbeme la nueva matrícula.');
      return mensajeOpciones(telefono);
    }
    return bienvenida(telefono, p);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// LA EMPRESA: VIAJES
// ══════════════════════════════════════════════════════════════════════════

/** Los botones con el viaje abierto. */
const botonesViaje = () => [{ id: BTN_TERMINAR, titulo: '🔴 Terminar viaje' },
  { id: BTN_KM, titulo: '📍 Ver km ahora' }, { id: BTN_MOTOR, titulo: '🔓 Desbloquear' }];

/** Lo que se le dice con el viaje abierto. */
const textoViaje = (t, cabecera) => conCabecera(cabecera,
  `🟢 *Viaje abierto*\n🚘 ${t.matricula}\n🕐 Desde las ${fichaje.horaES(t.inicio)}\n\n` +
  'Cuando acabes, *apaga el coche* y pulsa *Terminar viaje*: el motor se queda bloqueado.');

/** Pide la matrícula y se queda esperándola. */
async function pedirMatricula(telefono, cabecera) {
  esperando.set(tel9(telefono), Date.now() + ESPERA_MS);
  await enviarTexto(telefono, conCabecera(cabecera,
    '🚘 Por favor, indica la *matrícula* del coche (sin espacios ni guiones).\n\nEjemplo: *1234ABC*\n\n' +
    '_Escribe *cancelar* para salir._'));
}

/** Viaje recién empezado. */
async function abiertoViaje(telefono, r) {
  const t = r.turno;
  const m = r.motor || {};
  const motor = !r.bloqueoActivo ? ''
    : m.hecho
      ? (m.yaEstaba ? '\n🔓 El motor ya estaba libre' : '\n🔓 *Motor desbloqueado* — ya puedes arrancar')
      : `\n🔒 *ATENCIÓN: el motor NO se ha desbloqueado*\n_${m.motivo || 'motivo desconocido'}_\n` +
        'Pulsa *Desbloquear* para reintentarlo; si sigue igual, avisa a Tráfico.';
  const relevo = r.relevoDe ? `🔄 Figuraba con *${r.relevoDe.nombre}*: su ${W(r.relevoDe.tipo).cosa} queda cerrado.\n` : '';
  await enviarBotones(telefono,
    `🟢 *Viaje iniciado*\n\n🚘 ${t.matricula}${r.vehiculo ? ` · ${r.vehiculo}` : ''}\n🕐 ${fichaje.horaES(t.inicio)}\n${relevo}` +
    `${r.enlazado ? '🔗 Enlazado a tu nombre en Mapon'
      : `⚠️ No se pudo enlazar en Mapon (queda registrado igual)\n_${(r.errorMapon || 'motivo desconocido').slice(0, 220)}_`}` +
    `${motor}\n\nCuando acabes, ${r.bloqueoActivo ? '*apaga el coche* y pulsa *Terminar viaje*: el motor se queda bloqueado.' : 'pulsa *Terminar viaje*.'}`,
    botonesViaje());
}

// ══════════════════════════════════════════════════════════════════════════
// COMÚN
// ══════════════════════════════════════════════════════════════════════════

/**
 * El panel: según haya algo abierto o no, unos botones u otros. Devuelve false
 * si ese número no participa (y entonces no se le ha mandado nada).
 */
async function panel(telefono, cabecera) {
  const p = await fichaje.participa(telefono);
  if (!p) return false;
  const { abierto, turno } = await fichaje.estado(telefono);

  if (p.tipo === 'turno') {
    if (abierto) await panelTurno(telefono, turno, cabecera);
    else if (p.soloCerrar) await enviarTexto(telefono, conCabecera(cabecera, 'No tienes ningún turno abierto.'));
    else await bienvenida(telefono, p, cabecera);
    return true;
  }

  if (abierto) {
    await enviarBotones(telefono, textoViaje(turno, cabecera), botonesViaje());
    return true;
  }
  if (p.soloCerrar) {
    await enviarTexto(telefono, conCabecera(cabecera, 'No tienes nada abierto.'));
    return true;
  }
  // LA EMPRESA: directo a la matrícula. Es su flujo: dice el coche y empieza.
  await pedirMatricula(telefono, cabecera || `👋 Hola${p.pila ? ', ' + p.pila : ''}.`);
  return true;
}

/** Texto recibido. Devuelve true si esta conversación se ha ocupado del mensaje. */
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
    const mat = comoMatricula(t);
    if (!MAT.test(mat)) {
      await enviarTexto(telefono, '❌ Eso no parece una matrícula. Escríbela sin espacios ni guiones (ejemplo: *1234ABC*), o escribe *cancelar*.');
      return true;
    }
    esperando.delete(tel9(telefono));
    await abrir(telefono, normMat(mat));
    return true;
  }

  // EL CONDUCTOR: todo lo suyo pasa por aquí, sea lo que sea que escriba.
  const p = await fichaje.participa(telefono);
  if (p && p.tipo === 'turno') return textoConductor(telefono, t, p);

  // LA EMPRESA: solo se queda sus palabras; el resto sigue al panel de puertas.
  if (!p || !PALABRAS.test(t)) return false;
  if (/^km$/i.test(t)) { await verKm(telefono); return true; }
  await panel(telefono);
  return true;
}

/**
 * Enseña el panel si ese número participa. Lo usa el bot de puertas cuando
 * alguien de la empresa con el fichaje encendido NO tiene el permiso de
 * puertas: en vez de «no tienes permiso», se le lleva a lo suyo.
 */
const panelSiParticipa = async telefono => ((await fichaje.participa(telefono)) ? panel(telefono) : false);

/**
 * El botón del VIAJE para el panel de PUERTAS de la gente de oficina, o null.
 * Con una matrícula ya elegida y nada abierto, el botón EMPIEZA el viaje en ese
 * coche. Los conductores no pasan por ese panel: tienen el suyo.
 */
async function botonDeTurno(telefono, matricula) {
  const p = await fichaje.participa(telefono);
  if (!p || p.tipo === 'turno') return null;
  const boton = (id, title) => ({ type: 'reply', reply: { id, title: String(title).slice(0, 20) } });
  const { abierto, turno } = await fichaje.estado(telefono);
  if (abierto) return boton(BTN_PANEL, W(turno.tipo).mi);
  if (p.soloCerrar) return null;
  const w = W(p.tipo);
  return matricula ? boton(BTN_INICIAR_EN + normMat(matricula), w.iniciar) : boton(BTN_PANEL, w.mi);
}

/** Botón pulsado. Devuelve true si era de esta conversación. */
async function manejarBoton(telefono, buttonId) {
  const id = String(buttonId || '');
  const delPanel = DEL_PANEL.has(id);
  if (!id.startsWith('turno_') && !delPanel) return false;
  const p = await fichaje.participa(telefono);

  // Abrir/cerrar, lavado y turnos son del conductor; los de oficina los lleva
  // el panel de puertas, con el coche que hayan escrito allí.
  if (delPanel) {
    if (!p || p.tipo !== 'turno') return false;
    await botonConductor(telefono, id, p);
    return true;
  }

  if (!p) {
    await enviarTexto(telefono, 'ℹ️ No tienes activado el uso de coches por aquí. Si crees que es un error, avisa a Tráfico.');
    return true;
  }
  if (id.startsWith(BTN_INICIAR_EN)) { await abrir(telefono, id.slice(BTN_INICIAR_EN.length)); return true; }
  if (id === BTN_INICIAR || id === BTN_OTRO) {
    const { abierto } = await fichaje.estado(telefono);
    if (abierto) { await panel(telefono, `⚠️ Ya tenías un ${W(p.tipo).cosa} abierto.`); return true; }
    if (p.tipo === 'turno') await bienvenida(telefono, p);
    else await pedirMatricula(telefono);
    return true;
  }
  if (id === BTN_PANEL) { await panel(telefono); return true; }
  if (id === BTN_TERMINAR) { await cerrar(telefono); return true; }
  if (id === BTN_KM) { await verKm(telefono); return true; }
  if (id === BTN_MOTOR) { await desbloquear(telefono); return true; }
  if (id === BTN_ENTREGAR) { await entregar(telefono, true); return true; }
  if (id === BTN_ENTREGAR_NO) { await entregar(telefono, false); return true; }
  return false;
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
    return panel(telefono, `🔓 El motor de *${turno.matricula}* está libre: puedes arrancar.`);
  }
  if (antes.sabemos && !antes.bloqueado) {
    return panel(telefono, `🔓 El motor de *${turno.matricula}* ya está libre.`);
  }
  const r = await fichaje.liberarMotor(turno.unitId);
  if (r.hecho) return panel(telefono, `🔓 *Motor desbloqueado* en ${turno.matricula}. Ya puedes arrancar.`);
  await enviarBotones(telefono,
    `🔒 Sigue sin desbloquearse.\n_${r.motivo}_\n\nVuelve a intentarlo en un minuto; si no, avisa a Tráfico.`,
    [{ id: BTN_MOTOR, titulo: '🔓 Reintentar' }]);
}

async function verKm(telefono) {
  const { abierto, turno } = await fichaje.estado(telefono);
  if (!abierto) return panel(telefono, 'No tienes nada abierto.');
  const km = await fichaje.kmDelTurno(turno);
  const dur = fichaje.duracion(Math.floor(Date.now() / 1000) - turno.inicio);
  const w = W(turno.tipo);
  const texto = km ? `📍 *Llevas ${km.km} km* en ${turno.matricula}\n🕐 ${dur} de ${w.cosa} · ${km.trayectos} trayecto(s)`
    : `📍 ${w.Cosa} en ${turno.matricula} · ${dur}\n(No he podido leer los km ahora mismo)`;
  if (turno.tipo === 'turno') {
    await enviarTexto(telefono, texto);
    await mensajeOpciones(telefono);
    return;
  }
  await enviarBotones(telefono, texto, botonesViaje());
}

async function cerrar(telefono) {
  let r;
  try {
    r = await fichaje.terminar(telefono);
  } catch (e) {
    console.error('❌ [FICHAJE] terminar:', e.message);
    await enviarTexto(telefono, '❌ Ahora mismo no he podido terminar. Inténtalo de nuevo en un momento.');
    return;
  }
  const abiertoAhora = r.turno || {};
  const w = W(abiertoAhora.tipo);
  const deNuevo = [{ id: BTN_TERMINAR, titulo: w.terminar }];
  // Va conduciendo. Se queda ABIERTO a propósito: terminar es lo que corta el
  // motor, y hacerlo rodando lo inmovilizaría donde quiera que pare.
  if (!r.ok && r.motivo === 'coche-en-marcha') {
    await enviarBotones(telefono,
      `🚗 *Estás en marcha* (${r.velocidad} km/h).\n\n` +
      'Al terminar se bloquea el motor, así que *primero aparca* en un sitio seguro y apaga el coche. ' +
      `Cuando estés parado, vuelve a pulsar *${w.terminar.slice(3)}*.\n\n` +
      `_Tu ${w.cosa} sigue abierto: no has perdido nada._`, deNuevo);
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
      `_Tu ${w.cosa} sigue abierto: no has perdido nada._`, deNuevo);
    return;
  }
  if (!r.ok) return panel(telefono, '⚠️ No tenías nada abierto.');

  const t = r.turno;
  puertasDe.delete(tel9(telefono));
  const dur = fichaje.duracion(t.fin - t.inicio);
  const entrega = t.relevo
    ? `\n🚗 Entrega: ${t.kmRelevo == null ? '—' : t.kmRelevo} km desde las ${hora(t.relevo)}` : '';
  const faltan = (r.faltan || []).map(n => `*${n}*`).join(', ');
  const m = r.motor || {};
  const motor = !r.bloqueoActivo || m.sinControl ? ''
    : m.seQuedaLibre
      ? `\n🔓 El motor se queda *libre*: este coche también lo lleva ${faltan || 'otra persona'}.`
      : m.hecho
        ? (m.yaEstaba ? '\n🔒 El motor ya estaba bloqueado' : `\n🔒 Motor bloqueado hasta el próximo ${w.cosa}`) +
          (faltan ? `\n⚠️ Ojo: este coche lo lleva ${faltan}, sin el bloqueo encendido. Si lo necesita, Tráfico se lo suelta desde el planificador.` : '')
        : `\n⚠️ El motor NO se ha bloqueado (_${m.motivo || 'motivo desconocido'}_)` +
          (m.reintentable ? '\n_Se reintentará solo cuando el coche lleve un rato parado._' : '');
  const resumen = `🔴 *${w.Cosa} terminado*\n\n🚘 ${t.matricula}\n🕐 ${fichaje.horaES(t.inicio)} → ${fichaje.horaES(t.fin)} (${dur})\n` +
    `🛣️ *${t.km == null ? '—' : t.km} km* recorridos${entrega}${motor}`;

  if (t.tipo === 'turno') {
    const p = await fichaje.participa(telefono);
    await enviarTexto(telefono, `${resumen}\n\nGracias${p && p.pila ? ', ' + p.pila : ''}. ¡Buen descanso! 👋\n` +
      'Cuando vuelvas a coger un coche, escríbeme su matrícula.');
    return;
  }
  await enviarBotones(telefono, `${resumen}\n\nGracias. Queda registrado.`, [{ id: BTN_PANEL, titulo: w.iniciar }]);
}

module.exports = { manejarTexto, manejarBoton, panel, panelSiParticipa, botonDeTurno };
