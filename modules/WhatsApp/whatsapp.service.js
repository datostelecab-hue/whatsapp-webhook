// ============================================================
// WHATSAPP · SERVICIO — el chat del número del bot
// ============================================================
// Camilo, 07/10/2026: un módulo «WhatsApp» para ver qué les manda el bot a los
// conductores y qué escriben ellos, y escribirles desde aquí cuando se pueda
// gratis (la ventana de 24 h desde su último mensaje).
//
// Las reglas puras viven en services/whatsappChat.js (la ventana, la pausa del
// bot); los datos, en services/repo/whatsappChat.js (db/185); el envío, en
// services/whatsapp.js, que apunta cada mensaje en el chat con su origen.

const chat = require('../../services/repo/whatsappChat');
const W = require('../../services/whatsappChat');
const whatsapp = require('../../services/whatsapp');

const QUE = { conductor: 'Conductor', usuario: 'Usuario del ERP', bolt: 'Cuenta de BOLT', bolt_barcelona: 'BOLT Barcelona' };
const faltaMigracion = e => !!e && e.code === '42P01';

/** Sin db/185 la pantalla lo dice en vez de dar un error. */
async function conTablas(fn) {
  try {
    return await fn();
  } catch (e) {
    if (faltaMigracion(e)) return { faltaMigracion: true };
    throw e;
  }
}

/** Quién es, la ventana y la pausa, como los pinta la pantalla. */
function cabecera(c, ahora = Date.now()) {
  const pausa = c.bot_pausado_hasta && new Date(c.bot_pausado_hasta).getTime() > ahora ? c.bot_pausado_hasta : null;
  return {
    telefono: c.telefono,
    nombre: c.nombre || c.nombre_perfil || `+${c.telefono}`,
    que: c.nombre ? (QUE[c.que] || '') : (c.nombre_perfil ? 'Nombre en WhatsApp' : 'Sin identificar'),
    perfil: c.nombre && c.nombre_perfil && c.nombre_perfil !== c.nombre ? c.nombre_perfil : null,
    conductorId: c.conductor_id || null,
    ventana: W.ventana(c.ultima_entrante_at, ahora),
    botPausadoHasta: pausa,
    pausadoPor: pausa ? (c.pausado_por || null) : null,
  };
}

/** La lista de conversaciones, la más reciente primero. */
function conversaciones({ buscar } = {}) {
  return conTablas(async () => {
    const filas = await chat.conversaciones({ buscar });
    return {
      conversaciones: filas.map(c => ({
        ...cabecera(c),
        ultimoAt: c.ultimo_at, ultimoTexto: c.ultimo_texto, ultimoSentido: c.ultimo_sentido, sinLeer: c.sin_leer,
      })),
      pausaMin: W.PAUSA_MIN,
    };
  });
}

/**
 * Una conversación: su cabecera y sus mensajes. Abrirla la da por LEÍDA (es lo
 * que hace cualquier chat). `despuesDe` trae solo lo nuevo, para el refresco.
 */
function abrir(telefono, { despuesDe, antesDe } = {}) {
  return conTablas(async () => {
    const tel = W.soloDigitos(telefono);
    if (!tel) throw new Error('Falta el teléfono.');
    const c = await chat.chat(tel);
    if (!c) throw new Error('No hay ninguna conversación con ese teléfono.');
    const num = v => (v != null && /^\d+$/.test(String(v)) ? Number(v) : null);
    const mensajes = await chat.mensajes(tel, { despuesDe: num(despuesDe), antesDe: num(antesDe) });
    await chat.marcarLeido(tel);
    return { chat: cabecera(c), mensajes, pausaMin: W.PAUSA_MIN };
  });
}

/**
 * ESCRIBIR A ALGUIEN desde la oficina. Solo con la ventana abierta (gratis); y el
 * bot se pausa con esa persona para que lo que conteste llegue aquí y no al bot.
 */
async function enviar({ telefono, texto } = {}, usuarioId) {
  const tel = W.soloDigitos(telefono);
  const c = tel ? await chat.chat(tel) : null;
  if (!c) throw new Error('No hay ninguna conversación con ese teléfono.');
  if (!W.ventana(c.ultima_entrante_at).abierta) {
    throw new Error('La ventana de 24 h está cerrada: solo se le puede escribir cuando haya mandado algo en las últimas 24 horas.');
  }
  const t = W.textoDeOficina(texto);
  const r = await whatsapp.enviarTexto(tel, t, { origen: 'oficina', usuarioId });
  if (!r.ok) throw new Error(`WhatsApp no lo ha aceptado: ${r.error}`);
  await chat.pausar(tel, W.PAUSA_MIN, usuarioId);
  console.log(`💬 [WhatsApp] La oficina (usuario ${usuarioId || '?'}) escribe a ${tel}; el bot, en pausa ${W.PAUSA_MIN} min`);
  return { enviado: true };
}

/** Pausar el bot con alguien, o devolverle la conversación. */
async function bot({ telefono, pausar } = {}, usuarioId) {
  const tel = W.soloDigitos(telefono);
  if (!tel || !(await chat.chat(tel))) throw new Error('No hay ninguna conversación con ese teléfono.');
  if (pausar) await chat.pausar(tel, W.PAUSA_MIN, usuarioId);
  else await chat.reanudar(tel);
  return { pausado: !!pausar };
}

module.exports = { conversaciones, abrir, enviar, bot, cabecera };
