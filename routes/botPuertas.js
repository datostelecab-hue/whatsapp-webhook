const express = require('express');
const router = express.Router();

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzPJUuuWtrR-r_kV3ADry2FyTFQAvGmW94wsYO5MohqTFLOQ1YTusKOdjOjLa5ggv50/exec';

const WHATSAPP_TOKEN = 'EAAZBBQk7ZCDvkBR0jkEmoVjGn07x2OdgQzjtIWAZAlSJrFnsexsfZC7NqaKcKN1F3HBGxGw4eLOUQd0kqZCbRW3hMr3ZCYZBFJy94oxL0Pn9DBV092umEPhdgJ9HW4eV2Vh7CxhJJGHZCrBNbpRWSQ9whmqLKtVpAZBnx3Hdv8h3wuICs86P11R8w5ZA7Y2CgaITa0XgZDZD';
const PHONE_NUMBER_ID = '1256923474160518';
const WHATSAPP_VERSION = 'v25.0';
const MAPON_API_KEY = 'd1ff9336961ee25a46091c08663de3612d6a4955';
// Mapa de sesiones: guarda matrícula actual por conductor
const sesiones = {};

// ============================================================
// RECIBIR MENSAJES
// ============================================================
router.post('/', async (req, res) => {
  console.log('\n=== WEBHOOK RECIBIDO ===');
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.status(200).end();

    const from = message.from;

    // Botón pulsado
    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      const buttonId = message.interactive.button_reply.id;
      console.log(`Botón: ${buttonId} de ${from}`);
      await handleButton(from, buttonId);
    } else {
      // Texto libre
      const text = message.text?.body?.trim() || '';
      console.log(`Texto: "${text}" de ${from}`);
      await handleText(from, text);
    }

  } catch (error) {
    console.error('Error:', error);
  }

  res.status(200).end();
});

// ============================================================
// TEXTO RECIBIDO
// ============================================================
async function handleText(phone, text) {
  // Buscar conductor por teléfono
  const conductor = await callAppsScript('buscar_conductor', { telefono: phone });

  if (!conductor || !conductor.encontrado) {
    await sendText(phone, '❌ No estás autorizado. Tu número no está en la base de datos.');
    return;
  }

  const nombre = conductor.nombre;

  // Ver si el texto es una matrícula (6-7 caracteres alfanuméricos)
  const matriculaRegex = /^[A-Za-z0-9]{4,8}$/;
  
  if (matriculaRegex.test(text)) {
    const matricula = text.toUpperCase();
    console.log(`${nombre} busca matrícula: ${matricula}`);

    // Buscar en Mapon
  const resultado = await buscarEnMapon(matricula);

    if (!resultado || !resultado.encontrado) {
      await sendText(phone, `❌ Matrícula "${matricula}" no encontrada en Mapon.\n\nIndica otra matrícula (ej: 1234ABC):`);
      return;
    }

    // Guardar sesión
    sesiones[phone] = {
      nombre,
      matricula,
      unitId: resultado.unit_id,
      vehiculo: resultado.vehiculo
    };

    // Mostrar botones (puerta cerrada por defecto)
    await sendButtonsEstado(phone, nombre, matricula, resultado.vehiculo, 'cerrada');

  } else {
    // No es matrícula, pedirla
    if (sesiones[phone]) {
      // Ya tiene sesión, mostrar botones
      const s = sesiones[phone];
      await sendButtonsEstado(phone, s.nombre, s.matricula, s.vehiculo, 'cerrada');
    } else {
      // Primera vez
      await sendText(phone, `👋 Hola ${nombre}, indica la matrícula del vehículo que quieres abrir/cerrar.\n\nEjemplo: 1888LTJ`);
    }
  }
}

// ============================================================
// BOTÓN PULSADO
// ============================================================
async function handleButton(phone, buttonId) {
  const sesion = sesiones[phone];
  
  if (!sesion) {
    await sendText(phone, '⚠️ Primero indica una matrícula (ej: 1888LTJ).');
    return;
  }

  if (buttonId === 'abrir_puertas') {
    console.log(`🔓 Abriendo: ${sesion.vehiculo} (${sesion.matricula})`);

    const result = await callAppsScript('ejecutar_comando', {
      matricula: sesion.matricula,
      comando: 'open_doors'
    });

    if (result.status === 'ok') {
      await sendButtonsEstado(phone, sesion.nombre, sesion.matricula, sesion.vehiculo, 'abierta');
    } else {
      await sendText(phone, '❌ Error al abrir puertas. Inténtalo de nuevo.');
    }

  } else if (buttonId === 'cerrar_puertas') {
    console.log(`🔒 Cerrando: ${sesion.vehiculo} (${sesion.matricula})`);

    const result = await callAppsScript('ejecutar_comando', {
      matricula: sesion.matricula,
      comando: 'close_doors'
    });

    if (result.status === 'ok') {
      await sendButtonsEstado(phone, sesion.nombre, sesion.matricula, sesion.vehiculo, 'cerrada');
    } else {
      await sendText(phone, '❌ Error al cerrar puertas. Inténtalo de nuevo.');
    }

  } else if (buttonId === 'cambiar_matricula') {
    delete sesiones[phone];
    await sendText(phone, '🔄 Indica la nueva matrícula (ej: 1888LTJ):');
  }
}

// ============================================================
// ENVIAR BOTONES SEGÚN ESTADO
// ============================================================
async function sendButtonsEstado(to, nombre, matricula, vehiculo, estado) {
  const puertaAbierta = estado === 'abierta';
  const emoji = puertaAbierta ? '🔓' : '🔒';
  const textoEstado = puertaAbierta ? 'PUERTA ABIERTA' : 'PUERTA CERRADA';
  const botonAccion = puertaAbierta ? 'cerrar_puertas' : 'abrir_puertas';
  const botonTexto = puertaAbierta ? '🔒 Cerrar puertas' : '🔓 Abrir puertas';

  const url = `https://graph.facebook.com/${WHATSAPP_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `🚗 ${nombre}\n🚘 ${vehiculo} (${matricula})\n${emoji} ${textoEstado}`
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: { id: botonAccion, title: botonTexto }
          },
          {
            type: 'reply',
            reply: { id: 'cambiar_matricula', title: '🔄 Cambiar matrícula' }
          }
        ]
      }
    }
  };

  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  console.log(`📱 Botones enviados a ${nombre}: ${textoEstado}`);
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
// LLAMAR A APPS SCRIPT
// ============================================================
async function callAppsScript(accion, params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('accion', accion);
  Object.keys(params).forEach(key => url.searchParams.set(key, params[key]));

  console.log(`📞 Apps Script: ${accion}`, params);
  const response = await fetch(url.toString());
  return await response.json();
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
    
    // Mostrar matrículas similares para debug
    const similares = units
      .filter(u => (u.number || '').replace(/\s/g, '').toUpperCase().includes(matriculaLimpia.substring(0, 4)))
      .slice(0, 5)
      .map(u => u.number);
    
    console.log(`❌ No encontrado. Similares: ${similares.join(', ')}`);
    
    return {
      encontrado: false,
      similares
    };
    
  } catch (error) {
    console.error('Error buscando en Mapon:', error);
    return { encontrado: false, error: error.message };
  }
}

module.exports = router;