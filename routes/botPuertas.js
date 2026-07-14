const express = require('express');
const router = express.Router();

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzyYKcT23Vu4tlziAWRYlGkpNQE361CakLkeCECjUBKbdubLhMdpvyPUqcZxBHlQON-/exec';

const WHATSAPP_TOKEN = 'EAAZBBQk7ZCDvkBR0jkEmoVjGn07x2OdgQzjtIWAZAlSJrFnsexsfZC7NqaKcKN1F3HBGxGw4eLOUQd0kqZCbRW3hMr3ZCYZBFJy94oxL0Pn9DBV092umEPhdgJ9HW4eV2Vh7CxhJJGHZCrBNbpRWSQ9whmqLKtVpAZBnx3Hdv8h3wuICs86P11R8w5ZA7Y2CgaITa0XgZDZD';
const PHONE_NUMBER_ID = '1256923474160518';
const WHATSAPP_VERSION = 'v25.0';

// ============================================================
// RECIBIR MENSAJES DE WHATSAPP
// ============================================================
router.post('/', async (req, res) => {
  console.log('\n=== WEBHOOK RECIBIDO ===');
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || !messages[0]) {
      console.log('No hay mensajes (puede ser un estado)');
      return res.status(200).end();
    }

    const message = messages[0];
    const from = message.from;

    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      const buttonId = message.interactive.button_reply.id;
      console.log(`Botón pulsado: ${buttonId} por ${from}`);
      await handleButton(from, buttonId);
    } else {
      const text = message.text?.body || '';
      console.log(`Mensaje de texto: "${text}" de ${from}`);
      await handleFirstMessage(from);
    }

  } catch (error) {
    console.error('Error procesando webhook:', error);
  }

  res.status(200).end();
});

// ============================================================
// PRIMER MENSAJE
// ============================================================
async function handleFirstMessage(phone) {
  const conductor = await callAppsScript('buscar_conductor', { telefono: phone });

  if (!conductor || !conductor.encontrado) {
    await sendText(phone, '❌ No estás autorizado. Contacta con administración.');
    return;
  }

  const nombre = conductor.nombre;
  const matricula = conductor.matricula;

  console.log(`Conductor encontrado: ${nombre} → ${matricula}`);

  const turno = await callAppsScript('verificar_turno', { nombre: nombre });

  if (!turno || !turno.en_turno) {
    await sendText(phone, '⛔ Estás fuera de tu turno. Contacta con tráfico.');
    return;
  }

  console.log(`Turno verificado: ${turno.turno}`);
  await sendButtonsEstado(phone, nombre, matricula, 'cerrada');
}

// ============================================================
// BOTÓN PULSADO
// ============================================================
async function handleButton(phone, buttonId) {
  const conductor = await callAppsScript('buscar_conductor', { telefono: phone });
  if (!conductor || !conductor.encontrado) {
    await sendText(phone, '❌ No estás autorizado.');
    return;
  }

  const turno = await callAppsScript('verificar_turno', { nombre: conductor.nombre });
  if (!turno || !turno.en_turno) {
    await sendText(phone, '⛔ Tu turno ha terminado. Contacta con tráfico.');
    return;
  }

  if (buttonId === 'abrir_puertas') {
    console.log(`🔓 Abriendo puertas para ${conductor.nombre} (${conductor.matricula})`);

    const result = await callAppsScript('ejecutar_comando', {
      matricula: conductor.matricula,
      comando: 'open_doors'
    });

    if (result.status === 'ok') {
      await sendButtonsEstado(phone, conductor.nombre, conductor.matricula, 'abierta');
    } else {
      await sendText(phone, '❌ Error al abrir puertas. Inténtalo de nuevo.');
    }
  } else if (buttonId === 'cerrar_puertas') {
    console.log(`🔒 Cerrando puertas para ${conductor.nombre} (${conductor.matricula})`);

    const result = await callAppsScript('ejecutar_comando', {
      matricula: conductor.matricula,
      comando: 'close_doors'
    });

    if (result.status === 'ok') {
      await sendButtonsEstado(phone, conductor.nombre, conductor.matricula, 'cerrada');
    } else {
      await sendText(phone, '❌ Error al cerrar puertas. Inténtalo de nuevo.');
    }
  }
}

// ============================================================
// ENVIAR BOTÓN SEGÚN ESTADO
// ============================================================
async function sendButtonsEstado(to, nombre, matricula, estado) {
  const puertaAbierta = estado === 'abierta';
  const emoji = puertaAbierta ? '🔓' : '🔒';
  const textoEstado = puertaAbierta ? 'PUERTA ABIERTA' : 'PUERTA CERRADA';
  const botonId = puertaAbierta ? 'cerrar_puertas' : 'abrir_puertas';
  const botonTexto = puertaAbierta ? '🔒 Cerrar puertas' : '🔓 Abrir puertas';

  const url = `https://graph.facebook.com/${WHATSAPP_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `🚗 ${nombre}\n🚘 ${matricula}\n${emoji} ${textoEstado}`
      },
      action: {
        buttons: [{
          type: 'reply',
          reply: {
            id: botonId,
            title: botonTexto
          }
        }]
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  console.log('WhatsApp sendButtons:', JSON.stringify(data));
  return data;
}

// ============================================================
// ENVIAR TEXTO
// ============================================================
async function sendText(to, text) {
  const url = `https://graph.facebook.com/${WHATSAPP_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: text }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  console.log('WhatsApp sendText:', JSON.stringify(data));
  return data;
}

// ============================================================
// LLAMAR A APPS SCRIPT
// ============================================================
async function callAppsScript(accion, params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('accion', accion);
  Object.keys(params).forEach(key => url.searchParams.set(key, params[key]));

  console.log(`Llamando a Apps Script: ${url.toString()}`);

  const response = await fetch(url.toString());
  const data = await response.json();
  console.log('Respuesta Apps Script:', JSON.stringify(data));
  return data;
}

module.exports = router;