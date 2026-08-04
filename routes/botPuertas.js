const express = require('express');
const router = express.Router();

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzPJUuuWtrR-r_kV3ADry2FyTFQAvGmW94wsYO5MohqTFLOQ1YTusKOdjOjLa5ggv50/exec';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = '1256923474160518';
const WHATSAPP_VERSION = 'v25.0';
const MAPON_API_KEY = process.env.MAPON_API_KEY || '';

const sesiones = {};

// Instructivo de repostaje (combustible) que acompaña al PIN de Ballenoil.
const INSTRUCTIVO_REPOSTAJE =
`⛽ *Cómo repostar*
1️⃣ En el surtidor selecciona *DNI&Go*.
2️⃣ Introduce tu *DNI/NIE* y tu PIN.
3️⃣ Indica el *kilometraje exacto* y la *matrícula* del vehículo.
4️⃣ Selecciona *Gasolina 95 (verde)*.
5️⃣ El sistema autorizará hasta *50 €* de combustible.

⚠️ Es *obligatorio* introducir bien el kilometraje y la matrícula; un dato incorrecto puede acarrear sanción.
🚗 Al terminar el turno, entrega el vehículo con el *depósito lleno*.`;

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

  res.status(200).end();
});

// ============================================================
// TEXTO RECIBIDO
// ============================================================
async function handleText(phone, text) {
  const conductor = await callAppsScript('buscar_conductor', { telefono: phone });

  if (!conductor || !conductor.encontrado) {
    await sendText(phone, '❌ No estás autorizado. Tu número no está en la base de datos.');
    return;
  }

  const nombre = conductor.nombre;

  // Palabra clave para pedir el PIN de repostaje (además del botón de la plantilla).
  if (/^(ver\s+)?pin(\s+ballenoil)?$|^ballenoil$/i.test(text.trim())) {
    await enviarPinBallenoil(phone);
    return;
  }

  // Palabra clave para ver los turnos/relevos de la semana (además del botón).
  if (/^(ver\s+)?(mis\s+)?turnos?$|^relevos?$/i.test(text.trim())) {
    await enviarTurnos(phone, nombre);
    return;
  }

  const matriculaRegex = /^[A-Za-z0-9]{4,8}$/;
  
  if (matriculaRegex.test(text)) {
    const matricula = text.toUpperCase();
    console.log(`${nombre} busca matrícula: ${matricula}`);

    const resultado = await buscarEnMapon(matricula);
    console.log(`📋 Resultado Mapon:`, JSON.stringify(resultado));

    if (!resultado || !resultado.encontrado) {
      await sendText(phone, `❌ Matrícula "${matricula}" no encontrada en Mapon.\n\nIndica otra matrícula (ej: 1234ABC):`);
      return;
    }

    sesiones[phone] = {
      nombre,
      matricula: resultado.matricula,
      unitId: resultado.unit_id,
      vehiculo: resultado.vehiculo,
      estado: 'cerrada'
    };

    await sendButtonsEstado(phone, nombre, resultado.matricula, resultado.vehiculo, 'cerrada');

  } else {
    if (sesiones[phone]) {
      const s = sesiones[phone];
      await sendButtonsEstado(phone, s.nombre, s.matricula, s.vehiculo, s.estado || 'cerrada');
    } else {
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
      sesion.estado = 'abierta';
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
      sesion.estado = 'cerrada';
      await sendButtonsEstado(phone, sesion.nombre, sesion.matricula, sesion.vehiculo, 'cerrada');
    } else {
      await sendText(phone, '❌ Error al cerrar puertas. Inténtalo de nuevo.');
    }

  } else if (buttonId === 'cambiar_matricula') {
    delete sesiones[phone];
    await sendText(phone, '🔄 Indica la nueva matrícula (ej: 1888LTJ):');

  } else if (buttonId === 'codigo_lavado') {
    console.log(`💧 Código de lavado solicitado por ${phone}`);
    const codigos = require('../services/codigosBallenoil');
    // ID_BOLT = nombre tal como sale en BOLT (del padrón por teléfono); si no, el de la sesión.
    let idBolt = sesion.nombre || '';
    try {
      const c = await require('../services/conductoresBolt').buscarPorTelefono(phone);
      if (c && (c.nombre || '').trim()) idBolt = c.nombre.trim();
    } catch (e) { console.error('⚠️ [Ballenoil] buscarPorTelefono:', e.message); }

    let r = null;
    try { r = await codigos.solicitarCodigo({ telefono: phone, idBolt }); }
    catch (e) { console.error('❌ [Ballenoil] solicitarCodigo:', e.message); }

    if (r && r.codigo) {
      await sendText(phone, `💧 *Código de lavado Ballenoil*\n\nTu código: *${r.codigo}*${r.fecha_vencimiento ? `\nVálido hasta: ${r.fecha_vencimiento}` : ''}\n\n${codigos.INSTRUCTIVO}\n\n_Este código es de un solo uso; no lo compartas._`);
    } else {
      await sendText(phone, '😕 Ahora mismo no hay códigos de lavado disponibles. Avisa a la oficina, por favor.');
    }
    // Re-muestra el menú para que pueda seguir operando.
    await sendButtonsEstado(phone, sesion.nombre, sesion.matricula, sesion.vehiculo, sesion.estado || 'cerrada');

  } else if (buttonId === 'ver_turnos') {
    console.log(`📅 Turnos solicitados por ${phone}`);
    await enviarTurnos(phone, sesion.nombre);
    await sendButtonsEstado(phone, sesion.nombre, sesion.matricula, sesion.vehiculo, sesion.estado || 'cerrada');
  }
}

