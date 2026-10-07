// ============================================================
// EL CHAT DE WHATSAPP — las reglas, sin base de datos
// ============================================================
// Lo puro del módulo /whatsapp (db/185): qué es cada mensaje que entra o sale
// (para guardarlo legible), cuándo se le puede escribir gratis a alguien (la
// ventana de 24 h) y cuándo atiende el bot. Lo usan el webhook
// (routes/botPuertas.js), el servicio de envíos (services/whatsapp.js) y el
// módulo; se comprueba con scripts/comprobar-whatsapp-chat.js.

// LA VENTANA DE 24 H. Meta deja escribir texto libre, gratis, durante las 24 h
// siguientes al último mensaje de la persona (cualquiera: un texto, un botón).
// Fuera de ella solo se puede mandar una plantilla aprobada, y esas se pagan.
const VENTANA_MS = 24 * 3600 * 1000;

// LA PAUSA DEL BOT. Cuando la oficina escribe a alguien, lo que esa persona
// conteste no lo atiende el bot (un «vale» lo tomaría por el saludo y le
// mandaría los botones): solo se guarda en el chat. La pausa se alarga con cada
// mensaje de la oficina y se levanta sola pasados estos minutos, o a mano con
// «Devolver al bot».
const PAUSA_MIN = Number(process.env.WHATSAPP_PAUSA_BOT_MIN) || 30;

// Lo más largo que admite Meta en un texto.
const MAX_TEXTO = 4096;

const soloDigitos = t => String(t == null ? '' : t).replace(/\D/g, '');

/** Un mensaje que llega al webhook (value.messages[i]) → { tipo, texto, detalle }. */
function describirEntrante(m) {
  const x = m || {};
  switch (x.type) {
    case 'text':
      return { tipo: 'texto', texto: (x.text && x.text.body) || '', detalle: null };
    case 'interactive': {
      const r = (x.interactive && (x.interactive.button_reply || x.interactive.list_reply)) || {};
      return { tipo: 'boton', texto: r.title || r.id || '', detalle: { id: r.id || null } };
    }
    case 'button':
      // El botón de una PLANTILLA (respuesta rápida).
      return { tipo: 'boton', texto: (x.button && (x.button.text || x.button.payload)) || '', detalle: { payload: (x.button && x.button.payload) || null } };
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': {
      const a = x[x.type] || {};
      const TIPO = { image: 'imagen', video: 'video', audio: 'audio', document: 'documento', sticker: 'sticker' };
      return {
        tipo: TIPO[x.type], texto: a.caption || (x.type === 'document' ? a.filename || '' : ''),
        detalle: { media_id: a.id || null, mime: a.mime_type || null, ...(a.filename ? { nombre: a.filename } : {}), ...(a.voice ? { voz: true } : {}) },
      };
    }
    case 'location': {
      const l = x.location || {};
      return { tipo: 'ubicacion', texto: [l.name, l.address].filter(Boolean).join(' · '), detalle: { lat: l.latitude, lng: l.longitude } };
    }
    case 'contacts':
      return { tipo: 'contacto', texto: (x.contacts || []).map(c => (c.name && c.name.formatted_name) || '').filter(Boolean).join(', '), detalle: null };
    case 'reaction':
      return { tipo: 'reaccion', texto: (x.reaction && x.reaction.emoji) || '', detalle: { a: (x.reaction && x.reaction.message_id) || null } };
    default:
      return { tipo: 'otro', texto: '', detalle: { type: x.type || null } };
  }
}

/** Lo que se manda a Meta (el `payload` de /messages) → { tipo, texto, detalle }. */
function describirSaliente(p) {
  const x = p || {};
  if (x.type === 'text') return { tipo: 'texto', texto: (x.text && x.text.body) || '', detalle: null };
  if (x.type === 'interactive') {
    const i = x.interactive || {};
    const botones = ((i.action && i.action.buttons) || []).map(b => (b.reply && b.reply.title) || '');
    return { tipo: 'botones', texto: (i.body && i.body.text) || '', detalle: { botones } };
  }
  if (x.type === 'template') {
    const t = x.template || {};
    const parametros = (t.components || []).filter(c => c.type === 'body')
      .flatMap(c => (c.parameters || []).map(pp => (pp.text == null ? '' : String(pp.text))));
    return {
      tipo: 'plantilla',
      texto: `Plantilla «${t.name || '?'}»${parametros.length ? ': ' + parametros.join(' · ') : ''}`,
      detalle: { plantilla: t.name || null, idioma: (t.language && t.language.code) || null, parametros },
    };
  }
  return { tipo: 'otro', texto: '', detalle: { type: x.type || null } };
}

/** El texto corto de la lista de conversaciones. */
function resumen({ tipo, texto }) {
  const NOMBRE = { imagen: 'Foto', video: 'Vídeo', audio: 'Audio', documento: 'Documento', sticker: 'Sticker', ubicacion: 'Ubicación', contacto: 'Contacto', reaccion: 'Reacción' };
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (NOMBRE[tipo]) return t ? `${NOMBRE[tipo]}: ${t}` : NOMBRE[tipo];
  return t || (tipo === 'otro' ? 'Mensaje' : '');
}

/** ¿Se le puede escribir gratis? { abierta, cierraAt } (ms), desde su último mensaje. */
function ventana(ultimaEntranteAt, ahora = Date.now()) {
  const t = ultimaEntranteAt ? new Date(ultimaEntranteAt).getTime() : NaN;
  if (!Number.isFinite(t)) return { abierta: false, cierraAt: null };
  const cierraAt = t + VENTANA_MS;
  return { abierta: ahora < cierraAt, cierraAt };
}

/**
 * ¿ATIENDE EL BOT ESTE MENSAJE? Sí, salvo que la oficina esté hablando con esa
 * persona (pausa vigente). Aun en pausa, los BOTONES los atiende siempre: son
 * los del turno (abrir, terminar, entregar el coche…), y nadie se puede quedar
 * sin abrir su turno por estar en una conversación con la oficina.
 */
function botAtiende(tipoMeta, pausadoHasta, ahora = Date.now()) {
  const hasta = pausadoHasta ? new Date(pausadoHasta).getTime() : NaN;
  if (!Number.isFinite(hasta) || hasta <= ahora) return true;
  return tipoMeta === 'interactive' || tipoMeta === 'button';
}

/** El texto que escribe la oficina, limpio; lanza si no vale. */
function textoDeOficina(texto) {
  const t = String(texto == null ? '' : texto).replace(/\r\n/g, '\n').trim();
  if (!t) throw new Error('Escribe el mensaje.');
  if (t.length > MAX_TEXTO) throw new Error(`El mensaje es demasiado largo (máximo ${MAX_TEXTO} caracteres).`);
  return t;
}

module.exports = {
  VENTANA_MS, PAUSA_MIN, MAX_TEXTO, soloDigitos,
  describirEntrante, describirSaliente, resumen, ventana, botAtiende, textoDeOficina,
};
