const express = require('express');
const router = express.Router();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = '1256923474160518';
const WHATSAPP_VERSION = 'v25.0';
const MAPON_API_KEY = process.env.MAPON_API_KEY || '';
const fichajeBot = require('../services/fichajeBot');
const puertas = require('../services/puertasBot');
const lavado = require('../services/lavadoBallenoil');

// ¿QUIÉN LLEVA CADA CONVERSACIÓN? (28/09/2026)
//
//   · Un CONDUCTOR DE ALTA: services/fichajeBot. Saludo → matrícula → su turno
//     en ese coche, con sus botones de siempre. Todo lo suyo pasa por allí.
//   · Alguien de la EMPRESA con el fichaje encendido: también allí (viajes).
//   · Alguien de OFICINA con el permiso /puertas: el panel de puertas de este
//     fichero — escribe una matrícula y abre o cierra, sin turno.

const sesiones = {};

// Meta REENVÍA un mensaje si no le contestamos a tiempo, y ahora un mensaje
// puede abrir un turno o dar un código de lavado: procesarlo dos veces no es
// inocuo. Se contesta 200 al momento y se recuerdan los ids ya vistos.
const VISTOS_MAX = 500;
const vistos = new Set();
function yaVisto(id) {
  if (!id) return false;
  if (vistos.has(id)) return true;
  vistos.add(id);
  if (vistos.size > VISTOS_MAX) vistos.delete(vistos.values().next().value);
  return false;
}

// ============================================================
// RECIBIR MENSAJES
// ============================================================
router.post('/', async (req, res) => {
  console.log('\n=== WEBHOOK RECIBIDO ===');
  console.log(JSON.stringify(req.body, null, 2));
  res.status(200).end();

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;
    if (yaVisto(message.id)) {
      console.log(`↩️ Mensaje repetido ${message.id}: ya se atendió`);
      return;
    }

    // Enrutado por número: lo que llega al número de la BODA (favor aparte) va a su
    // propio módulo. El bot de Telecab queda intacto.
    const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    const boda = require('../services/boda');
    if (phoneNumberId === boda.PHONE_NUMBER_ID) {
      await boda.manejarMensaje(message);
      return;
    }

    const from = message.from;

    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      const buttonId = message.interactive.button_reply.id;
      console.log(`Botón: ${buttonId} de ${from}`);
      await handleButton(from, buttonId);
    } else if (message.type === 'button') {
      // Botón de una PLANTILLA (quick reply) → llega como type:button con button.text/payload.
      const label = (message.button?.payload || message.button?.text || '').trim();
      console.log(`Botón plantilla: "${label}" de ${from}`);
      await handleTemplateButton(from, label);
    } else {
      const text = message.text?.body?.trim() || '';
      console.log(`Texto: "${text}" de ${from}`);
      await handleText(from, text);
    }
  } catch (error) {
    console.error('Error:', error);
  }
});

