// ============================================================
// WHATSAPP · SERVICIO — el chat del número del bot
// ============================================================
// Camilo, 07/10/2026: un módulo «WhatsApp» para ver qué les manda el bot a los
// conductores y qué escriben ellos, y escribirles desde aquí cuando se pueda
// gratis (la ventana de 24 h desde su último mensaje).
//
// Segunda fase (db/186): las fotos, audios y documentos que mandan; plantillas
// (de pago) para escribir con la ventana cerrada, también a quien nunca ha
// escrito; respuestas rápidas; quién lleva cada conversación; y las llamadas del
// Call Center en la misma línea de tiempo.
//
// Las reglas puras viven en services/whatsappChat.js (la ventana, la pausa del
// bot, las plantillas); los datos, en services/repo/whatsappChat.js; el envío y
// la descarga, en services/whatsapp.js, que apunta cada mensaje en el chat.

const chat = require('../../services/repo/whatsappChat');
const W = require('../../services/whatsappChat');
const whatsapp = require('../../services/whatsapp');

const QUE = { conductor: 'Conductor', usuario: 'Usuario del ERP', bolt: 'Cuenta de BOLT', bolt_barcelona: 'BOLT Barcelona' };

// Sin db/185 no hay chat; sin db/186 no hay adjuntos, asignación ni respuestas
// rápidas. La pantalla lo dice en vez de dar un error.
const tablaQueFalta = e => {
  if (!e) return null;
  if (e.code === '42P01') return /whatsapp_mensaje\b|whatsapp_chat\b/.test(e.message || '') ? 'db/185' : 'db/186';
  if (e.code === '42703') return 'db/186';
  return null;
};
async function conTablas(fn) {
  try {
    return await fn();
  } catch (e) {
    const falta = tablaQueFalta(e);
    if (falta) return { faltaMigracion: falta };
    throw e;
  }
}

/** Quién es, la ventana, la pausa y quién la lleva, como los pinta la pantalla. */
function cabecera(c, ahora = Date.now()) {
  const pausa = c.bot_pausado_hasta && new Date(c.bot_pausado_hasta).getTime() > ahora ? c.bot_pausado_hasta : null;
  return {
    telefono: c.telefono,
    existe: c.existe !== false,
    nombre: c.nombre || c.nombre_perfil || `+${c.telefono}`,
    que: c.nombre ? (QUE[c.que] || '') : (c.nombre_perfil ? 'Nombre en WhatsApp' : 'Sin identificar'),
    perfil: c.nombre && c.nombre_perfil && c.nombre_perfil !== c.nombre ? c.nombre_perfil : null,
    conductorId: c.conductor_id || null,
    ventana: W.ventana(c.ultima_entrante_at, ahora),
    botPausadoHasta: pausa,
    pausadoPor: pausa ? (c.pausado_por || null) : null,
    asignadoA: c.asignado_a ? Number(c.asignado_a) : null,
    asignado: c.asignado_a ? (c.asignado || null) : null,
  };
}

/** La lista de conversaciones, la más reciente primero. `filtro`: '', 'mias' o 'libres'. */
function conversaciones({ buscar, filtro } = {}, usuarioId) {
  return conTablas(async () => {
    const filas = await chat.conversaciones({ buscar, filtro, usuarioId });
    return {
      conversaciones: filas.map(c => ({
        ...cabecera(c),
        ultimoAt: c.ultimo_at, ultimoTexto: c.ultimo_texto, ultimoSentido: c.ultimo_sentido, sinLeer: c.sin_leer,
      })),
      pausaMin: W.PAUSA_MIN,
      yo: usuarioId ? Number(usuarioId) : null,
    };
  });
}

// ── EL CALL CENTER EN LA MISMA LÍNEA DE TIEMPO ──────────────────────────────
// Lo que se le ha dicho a un conductor no está solo en WhatsApp: Control y el
// Call Center lo llaman. Al abrir su conversación se ponen sus llamadas entre los
// mensajes, desde el primero que se ve (o las 10 últimas si no hay mensajes).
// Solo para quien entra en /callcenter: son sus datos.
const MAX_LLAMADAS = 40;
async function llamadasDe(conductorId, desdeMs) {
  if (!conductorId) return [];
  try {
    const h = await require('../Control/callcenter.service').historiaConductor(conductorId);
    const todas = (h.llamadas || []).map(l => ({
      ts: Number(l.ts) * 1000, fuente: l.fuente || '', agente: l.agente || '', direccion: l.direccion || '',
      motivo: l.motivo || '', resultado: l.resultado || '', notas: l.notas || l.resolucion || '',
    }));
    const dentro = desdeMs ? todas.filter(l => l.ts >= desdeMs) : todas.slice(0, 10);
    return dentro.slice(0, MAX_LLAMADAS).reverse();
  } catch (e) {
    console.warn('⚠️ [WhatsApp] No se pudieron leer las llamadas del Call Center:', e.message);
    return [];
  }
}