// Envía al conductor sus turnos/relevos de la semana (texto libre). Resuelve su
// ID_BOLT por teléfono y compone el mensaje desde el tablero del planificador.
async function enviarTurnos(phone, nombreSesion) {
  let idBolt = (nombreSesion || '').trim();
  try {
    const c = await require('../services/conductoresBolt').buscarPorTelefono(phone);
    if (c && (c.nombre || '').trim()) idBolt = c.nombre.trim();
  } catch (e) { console.error('⚠️ [Turnos] buscarPorTelefono:', e.message); }

  try {
    const planif = require('../services/planificadorV2');
    const { instruccionesPorConductor, mensajeTurnos } = require('../services/turnosConductor');
    const tablero = await planif.leerTablero();
    const norm = s => String(s || '').trim().toLowerCase();
    const entrada = instruccionesPorConductor(tablero).find(e => norm(e.id) === norm(idBolt));
    await sendText(phone, mensajeTurnos(entrada));
  } catch (e) {
    console.error('❌ [Turnos] enviarTurnos:', e.message);
    await sendText(phone, 'No pude cargar tus turnos ahora mismo. Inténtalo en un momento, por favor.');
  }
}

// Botón de una PLANTILLA (quick reply). El de la bienvenida de Ballenoil pide el PIN.
async function handleTemplateButton(phone, label) {
  const l = (label || '').toUpperCase();
  if (l.includes('PIN') || l.includes('BALLENOIL')) {
    await enviarPinBallenoil(phone);
  } else {
    await handleText(phone, '');   // etiqueta desconocida → saludo/menú normal
  }
}

// Entrega al conductor su PIN de repostaje (de su ficha) + el instructivo. Va en texto
// libre porque su pulsación/mensaje abre la ventana de 24 h (no hace falta plantilla).
async function enviarPinBallenoil(phone) {
  const tel = String(phone).replace(/\D/g, '').slice(-9);
  let t = null;
  try { t = await require('../services/tickets').leerTicket(tel); }
  catch (e) { console.error('❌ [Ballenoil PIN] leerTicket:', e.message); }
  const pin = (t && (t.pin_ballenoil || '')).toString().trim();
  const nombre = (t && ((t.id_bolt || '').trim() || `${t.nombre || ''} ${t.apellidos || ''}`.trim())) || '';
  if (pin) {
    await sendText(phone, `${nombre ? 'Hola ' + nombre + '. ' : ''}🔑 Tu *PIN de repostaje Ballenoil* es *${pin}*.\nEs personal e intransferible.\n\n${INSTRUCTIVO_REPOSTAJE}`);
  } else {
    await sendText(phone, '🔑 Todavía no tengo tu PIN de repostaje registrado. Contacta con tráfico para que te lo generen.');
  }
}

async function sendButtonsEstado(to, nombre, matricula, vehiculo, estado) {
  const puertaAbierta = estado === 'abierta';
  const emoji = puertaAbierta ? '🔓' : '🔒';
  const textoEstado = puertaAbierta ? 'PUERTA ABIERTA' : 'PUERTA CERRADA';

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
            reply: { id: 'abrir_puertas', title: '🔓 Abrir' }
          },
          {
            type: 'reply',
            reply: { id: 'cerrar_puertas', title: '🔒 Cerrar' }
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

  // Segundo mensaje con las opciones extra (WhatsApp permite hasta 3 botones por mensaje).
  const payload2 = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `🔧 Otras opciones`
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: { id: 'ver_turnos', title: '📅 Ver mis turnos' }
          },
          {
            type: 'reply',
            reply: { id: 'codigo_lavado', title: '💧 Código lavado' }
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
    body: JSON.stringify(payload2)
  });

  console.log(`📱 Botones enviados: ${textoEstado}`);
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
  const texto = await response.text();
  try {
    return JSON.parse(texto);
  } catch (_) {
    // El Apps Script devolvió HTML (normalmente una excepción no controlada dentro
    // de la acción → Google sirve su página de error). No reventamos: lo registramos
    // y devolvemos un error manejable para que el conductor reciba un aviso claro.
    console.error(`❌ Apps Script "${accion}" no devolvió JSON (HTTP ${response.status}). Inicio de la respuesta: ${texto.slice(0, 300).replace(/\s+/g, ' ')}`);
    return { status: 'error', msg: 'El servicio de comandos no respondió (revisa el Apps Script)', _sinJson: true };
  }
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