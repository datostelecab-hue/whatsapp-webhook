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

// ── SEGUNDA FASE (db/186) ────────────────────────────────────────────────────

// LOS ADJUNTOS. Meta guarda 30 días lo que mandan; se baja al llegar y se guarda
// hasta este tamaño. Lo que pase se pide a Meta al abrirlo, mientras lo tenga.
const MAX_ADJUNTO = (Number(process.env.WHATSAPP_ADJUNTO_MAX_MB) || 16) * 1024 * 1024;
const CON_ADJUNTO = new Set(['imagen', 'video', 'audio', 'documento', 'sticker']);

const mimeBase = m => String(m || '').toLowerCase().split(';')[0].trim();

/**
 * ¿SE ENSEÑA EN LA PÁGINA O SOLO SE DESCARGA? Solo fotos, audio y vídeo. Un
 * documento puede ser un HTML o un SVG, y abierto desde nuestro dominio
 * ejecutaría lo que lleve dentro con la sesión de quien lo abre: va siempre como
 * descarga.
 */
function adjuntoEnLinea(mime) {
  return /^(image\/(jpeg|png|webp|gif)|audio\/[a-z0-9.+-]+|video\/(mp4|3gpp|webm|quicktime))$/.test(mimeBase(mime));
}

const EXTENSION = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'text/plain': 'txt',
};
const NOMBRE_TIPO = { imagen: 'Foto', video: 'Vídeo', audio: 'Audio', documento: 'Documento', sticker: 'Sticker' };

/** El nombre con que se descarga: el del documento, o «WhatsApp Foto 123.jpg». */
function nombreAdjunto({ nombre, mime, tipo, id }) {
  const limpio = String(nombre || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  if (limpio) return limpio;
  const m = mimeBase(mime);
  const ext = EXTENSION[m] || (m.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  return `WhatsApp ${NOMBRE_TIPO[tipo] || 'Adjunto'} ${id}.${ext}`;
}

/** La cabecera Content-Disposition, con el nombre también en UTF-8 (tildes y eñes). */
function disposicion(nombre, enLinea) {
  const ascii = String(nombre || 'adjunto').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]|"/g, '_');
  return `${enLinea ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre || 'adjunto')}`;
}

// LAS PLANTILLAS. Fuera de la ventana de 24 h solo se puede escribir con una
// plantilla aprobada, y se paga. Desde el chat se mandan las que solo piden
// TEXTO en el cuerpo: las que llevan una foto en la cabecera o un botón con un
// enlace variable piden datos que aquí no hay de dónde sacar.
const VARIABLE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MAX_CUERPO = 1024;

/** Una plantilla tal como la da Meta → lo que necesita el chat. */
function plantillaDeMeta(t) {
  const x = t || {};
  const comps = x.components || [];
  const de = tipo => comps.find(c => String(c.type || '').toUpperCase() === tipo) || null;
  const cuerpoC = de('BODY'), cab = de('HEADER'), pie = de('FOOTER'), bots = de('BUTTONS');
  const cuerpo = (cuerpoC && cuerpoC.text) || '';
  const vistas = [];
  cuerpo.replace(VARIABLE, (_, v) => { if (!vistas.includes(v)) vistas.push(v); return _; });
  const nombrado = String(x.parameter_format || '').toUpperCase() === 'NAMED' || vistas.some(v => !/^\d+$/.test(v));
  const variables = nombrado ? vistas : vistas.slice().sort((a, b) => Number(a) - Number(b));
  const botones = ((bots && bots.buttons) || []);
  let motivo = null;
  if (String(x.status || '').toUpperCase() !== 'APPROVED') motivo = 'Meta todavía no la ha aprobado';
  else if (cab && (String(cab.format || 'TEXT').toUpperCase() !== 'TEXT' || /{{[^{}]+}}/.test(cab.text || ''))) motivo = 'Lleva en la cabecera una foto, un documento o una variable';
  else if (botones.some(b => !['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(String(b.type || '').toUpperCase()) || /\{\{/.test(b.url || ''))) motivo = 'Lleva un botón que pide datos';
  return {
    nombre: x.name || '', idioma: x.language || '', categoria: String(x.category || '').toUpperCase(),
    formato: nombrado ? 'nombrado' : 'posicional', cuerpo,
    cabecera: (cab && String(cab.format || 'TEXT').toUpperCase() === 'TEXT' && cab.text) || '',
    pie: (pie && pie.text) || '', botones: botones.map(b => b.text || ''),
    variables, usable: !motivo, motivo,
  };
}

// Meta no admite en un parámetro saltos de línea, tabuladores ni más de cuatro
// espacios seguidos (error 132018): se aplanan.
const aplanar = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** El cuerpo con los valores puestos, como lo va a leer la persona. */
function rellenarPlantilla(cuerpo, valores = {}) {
  return String(cuerpo || '').replace(VARIABLE, (m, v) => {
    const x = aplanar(valores[v]);
    return x ? x : m;
  });
}

/** Comprueba los valores; lanza con lo que falta. Devuelve los valores aplanados. */
function validarValores(p, valores = {}) {
  const out = {};
  for (const v of p.variables) {
    const x = aplanar(valores[v]);
    if (!x) throw new Error(`Rellena {{${v}}}.`);
    out[v] = x;
  }
  if (rellenarPlantilla(p.cuerpo, out).length > MAX_CUERPO) throw new Error(`El mensaje pasa de ${MAX_CUERPO} caracteres: acorta lo que has puesto.`);
  return out;
}

/** Los parámetros del cuerpo para Meta, por nombre o por posición. */
function parametrosDePlantilla(p, valores = {}) {
  return p.variables.map(v => (p.formato === 'nombrado'
    ? { type: 'text', parameter_name: v, text: aplanar(valores[v]) }
    : { type: 'text', text: aplanar(valores[v]) }));
}

// EL NOMBRE DE PILA, para el saludo de una plantilla o de una respuesta rápida.
// La ficha lo trae en mayúsculas («ANDRÉS JOSÉ GARRIDO»): «Andrés».
function primerNombre(nombre) {
  const p = String(nombre || '').replace(/^\+?\d[\d\s]*$/, '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

/** Lo que se le propone a una variable: el nombre de pila a la de «nombre» o a la primera. */
function valorSugerido(variable, nombre) {
  return /nombre|name/i.test(String(variable)) || String(variable) === '1' ? primerNombre(nombre) : '';
}

// LAS RESPUESTAS RÁPIDAS: {nombre} es el nombre de pila de la persona.
function respuestaPara(texto, nombre) {
  return String(texto || '')
    .replace(/\{nombre\}/gi, primerNombre(nombre))
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Una respuesta rápida, limpia; lanza si no vale. */
function validarRespuesta({ titulo, texto } = {}) {
  const t = String(titulo == null ? '' : titulo).replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('Ponle un título corto, para encontrarla.');
  if (t.length > 60) throw new Error('El título es demasiado largo (máximo 60 caracteres).');
  return { titulo: t, texto: textoDeOficina(texto) };
}

module.exports = {
  VENTANA_MS, PAUSA_MIN, MAX_TEXTO, soloDigitos,
  describirEntrante, describirSaliente, resumen, ventana, botAtiende, textoDeOficina,
  MAX_ADJUNTO, CON_ADJUNTO, adjuntoEnLinea, nombreAdjunto, disposicion,
  MAX_CUERPO, plantillaDeMeta, rellenarPlantilla, validarValores, parametrosDePlantilla,
  primerNombre, valorSugerido, respuestaPara, validarRespuesta,
};