/**
 * Una conversación: su cabecera y sus mensajes. Abrirla la da por LEÍDA (es lo
 * que hace cualquier chat). `despuesDe` trae solo lo nuevo, para el refresco.
 * Se abre también la de alguien que nunca ha escrito, si se sabe quién es: para
 * mandarle una plantilla. Con `verLlamadas`, la primera carga trae además sus
 * llamadas del Call Center.
 */
function abrir(telefono, { despuesDe, antesDe, verLlamadas = false } = {}) {
  return conTablas(async () => {
    const tel = W.soloDigitos(telefono);
    if (!tel) throw new Error('Falta el teléfono.');
    const c = await chat.chat(tel);
    if (!c || (!c.existe && !c.nombre)) throw new Error('No hay ninguna conversación con ese teléfono.');
    const num = v => (v != null && /^\d+$/.test(String(v)) ? Number(v) : null);
    const mensajes = c.existe ? await chat.mensajes(tel, { despuesDe: num(despuesDe), antesDe: num(antesDe) }) : [];
    if (c.existe) await chat.marcarLeido(tel);
    const primeraCarga = num(despuesDe) == null && num(antesDe) == null;
    const llamadas = primeraCarga && verLlamadas && c.conductor_id
      ? await llamadasDe(c.conductor_id, mensajes.length ? new Date(mensajes[0].ocurrido_at).getTime() : null)
      : null;
    return { chat: cabecera(c), mensajes, llamadas, pausaMin: W.PAUSA_MIN };
  });
}

/** Lo que pasa después de que la oficina mande algo: pausa del bot y, si no la lleva nadie, para quien escribe. */
async function despuesDeEscribir(tel, usuarioId) {
  await chat.pausar(tel, W.PAUSA_MIN, usuarioId);
  try { await chat.asignarSiLibre(tel, usuarioId); } catch (e) { if (!tablaQueFalta(e)) throw e; }
}

/**
 * ESCRIBIR A ALGUIEN desde la oficina. Solo con la ventana abierta (gratis); y el
 * bot se pausa con esa persona para que lo que conteste llegue aquí y no al bot.
 */
async function enviar({ telefono, texto } = {}, usuarioId) {
  const tel = W.soloDigitos(telefono);
  const c = tel ? await chat.chat(tel) : null;
  if (!c || !c.existe) throw new Error('No hay ninguna conversación con ese teléfono.');
  if (!W.ventana(c.ultima_entrante_at).abierta) {
    throw new Error('La ventana de 24 h está cerrada: solo se le puede escribir cuando haya mandado algo en las últimas 24 horas. Fuera de ella, con una plantilla.');
  }
  const t = W.textoDeOficina(texto);
  const r = await whatsapp.enviarTexto(tel, t, { origen: 'oficina', usuarioId });
  if (!r.ok) throw new Error(`WhatsApp no lo ha aceptado: ${r.error}`);
  await despuesDeEscribir(tel, usuarioId);
  console.log(`💬 [WhatsApp] La oficina (usuario ${usuarioId || '?'}) escribe a ${tel}; el bot, en pausa ${W.PAUSA_MIN} min`);
  return { enviado: true };
}

/** Pausar el bot con alguien, o devolverle la conversación. */
async function bot({ telefono, pausar } = {}, usuarioId) {
  const tel = W.soloDigitos(telefono);
  const c = tel ? await chat.chat(tel) : null;
  if (!c || !c.existe) throw new Error('No hay ninguna conversación con ese teléfono.');
  if (pausar) await chat.pausar(tel, W.PAUSA_MIN, usuarioId);
  else await chat.reanudar(tel);
  return { pausado: !!pausar };
}

// ── LOS ADJUNTOS ─────────────────────────────────────────────────────────────

/**
 * BAJA Y GUARDA el fichero de un mensaje (al llegar, desde el webhook, sin
 * hacerle esperar). Meta solo lo guarda 30 días. Nunca lanza: devuelve qué pasó.
 */
