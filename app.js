const express = require('express');
const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// URL de tu Apps Script (cámbiala por la nueva)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyUTX9tGnB-ViBoxKOOIyN7TNKiR3JBhhv_o5fI7k1GZ9v-LmCtUlAHScxrWSHTYd7h/exec';

// ============================================================
// VERIFICACIÓN DEL WEBHOOK (Meta)
// ============================================================
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// ============================================================
// RECIBIR MENSAJES DE WHATSAPP
// ============================================================
app.post('/', async (req, res) => {
  console.log('\n=== WEBHOOK RECIBIDO ===');
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    // Si no hay mensajes, salir
    if (!messages || !messages[0]) {
      console.log('No hay mensajes (puede ser un estado)');
      return res.status(200).end();
    }

    const message = messages[0];
    const from = message.from; // Número del conductor

    // Verificar si es un botón interactivo
    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      const buttonId = message.interactive.button_reply.id;
      console.log(`Botón pulsado: ${buttonId} por ${from}`);
      await handleButton(from, buttonId);
    } else {
      // Es un mensaje de texto cualquiera
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
// PRIMER MENSAJE: BUSCAR CONDUCTOR, VERIFICAR TURNO, ENVIAR BOTONES
// ============================================================
async function handleFirstMessage(phone) {
  // 1. Buscar conductor
  const conductor = await callAppsScript('buscar_conductor', { telefono: phone });

  if (!conductor || !conductor.encontrado) {
    await sendText(phone, '❌ No estás autorizado. Contacta con administración.');
    return;
  }

  const nombre = conductor.nombre;
  const matricula = conductor.matricula;

  console.log(`Conductor encontrado: ${nombre} → ${matricula}`);

  // 2. Verificar turno
  const turno = await callAppsScript('verificar_turno', { nombre: nombre });

  if (!turno || !turno.en_turno) {
    await sendText(phone, '⛔ Estás fuera de tu turno. Contacta con tráfico.');
    return;
  }

  console.log(`Turno verificado: ${turno.turno}`);

  // 3. Enviar botones
  await sendButtons(phone, nombre, matricula);
}

// ============================================================
// BOTÓN PULSADO: EJECUTAR COMANDO
// ============================================================
async function handleButton(phone, buttonId) {
  // Primero verificamos turno otra vez (por si acabó el turno mientras tanto)
  // Para eso necesitamos el nombre. Lo buscamos rápido.
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
    console.log(`Abriendo puertas para ${conductor.nombre} (${conductor.matricula})`);

    const result = await callAppsScript('ejecutar_comando', {
      matricula: conductor.matricula,
      comando: 'open_doors'
    });

    if (result.status === 'ok') {
      await sendText(phone, `✅ Puertas ABIERTAS\n🚗 ${result.vehiculo}\n🔒 Se cerrarán automáticamente en 30 segundos.`);

      // Esperar 30 segundos y cerrar
      setTimeout(async () => {
        const closeResult = await callAppsScript('ejecutar_comando', {
          matricula: conductor.matricula,
          comando: 'close_doors'
        });
        console.log('Cierre automático:', JSON.stringify(closeResult));
        await sendText(phone, '🔒 Puertas cerradas automáticamente.');
      }, 30000);

    } else {
      await sendText(phone, '❌ Error al abrir puertas: ' + (result.msg || 'Desconocido'));
    }
  } else if (buttonId === 'cerrar_puertas') {
    console.log(`Cerrando puertas para ${conductor.nombre} (${conductor.matricula})`);

    const result = await callAppsScript('ejecutar_comando', {
      matricula: conductor.matricula,
      comando: 'close_doors'
    });

    if (result.status === 'ok') {
      await sendText(phone, `✅ Puertas CERRADAS\n🚗 ${result.vehiculo}`);
    } else {
      await sendText(phone, '❌ Error al cerrar puertas: ' + (result.msg || 'Desconocido'));
    }
  }
}

// ============================================================
// FUNCIONES DE WHATSAPP
// ============================================================

async function sendText(to, text) {
  const url = `https://graph.facebook.com/v25.0/1256923474160518/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: text }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer EAAZBBQk7ZCDvkBR0jkEmoVjGn07x2OdgQzjtIWAZAlSJrFnsexsfZC7NqaKcKN1F3HBGxGw4eLOUQd0kqZCbRW3hMr3ZCYZBFJy94oxL0Pn9DBV092umEPhdgJ9HW4eV2Vh7CxhJJGHZCrBNbpRWSQ9whmqLKtVpAZBnx3Hdv8h3wuICs86P11R8w5ZA7Y2CgaITa0XgZDZD`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  console.log('WhatsApp sendText:', JSON.stringify(data));
  return data;
}

async function sendButtons(to, nombre, matricula) {
  const url = `https://graph.facebook.com/v25.0/1256923474160518/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `🚗 Hola ${nombre}, tu vehículo es ${matricula}\n¿Qué deseas hacer?`
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'abrir_puertas',
              title: '🔓 Abrir'
            }
          },
          {
            type: 'reply',
            reply: {
              id: 'cerrar_puertas',
              title: '🔒 Cerrar'
            }
          }
        ]
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer EAAZBBQk7ZCDvkBR0jkEmoVjGn07x2OdgQzjtIWAZAlSJrFnsexsfZC7NqaKcKN1F3HBGxGw4eLOUQd0kqZCbRW3hMr3ZCYZBFJy94oxL0Pn9DBV092umEPhdgJ9HW4eV2Vh7CxhJJGHZCrBNbpRWSQ9whmqLKtVpAZBnx3Hdv8h3wuICs86P11R8w5ZA7Y2CgaITa0XgZDZD`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  console.log('WhatsApp sendButtons:', JSON.stringify(data));
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

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(port, () => {
  console.log(`Bot de puertas escuchando en puerto ${port}`);
});