// ============================================================
// TEXTO RECIBIDO
// ============================================================
async function handleText(phone, text) {
  // Conductores y viajes de la empresa: va ANTES de la comprobación de puertas,
  // porque es su conversación entera (y alguien de la empresa puede coger un
  // coche sin tener el permiso de abrir puertas).
  if (await fichajeBot.manejarTexto(phone, text)) return;

  // ── ¿PUEDE ABRIR? ─────────────────────────────────────────────────────────
  // Lo decide `repo/puertas.quienPuedeAbrir`: un conductor abre por estar DE
  // ALTA —el número con el que se le dio de alta—, y la gente de oficina por
  // tener el permiso `/puertas`, que se da uno a uno en /usuarios.
  //
  // BOLT no entra aquí a propósito: ver la nota en `repo/puertas`.
  const acceso = await require('../services/repo/puertas').quienPuedeAbrir(phone)
    .catch(e => {
      console.error('❌ [Puertas] quienPuedeAbrir:', e.message);
      return { puede: false, motivo: 'error' };
    });

  if (!acceso.puede) {
    // Sin puertas pero con el fichaje encendido: se le lleva a lo suyo en vez
    // de contestarle «no tienes permiso».
    if (await fichajeBot.panelSiParticipa(phone).catch(() => false)) return;
    // SE DICE QUÉ FALTA. «No estás autorizado» a secas manda a la persona a
    // preguntar a tráfico, y tráfico a mirar la hoja: cada motivo tiene una
    // salida distinta y la más rápida es decirla.
    const PORQUE = {
      sin_numero:  '❌ No te reconozco por este número.',
      no_esta:     '❌ No estás autorizado. Tu número no está en la base de datos.',
      sin_alta:    '❌ No estás autorizado: no constas de alta ahora mismo. Habla con RRHH.',
      bloqueado:   '❌ Tu usuario está bloqueado.',
      sin_permiso: '❌ Tu usuario no tiene permiso para abrir puertas.',
      error:       '❌ Ahora mismo no puedo comprobar tu acceso. Inténtalo en un minuto.',
    };
    console.warn(`🚫 [Puertas] Sin autorizar …${String(phone).slice(-4)} (${acceso.motivo}` +
                 `${acceso.nombre ? ': ' + acceso.nombre : ''})`);
    await sendText(phone, PORQUE[acceso.motivo] || PORQUE.no_esta);
    return;
  }

  // Aquí llega la gente de OFICINA con el permiso de puertas (los conductores
  // ya se quedaron en su conversación). No hay conductorId y eso está bien: el
  // registro de la orden guardará su nombre y su número.
  const nombre = acceso.nombre;
  const conductorId = acceso.conductorId || null;

  // Palabra clave para ver los turnos (además del botón).
  if (/^(ver\s+)?(mis\s+)?turnos?$|^relevos?$/i.test(text.trim())) {
    await enviarTurnos(phone, nombre);
    return;
  }

  // QUE PAREZCA UNA MATRICULA DE VERDAD, no cualquier palabra corta.
  //
  // Con {4,8} y sin mas, "hola" era una matricula perfectamente valida: seis
  // letras o menos y a buscar en Mapon. Ignacio saludó al bot y le contestó
  // «Matrícula "HOLA" no encontrada» sin saludarle siquiera. Lo mismo con
  // "buenas", "gracias", "adios" o "vale".
  //
  // Toda matricula española lleva digitos y tiene entre 6 y 8 caracteres: la
  // moderna son 4 numeros y 3 letras; la antigua, provincia + 4 numeros +
  // letras. Exigir un digito basta para que ninguna palabra pase por coche.
  const matriculaRegex = /^(?=.*\d)[A-Za-z0-9]{6,8}$/;
  const posible = text.replace(/[\s.\-_]/g, '');

  if (matriculaRegex.test(posible)) {
    const matricula = posible.toUpperCase();
    console.log(`${nombre} busca matrícula: ${matricula}`);

    const resultado = await buscarEnMapon(matricula);
    console.log(`📋 Resultado Mapon:`, JSON.stringify(resultado));

    if (!resultado || !resultado.encontrado) {
      await sendText(phone, `❌ No encuentro la matrícula "${matricula}". Escríbela otra vez, todo junto (ejemplo: 1234ABC).`);
      return;
    }

    sesiones[phone] = {
      nombre,
      // La ficha viaja en la sesión: es lo que permite que el registro de
      // puertas diga QUIÉN abrió y no solo desde qué número.
      conductorId,
      matricula: resultado.matricula,
      unitId: resultado.unit_id,
      vehiculo: resultado.vehiculo,
      estado: 'cerrada'
    };

    await sendButtonsEstado(phone, nombre, resultado.matricula, resultado.vehiculo, 'cerrada');

  } else if (sesiones[phone]) {
    const s = sesiones[phone];
    await sendButtonsEstado(phone, s.nombre, s.matricula, s.vehiculo, s.estado || 'cerrada');
  } else {
    await sendText(phone, `👋 Hola ${nombre}, escribe la matrícula del vehículo que quieres abrir o cerrar, todo junto.\n\nEjemplo: 1888LTJ`);
  }
}