async function bajarAdjunto(mensajeId, detalle = {}) {
  const d = detalle || {};
  if (!mensajeId || !d.media_id) return { ok: false, error: 'sin adjunto' };
  try {
    const r = await whatsapp.descargarMedia(d.media_id, { maxBytes: W.MAX_ADJUNTO });
    if (!r.ok) {
      if (!r.grande) console.warn(`⚠️ [WhatsApp] No se pudo bajar el adjunto del mensaje ${mensajeId}: ${r.error}`);
      return r;
    }
    await chat.guardarAdjunto(mensajeId, { mime: r.mime || d.mime, nombre: d.nombre || null, sha256: r.sha256, bytes: r.bytes });
    return { ok: true, tamano: r.tamano };
  } catch (e) {
    if (!tablaQueFalta(e)) console.error(`⚠️ [WhatsApp] No se pudo guardar el adjunto del mensaje ${mensajeId}:`, e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * El fichero de un mensaje para enseñarlo o descargarlo: el guardado o, si no
 * está (era grande o falló al llegar), el de Meta mientras lo tenga.
 */
async function adjunto(mensajeId) {
  const id = Number(mensajeId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el mensaje.');
  const m = await chat.adjunto(id);
  if (!m || !W.CON_ADJUNTO.has(m.tipo)) throw Object.assign(new Error('Ese mensaje no lleva ningún fichero.'), { status: 404 });
  const d = m.detalle || {};
  let bytes = m.bytes, mime = m.mime || d.mime;
  if (!bytes) {
    const r = await whatsapp.descargarMedia(d.media_id);
    if (!r.ok) {
      throw Object.assign(new Error(r.caducado
        ? 'Meta ya no lo guarda: solo lo tiene 30 días, y este no se llegó a guardar aquí.'
        : `No se pudo traer de WhatsApp: ${r.error}`), { status: r.caducado ? 410 : 502 });
    }
    bytes = r.bytes; mime = r.mime || mime;
    // Se queda aquí si cabe: la próxima vez ya no hay que pedírselo a Meta.
    if (r.tamano <= W.MAX_ADJUNTO) await chat.guardarAdjunto(id, { mime, nombre: d.nombre || null, sha256: r.sha256, bytes }).catch(() => {});
  }
  const enLinea = W.adjuntoEnLinea(mime);
  return {
    // Lo que no se enseña va como fichero sin tipo: aunque alguien abriera el
    // enlace a mano, el navegador no lo interpreta.
    bytes, mime: enLinea ? mime : 'application/octet-stream', enLinea,
    disposicion: W.disposicion(W.nombreAdjunto({ nombre: m.nombre || d.nombre, mime, tipo: m.tipo, id }), enLinea),
  };
}

// ── LAS PLANTILLAS ───────────────────────────────────────────────────────────
// La lista se pide a Meta y se recuerda unos minutos: cambia poco y pedirla en
// cada apertura sería lento.
const CACHE_PLANTILLAS_MS = 10 * 60 * 1000;
let cachePlantillas = null;

// Las que manda el propio sistema. Se pueden mandar a mano, pero se dice de qué
// son: un aviso de velocidad mandado por error confunde al conductor.
const DEL_SISTEMA = { advertencia_limite: 'avisos de velocidad', [whatsapp.PLANTILLA_TURNOS]: 'aviso de turnos' };

async function plantillasDeMeta() {
  if (cachePlantillas && Date.now() - cachePlantillas.ts < CACHE_PLANTILLAS_MS) return cachePlantillas.lista;
  const r = await whatsapp.plantillasCrudas();
  if (!r.ok) throw new Error(`No se pudo leer la lista de plantillas de WhatsApp: ${r.error}`);
  const lista = r.data.map(W.plantillaDeMeta)
    .map(p => ({ ...p, delSistema: DEL_SISTEMA[p.nombre] || (/^alerta/i.test(p.nombre) ? 'alertas de Control' : null) }))
    // Primero las que se pueden mandar, y entre ellas las de la oficina antes que las del sistema.
    .sort((a, b) => (a.usable === b.usable ? 0 : a.usable ? -1 : 1) || (!a.delSistema === !b.delSistema ? 0 : a.delSistema ? 1 : -1)
      || a.nombre.localeCompare(b.nombre));
  cachePlantillas = { ts: Date.now(), lista };
  return lista;
}

/** El nombre con que se le habla a alguien (el de su ficha, o el que tiene en WhatsApp). */
async function nombreDe(tel) {
  const c = tel ? await chat.chat(tel).catch(() => null) : null;
  return c ? (c.nombre || c.nombre_perfil || '') : '';
}

/**
 * Las plantillas aprobadas, primero las que se pueden mandar desde aquí. Con
 * `telefono`, cada una trae lo que se le propone a cada variable (su nombre
 * de pila a la del nombre).
 */
async function plantillas({ telefono } = {}) {
  const nombre = await nombreDe(W.soloDigitos(telefono));
  const lista = (await plantillasDeMeta()).filter(p => p.motivo !== 'Meta todavía no la ha aprobado')
    .map(p => ({ ...p, sugeridos: Object.fromEntries(p.variables.map(v => [v, W.valorSugerido(v, nombre)])) }));
  return { plantillas: lista };
}

/**
 * MANDAR UNA PLANTILLA: con la ventana cerrada es la única forma de escribirle, y
 * se paga. Vale también para alguien que nunca ha escrito (se sabe quién es por
 * su ficha). Después, como al escribir: el bot se pausa y la conversación es de
 * quien la manda si no la llevaba nadie.
 */
async function enviarPlantilla({ telefono, nombre, idioma, valores } = {}, usuarioId) {
  const tel = W.soloDigitos(telefono);
  const c = tel ? await chat.chat(tel) : null;
  if (!c || (!c.existe && !c.nombre)) throw new Error('No hay ninguna conversación con ese teléfono.');
  const p = (await plantillasDeMeta()).find(x => x.nombre === nombre && (!idioma || x.idioma === idioma));
  if (!p) throw new Error('Esa plantilla ya no está en WhatsApp: vuelve a elegirla.');
  if (!p.usable) throw new Error(`Esa plantilla no se puede mandar desde aquí: ${p.motivo}.`);
  const v = W.validarValores(p, valores || {});
  const r = await whatsapp.enviarPlantillaCuerpo(tel, p.nombre, W.parametrosDePlantilla(p, v),
    { origen: 'oficina', usuarioId, idioma: p.idioma, texto: W.rellenarPlantilla(p.cuerpo, v) });
  if (!r.ok) throw new Error(`WhatsApp no la ha aceptado: ${r.error}`);
  await despuesDeEscribir(tel, usuarioId);
  console.log(`📩 [WhatsApp] La oficina (usuario ${usuarioId || '?'}) manda la plantilla «${p.nombre}» a ${tel}`);
  return { enviado: true };
}

// ── QUIÉN LA LLEVA ───────────────────────────────────────────────────────────

/** A quién se le puede dar una conversación. */
async function asignables() {
  return { usuarios: (await chat.asignables()).map(u => ({ id: Number(u.id), nombre: u.nombre })) };
}

/** Darle la conversación a alguien (o a nadie, con `usuario` vacío). */
async function asignar({ telefono, usuario } = {}, porId) {
  const tel = W.soloDigitos(telefono);
  const c = tel ? await chat.chat(tel) : null;
  if (!c || !c.existe) throw new Error('Escríbele primero: la conversación todavía no existe.');
  const id = usuario == null || usuario === '' ? null : Number(usuario);
  if (id != null && !(await chat.asignables()).some(u => Number(u.id) === id)) {
    throw new Error('Esa persona no entra en WhatsApp: dale antes el permiso en Usuarios.');
  }
  await chat.asignar(tel, id, porId);
  return { asignadoA: id };
}

// ── LAS RESPUESTAS RÁPIDAS ───────────────────────────────────────────────────

/** Las respuestas rápidas; con `telefono`, cada una con {nombre} ya puesto (`listo`). */
function respuestas({ telefono } = {}) {
  return conTablas(async () => {
    const nombre = await nombreDe(W.soloDigitos(telefono));
    return { respuestas: (await chat.respuestas()).map(r => ({ ...r, id: Number(r.id), listo: W.respuestaPara(r.texto, nombre) })) };
  });
}

async function guardarRespuesta({ id, titulo, texto } = {}, usuarioId) {
  const r = W.validarRespuesta({ titulo, texto });
  if (id) {
    if (!(await chat.cambiarRespuesta(id, r))) throw new Error('Esa respuesta ya no existe.');
    return { id: Number(id) };
  }
  return { id: Number(await chat.crearRespuesta(r, usuarioId)) };
}

async function borrarRespuesta(id) {
  if (!(await chat.borrarRespuesta(id))) throw new Error('Esa respuesta ya no existe.');
  return { borrada: true };
}

// ── EMPEZAR UNA CONVERSACIÓN ─────────────────────────────────────────────────

/** Los conductores a los que se puede escribir, aunque nunca hayan escrito. */
async function conductores() {
  return { conductores: await chat.conductoresConTelefono() };
}

/** El teléfono de un conductor, para abrir su conversación desde otra pantalla. */
async function telefonoDeConductor(conductorId) {
  const id = Number(conductorId);
  if (!Number.isInteger(id) || id <= 0) return null;
  try { return await chat.telefonoDeConductor(id); } catch (_) { return null; }
}

module.exports = {
  conversaciones, abrir, enviar, bot, cabecera,
  bajarAdjunto, adjunto,
  plantillas, enviarPlantilla,
  asignables, asignar,
  respuestas, guardarRespuesta, borrarRespuesta,
  conductores, telefonoDeConductor,
};