// ============================================================
// BOTÓN PULSADO
// ============================================================
async function handleButton(phone, buttonId) {
  // Los del conductor y los del viaje: no dependen de la sesión de puertas.
  if (await fichajeBot.manejarBoton(phone, buttonId)) return;

  const sesion = sesiones[phone];

  if (buttonId === 'ver_turnos') {
    await enviarTurnos(phone, sesion && sesion.nombre);
    if (sesion) await sendButtonsEstado(phone, sesion.nombre, sesion.matricula, sesion.vehiculo, sesion.estado || 'cerrada');
    return;
  }

  if (!sesion) {
    await sendText(phone, '⚠️ Primero escribe una matrícula (ej: 1888LTJ).');
    return;
  }

  if (buttonId === 'abrir_puertas' || buttonId === 'cerrar_puertas') {
    const abrir = buttonId === 'abrir_puertas';
    const r = await puertas.ejecutar({
      telefono: phone, conductorId: sesion.conductorId, nombre: sesion.nombre,
      matricula: sesion.matricula, unitId: sesion.unitId, abrir,
    });
    if (r.ok) {
      sesion.estado = abrir ? 'abierta' : 'cerrada';
      await sendButtonsEstado(phone, sesion.nombre, sesion.matricula, sesion.vehiculo, sesion.estado);
    } else {
      await sendText(phone, `❌ Error al ${abrir ? 'abrir' : 'cerrar'} puertas. Inténtalo de nuevo.`);
    }

  } else if (buttonId === 'cambiar_matricula') {
    delete sesiones[phone];
    await sendText(phone, '🔄 Escribe la nueva matrícula (ej: 1888LTJ):');

  } else if (buttonId === 'codigo_lavado') {
    // Los códigos de lavado vuelven hasta el 15/10/2026 (services/lavadoBallenoil).
    if (!lavado.visible()) {
      await sendText(phone, 'ℹ️ Los códigos de lavado ya no se reparten por aquí.');
    } else {
      let r = null;
      try { r = await lavado.solicitar({ telefono: phone, conductorId: sesion.conductorId, idBolt: sesion.nombre }); }
      catch (e) { console.error('❌ [Lavado] solicitar:', e.message); }
      await sendText(phone, lavado.mensaje(r));
    }
    await sendButtonsEstado(phone, sesion.nombre, sesion.matricula, sesion.vehiculo, sesion.estado || 'cerrada');
  }
}

// Sus turnos de hoy a 7 días (o el mensaje del evento, si hay uno en marcha).
async function enviarTurnos(phone, nombreSesion) {
  try {
    const { textoTurnos } = require('../modules/Planificacion/turnos.service');
    const r = await textoTurnos({ phone, nombreSesion });
    console.log(`📅 [Turnos] …${String(phone).slice(-4)} → ${r.nombre || '?'} (por ${r.como})`);
    await sendText(phone, r.texto);
  } catch (e) {
    console.error('❌ [Turnos] enviarTurnos:', e.message);
    await sendText(phone, 'No pude cargar tus turnos ahora mismo. Inténtalo en un momento, por favor.');
  }
}

// Botón de una PLANTILLA (quick reply).
async function handleTemplateButton(phone, label) {
  const l = (label || '').toUpperCase();
  // Se acepta cualquier etiqueta razonable del botón ("Ver mis turnos", "Ver detalle",
  // "Ver horario"…) para no depender del texto exacto con el que se aprobó la plantilla.
  if (/TURNO|DETALLE|HORARIO|SEMANA/.test(l)) {
    // Botón "Ver mis turnos" del aviso → se manda el detalle en TEXTO LIBRE (bien formateado).
    console.log(`📅 [Turnos] Botón "ver turnos" de ${phone}`);
    await enviarTurnos(phone);
  } else if (l.includes('PIN') || l.includes('BALLENOIL')) {
    // EL PIN DE REPOSTAJE DE BALLENOIL YA NO SE USA (24/09/2026). El botón puede
    // seguir llegando de bienvenidas viejas: se le dice, y se le deja el menú.
    await sendText(phone, 'ℹ️ El PIN de repostaje de Ballenoil ya no se usa.');
    await handleText(phone, '');
  } else {
    await handleText(phone, '');   // etiqueta desconocida → saludo/menú normal
  }
}

// El panel de puertas de la gente de OFICINA (los conductores tienen el suyo).
async function sendButtonsEstado(to, nombre, matricula, vehiculo, estado) {
  const puertaAbierta = estado === 'abierta';
  const emoji = puertaAbierta ? '🔓' : '🔒';
  const textoEstado = puertaAbierta ? 'PUERTA ABIERTA' : 'PUERTA CERRADA';

  // El botón del viaje, si esa persona lo tiene encendido. Con la matrícula ya
  // elegida EMPIEZA el viaje en este coche: «indica la matrícula → inicia». Si
  // falla, el panel de puertas sale igual, sin él.
  const botonViaje = await fichajeBot.botonDeTurno(to, matricula).catch(e => {
    console.error('⚠️ [Puertas] botón del viaje:', e.message);
    return null;
  });
  await enviarInteractivo(to, `🚗 ${nombre}\n🚘 ${vehiculo} (${matricula})\n${emoji} ${textoEstado}`, [
    { type: 'reply', reply: { id: 'abrir_puertas', title: '🔓 Abrir' } },
    { type: 'reply', reply: { id: 'cerrar_puertas', title: '🔒 Cerrar' } },
    ...(botonViaje ? [botonViaje] : []),
  ]);
  // Segundo mensaje con las opciones extra (WhatsApp permite hasta 3 botones por mensaje).
  await enviarInteractivo(to, '🔧 Otras opciones', [
    ...(lavado.visible() ? [{ type: 'reply', reply: { id: 'codigo_lavado', title: '🧽 Código de lavado' } }] : []),
    { type: 'reply', reply: { id: 'cambiar_matricula', title: '🔄 Cambiar matrícula' } },
  ]);
  console.log(`📱 Botones enviados: ${textoEstado}`);
}

async function enviarInteractivo(to, texto, buttons) {
  await fetch(`https://graph.facebook.com/${WHATSAPP_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'interactive',
      interactive: { type: 'button', body: { text: texto }, action: { buttons } },
    }),
  });
}

// ============================================================
// ENVIAR TEXTO
// ============================================================
async function sendText(to, text) {
  const url = `https://graph.facebook.com/${WHATSAPP_VERSION}/${PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: text }
    })
  });
}

// ============================================================
// BUSCAR MATRÍCULA EN MAPON DIRECTAMENTE
// ============================================================
async function buscarEnMapon(matricula) {
  const url = `https://www.mapon.com/api/v1/unit/list.json?key=${MAPON_API_KEY}`;

  try {
    const response = await fetch(url);
    const json = await response.json();
    const units = json.data.units;
    console.log(`📊 Total unidades recibidas: ${units.length}`);

    const matriculaLimpia = matricula.replace(/\s/g, '').toUpperCase();
    console.log(`🔍 Buscando "${matriculaLimpia}" entre ${units.length} unidades...`);

    // 1. Búsqueda exacta sin espacios
    for (const u of units) {
      const numLimpio = (u.number || '').replace(/\s/g, '').toUpperCase();
      if (numLimpio === matriculaLimpia) {
        console.log(`✅ Encontrado exacto: ${u.number}`);
        return {
          encontrado: true,
          unit_id: u.unit_id,
          vehiculo: `${u.make || ''} ${u.modelo || ''}`.trim() || u.label || 'Vehículo',
          matricula: u.number
        };
      }
    }

    // 2. Búsqueda parcial
    for (const u of units) {
      const numLimpio = (u.number || '').replace(/\s/g, '').toUpperCase();
      if (numLimpio.includes(matriculaLimpia) || matriculaLimpia.includes(numLimpio)) {
        console.log(`✅ Encontrado parcial: ${u.number}`);
        return {
          encontrado: true,
          unit_id: u.unit_id,
          vehiculo: `${u.make || ''} ${u.modelo || ''}`.trim() || u.label || 'Vehículo',
          matricula: u.number
        };
      }
    }

    // 3. Búsqueda por label
    for (const u of units) {
      const labelLimpio = (u.label || '').replace(/\s/g, '').toUpperCase();
      if (labelLimpio.includes(matriculaLimpia)) {
        console.log(`✅ Encontrado por label: ${u.label}`);
        return {
          encontrado: true,
          unit_id: u.unit_id,
          vehiculo: `${u.make || ''} ${u.modelo || ''}`.trim() || u.label || 'Vehículo',
          matricula: u.number
        };
      }
    }

    const similares = units
      .filter(u => (u.number || '').replace(/\s/g, '').toUpperCase().includes(matriculaLimpia.substring(0, 4)))
      .slice(0, 5)
      .map(u => u.number);

    console.log(`❌ No encontrado. Similares: ${similares.join(', ')}`);

    return { encontrado: false, similares };

  } catch (error) {
    console.error('Error buscando en Mapon:', error);
    return { encontrado: false, error: error.message };
  }
}

module.exports = router;
