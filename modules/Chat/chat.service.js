// ============================================================
// EL CHAT INTERNO — ítem 2 de la hoja de ruta, entregas 2a y 2b (db/256, db/257)
// ============================================================
// «Reemplazar Slack por un chat dentro del ERP, con sus mismas funciones.» Solo
// para la oficina.
//
// LA 2a (17/11/2026): canales públicos y privados, mensajes directos (de 1 a 1 y
// de grupo), tiempo real, no leídos, menciones e hilos. Lo que decidió Camilo:
//   · LOS PÚBLICOS, DE TODA LA OFICINA, también los de bajas médicas, nóminas,
//     RR. HH. y efectivo; y toda la oficina DENTRO de todos (quien llega
//     después, entra solo: asegurarPublicos).
//   · LOS PRIVADOS Y LOS DIRECTOS, solo de quien está dentro: a cualquier otro,
//     un 404 (ni sabe que existen).
//   · CREAN, ARCHIVAN Y RENOMBRAN CANALES los puestos de Dirección y Desarrollo
//     (función de Organización «chat_canales»). A un privado añade gente
//     quien está dentro; quita gente quien lo creó o quien lleva los canales.
//
// LA 2b (17/11/2026): adjuntos, reacciones, editar y anular, fijar y guardar,
// formato, vista previa de enlaces y convertir en tarea. Lo que decidió Camilo:
//   · REACCIONES: seis emojis fijos (EMOJIS).
//   · EDITAR Y ANULAR LO PROPIO cuando se quiera y SIN MOTIVO, como Slack. Quien
//     lleva los canales anula lo de otro, CON MOTIVO (lo ve el canal). Nada se
//     borra: el texto queda en la fila y en el libro.
//   · CONVERTIR EN TAREA como una tarea a mano del tablero: con su aprobación si
//     quien la crea no aprueba. El mensaje lleva el sello; al cerrarla, la
//     respuesta sale en su hilo, firmada por Telecab y mencionando a quien la creó.
//   · FIJAR, cualquiera del canal; GUARDAR, cada uno lo suyo.
//   · LOS FICHEROS van con el servicio de adjuntos (A6, R2), como en Slack: se
//     suben en cuanto se eligen, a un BORRADOR de quien escribe, y al mandar
//     pasan al mensaje. El mensaje no existe hasta que todo está subido: nadie
//     ve uno a medias (Camilo, 17/11/2026) y sale en su sitio, no más arriba.
//   · LA VISTA PREVIA DE UN ENLACE la lee el servidor después de mandar, con
//     services/enlaces.js (protegido contra SSRF), y avisa cuando la tiene.
//
// LAS MENCIONES van en el texto como <@id> (una persona) y <!canal> (todo el
// canal): así un nombre cambiado no rompe nada. Se apuntan en chat_mencion y
// cuentan aparte de los no leídos.
//
// LOS HILOS son de un nivel, como Slack: responder a una respuesta es responder
// al mensaje de arriba. Las respuestas no cuentan como no leídas del canal; una
// mención dentro de un hilo, sí.
//
// AL MOMENTO: cada mensaje avisa por el tiempo real (A7, canal «chat») a los
// del canal y mueve sus contadores (A9); cada cambio de un mensaje (editarlo,
// una reacción, sus ficheros…) avisa con `tipo: 'cambio'`. Y lo que es de cada
// uno le llega como notificación al dispositivo (A8), aunque no tenga el ERP
// abierto: ver «Las notificaciones al dispositivo», más abajo. El «no
// molestar», con la 2c.
'use strict';

const libro = require('../../services/libro');
const organizacion = require('../../services/organizacion');
const contadores = require('../../services/contadores');
const tiempoReal = require('../../services/tiempoReal');
const adjuntos = require('../../services/adjuntos');
const enlaces = require('../../services/enlaces');
const tablero = require('../../services/tablero');
const repo = require('./chat.repo');

function conEstado(e, status) { e.status = status; return e; }
const error = (msg, status = 400) => conEstado(new Error(msg), status);
const entero = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const MAX_TEXTO = 8000;
const MAX_DIRECTO = 9;   // como Slack: un directo de grupo, de hasta 9 personas
const NO_ESTA = 'Ese canal no existe o no estás en él';
const EMOJIS = ['ok', 'hecho', 'visto', 'gracias', 'risa', 'corazon'];
const ANULADO_POR_AUTOR = 'Lo anuló quien lo escribió';

// ── Quién es ───────────────────────────────────────────────────────────────
// Lo de meterle en los públicos se hace una vez por persona y proceso (y otra
// cuando nace un canal público).
const asegurados = new Set();
async function contexto(usuarioId) {
  const id = entero(usuarioId);
  if (!id) throw error('Sesión requerida', 401);
  if (!asegurados.has(id)) {
    if (!await repo.esDeLaOficina(id)) throw error('El chat es de la oficina', 403);
    await repo.asegurarPublicos(id);
    asegurados.add(id);
  }
  return { id };
}
const puedeGestionar = id => organizacion.tiene(id, 'chat_canales');

/** El canal, si quien mira puede verlo: los públicos, todos; los demás, si está dentro. */
async function acceso(ctx, canalId, { cli = null } = {}) {
  const c = entero(canalId) ? await repo.canal(cli, entero(canalId)) : null;
  if (!c) throw error(NO_ESTA, 404);
  const yo = await repo.miembro(cli, c.id, ctx.id);
  const dentro = !!(yo && !yo.salido_at);
  if (!dentro && c.tipo !== 'publico') throw error(NO_ESTA, 404);
  return { canal: c, dentro };
}

/** Un mensaje (la fila entera) y su canal, si quien mira puede verlo. */
async function delMensaje(ctx, mensajeId) {
  const m = entero(mensajeId) ? await repo.mensajeCrudo(null, entero(mensajeId)) : null;
  if (!m) throw error('Ese mensaje no existe', 404);
  const { canal, dentro } = await acceso(ctx, m.canal_id);
  return { m, canal, dentro, puedeEscribir: !canal.archivado_at && (dentro || canal.tipo === 'publico') };
}

// ── Lo que ve la pantalla ──────────────────────────────────────────────────
function tituloDe(c, otros) {
  if (c.tipo !== 'directo') return c.nombre;
  return (otros || []).map(o => o.nombre).join(', ') || 'Solo tú';
}

/** Sus canales y directos, con los no leídos, y si puede crear canales. */
async function canales(usuarioId) {
  const ctx = await contexto(usuarioId);
  const [filas, puede] = await Promise.all([repo.canalesDe(ctx.id), puedeGestionar(ctx.id)]);
  return {
    yo: { id: ctx.id, puedeCrear: puede, gestiona: puede },
    canales: filas.map(c => ({
      id: Number(c.id), tipo: c.tipo, nombre: c.nombre, titulo: tituloDe(c, c.otros), tema: c.tema,
      sinLeer: c.sin_leer, menciones: c.menciones, miembros: c.miembros, ultimoAt: c.ultimo_mensaje_at,
      otros: c.otros || null,
    })),
  };
}

/** Un canal, con quién está dentro y lo que puede hacer quien mira. */
async function ficha(usuarioId, canalId) {
  const ctx = await contexto(usuarioId);
  const { canal: c, dentro } = await acceso(ctx, canalId);
  const [gente, gestiona, fijados] = await Promise.all([repo.miembros(null, c.id), puedeGestionar(ctx.id), repo.cuantosFijados(c.id)]);
  const otros = c.tipo === 'directo' ? gente.filter(p => Number(p.id) !== ctx.id) : null;
  return {
    id: Number(c.id), tipo: c.tipo, nombre: c.nombre, titulo: tituloDe(c, otros), tema: c.tema, descripcion: c.descripcion,
    creadoPor: c.creado_por_nombre || null, creadoAt: c.creado_at, archivado: !!c.archivado_at,
    miembros: gente.map(p => ({ id: Number(p.id), nombre: p.nombre, puesto: p.puesto })),
    dentro, fijados,
    puede: {
      escribir: !c.archivado_at && (dentro || c.tipo === 'publico'),
      anadir: c.tipo === 'privado' && !c.archivado_at && (dentro || gestiona),
      quitar: c.tipo === 'privado' && !c.archivado_at && (gestiona || c.creado_por === ctx.id),
      anularDeOtros: gestiona,
    },
  };
}

/**
 * Los mensajes como los pinta la pantalla, con todo lo suyo: menciones,
 * reacciones, ficheros, la vista previa del enlace, si está fijado, si quien
 * mira lo tiene guardado y la tarjeta del tablero. Una consulta por cosa, no
 * por mensaje.
 */
async function completar(filas, ctx) {
  const ids = filas.map(x => Number(x.id));
  const urls = [...new Set(filas.map(x => x.enlace_url).filter(Boolean))];
  const [menciones, reacciones, fijados, guardados, tareas, ficheros, previas] = await Promise.all([
    repo.mencionesDe(ids), repo.reaccionesDe(ids), repo.fijadosDe(ids), repo.guardadosEntre(ctx.id, ids),
    repo.tareasDe(ids), repo.adjuntosDe(ids), repo.enlacesDe(urls),
  ]);
  return filas.map(x => {
    const id = Number(x.id);
    const anulado = !!x.anulado_at;
    const previa = !anulado && x.enlace_url ? previas.get(x.enlace_url) : null;
    const t = tareas.get(id);
    return {
      id, canalId: Number(x.canal_id), autorId: x.autor_id, autor: x.autor || nombreCorto(x.autor_externo) || 'Telecab',
      // Traído de Slack (db/259): no cuenta como nuevo ni como no leído.
      importado: !!x.importado,
      padreId: x.padre_id ? Number(x.padre_id) : null, creadoAt: x.creado_at,
      texto: x.texto, editado: !!x.editado_at, evento: x.evento || null,
      anulado: anulado ? { porAutor: x.anulado_por === x.autor_id, por: x.anulado_por_nombre || null, motivo: x.anulado_motivo || null } : null,
      respuestas: x.respuestas, ultimaRespuestaAt: x.ultima_respuesta_at,
      menciones: menciones.get(id) || { usuarios: [], todos: false },
      conAdjuntos: !!x.con_adjuntos,
      adjuntos: anulado ? [] : (ficheros.get(id) || []).map(a => ({
        id: Number(a.id), nombre: a.nombre, mime: a.mime, clase: adjuntos.claseDe(a.mime), bytes: Number(a.bytes),
        creadoAt: a.creado_at, url: `/adjuntos/${a.id}/fichero`,
      })),
      reacciones: anulado ? [] : (reacciones.get(id) || []).map(r => ({ emoji: r.emoji, n: r.usuarios.length, mia: r.usuarios.includes(ctx.id), nombres: r.nombres })),
      enlace: previa ? { url: previa.url, titulo: previa.titulo, descripcion: previa.descripcion, sitio: previa.sitio } : null,
      fijado: fijados.has(id) && !anulado ? { por: fijados.get(id) } : null,
      guardado: guardados.has(id),
      tarea: t ? { id: Number(t.id), estado: t.estado, titulo: t.titulo, responsable: t.responsable || null, venceEl: t.vence_el } : null,
    };
  });
}

/**
 * Los mensajes de un canal (los de arriba; las respuestas, en su hilo), del
 * más viejo al más nuevo. `antes`: los anteriores a ese id (subir); `despues`:
 * los nuevos desde ese id (lo que llegó). Y hasta dónde había leído.
 */
async function mensajes(usuarioId, canalId, { antes = null, despues = null } = {}) {
  const ctx = await contexto(usuarioId);
  const { canal: c } = await acceso(ctx, canalId);
  const LIMITE = 50;
  let filas = await repo.mensajes(c.id, { antes: entero(antes), despues: entero(despues), limite: LIMITE + 1 });
  const hayMas = filas.length > LIMITE;
  filas = filas.slice(0, LIMITE);
  if (despues == null) filas.reverse();
  const yo = await repo.miembro(null, c.id, ctx.id);
  return { mensajes: await completar(filas, ctx), hayMas, ultimoLeido: yo ? Number(yo.ultimo_leido_id) : 0 };
}

/** Un mensaje (para refrescar uno que cambió, o un hilo que acaba de crecer). */
async function uno(usuarioId, mensajeId) {
  const ctx = await contexto(usuarioId);
  const m = entero(mensajeId) ? await repo.mensaje(null, entero(mensajeId)) : null;
  if (!m) throw error('Ese mensaje no existe', 404);
  await acceso(ctx, m.canal_id);
  return { mensaje: (await completar([m], ctx))[0] };
}

/** Un hilo: el mensaje de arriba y sus respuestas. */
async function hilo(usuarioId, mensajeId) {
  const ctx = await contexto(usuarioId);
  let raiz = entero(mensajeId) ? await repo.mensaje(null, entero(mensajeId)) : null;
  if (!raiz) throw error('Ese mensaje no existe', 404);
  if (raiz.padre_id) raiz = await repo.mensaje(null, Number(raiz.padre_id));
  await acceso(ctx, raiz.canal_id);
  const [r] = await completar([raiz], ctx);
  return { raiz: r, respuestas: await completar(await repo.respuestas(Number(raiz.id)), ctx) };
}

// ── Escribir ───────────────────────────────────────────────────────────────
/** El texto de un mensaje, limpio: saltos de línea de siempre, sin espacios a los lados. */
/**
 * Un nombre completo, como sale en el chat: el nombre y las iniciales de los
 * apellidos, sin las partículas (Camilo, 17/11/2026: «Laura B.»). Para los
 * nombres de Slack de quien no es usuario del ERP; los de los usuarios los
 * hace así la consulta (NOMBRE de chat.repo).
 */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'di', 'van', 'von']);
function nombreCorto(completo) {
  const [nombre, ...resto] = String(completo || '').trim().split(/\s+/).filter(Boolean);
  if (!nombre) return '';
  const iniciales = resto.filter(p => !PARTICULAS.has(p.toLowerCase())).map(p => p[0].toUpperCase() + '.');
  return [nombre, ...iniciales].join(' ');
}

const limpiarTexto = v => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();

/** El primer enlace del texto, si se puede leer su vista previa; si no, null. */
function primerEnlace(t) {
  const m = /\bhttps?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"]/.exec(String(t || ''));
  if (!m) return null;
  try { return enlaces.urlValida(m[0]).url.toString().slice(0, 2000); } catch (_) { return null; }
}

/**
 * A quién menciona un texto: las personas (<@id>) de la oficina que pueden
 * leerlo (en un privado o un directo, las de dentro) y si avisa a todo el canal.
 */
async function mencionadosDe(t, c, autorId, dentroAhora) {
  const ids = [...new Set([...t.matchAll(/<@(\d{1,9})>/g)].map(m => Number(m[1])))]
    .filter(u => u !== autorId && (c.tipo === 'publico' || dentroAhora.has(u)));
  const usuarios = [];
  for (const u of ids) if (await repo.esDeLaOficina(u)) usuarios.push(u);
  return { usuarios, todos: /<!canal>/.test(t) };
}

/**
 * Un mensaje (o la respuesta de un hilo con `padreId`). Las menciones van en
 * el texto: <@id> y <!canal>. En un privado o un directo solo cuenta la
 * mención a quien está dentro (el resto no lo podría leer). Con `borrador`
 * (donde subió ya sus ficheros: borradorValido), los ficheros pasan al mensaje
 * y el texto puede ir vacío.
 */
async function enviar(usuarioId, canalId, { texto: txt, padreId = null, borrador = null } = {}) {
  const ctx = await contexto(usuarioId);
  const t = limpiarTexto(txt);
  const b = borrador ? borradorValido(borrador, ctx.id) : null;
  if (borrador && !b) throw error('Esos ficheros no son tuyos', 403);
  if (!t && !b) throw error('Escribe el mensaje');
  if (t.length > MAX_TEXTO) throw error(`Un mensaje no puede pasar de ${MAX_TEXTO} caracteres`);
  const { canal: c, dentro } = await acceso(ctx, canalId);
  if (c.archivado_at) throw error('Ese canal está archivado: ya no se escribe en él', 409);
  const enlaceUrl = primerEnlace(t);

  const r = await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: 'alta' }, async cli => {
    // Escribir en un público del que salió le vuelve a meter.
    if (!dentro) await repo.meter(cli, c.id, ctx.id, ctx.id);
    let padre = null;
    if (padreId) {
      const p = await repo.mensaje(cli, entero(padreId));
      if (!p || Number(p.canal_id) !== Number(c.id)) throw error('Ese hilo no es de este canal', 404);
      padre = p.padre_id ? Number(p.padre_id) : Number(p.id);
    }
    // Los ficheros que ya subió, del borrador al mensaje (en esta transacción:
    // o salen el mensaje y sus ficheros, o nada).
    const ficheros = b ? await repo.ficherosDeBorrador(cli, b, ctx.id) : 0;
    if (!t && !ficheros) throw error('Escribe el mensaje: los ficheros no han llegado a subirse');
    const id = await repo.escribir(cli, { canalId: c.id, autorId: ctx.id, padreId: padre, texto: t, conAdjuntos: ficheros > 0, enlaceUrl });
    if (ficheros) await repo.pasarBorrador(cli, b, ctx.id, id);
    const dentroAhora = new Set(await repo.idsMiembros(cli, c.id));
    const men = await mencionadosDe(t, c, ctx.id, dentroAhora);
    if (men.usuarios.length || men.todos) await repo.mencionar(cli, id, men);
    return { id, padre, para: [...dentroAhora], men, ficheros };
  });
  avisar(c.id, r.para, { id: r.id, padre: r.padre });
  prepararEnlace(enlaceUrl, { canalId: c.id, para: r.para, id: r.id, padre: r.padre });
  notificarMensaje({ canal: c, autorId: ctx.id, id: r.id, padre: r.padre, texto: t, men: r.men, para: r.para, ficheros: r.ficheros });
  return (await uno(ctx.id, r.id));
}

/** Leído hasta `hasta` (el último que ha visto en el canal, hilos incluidos). */
async function leido(usuarioId, canalId, { hasta } = {}) {
  const ctx = await contexto(usuarioId);
  const { canal: c, dentro } = await acceso(ctx, canalId);
  if (!dentro) return { ultimoLeido: 0 };
  const n = await repo.leer(c.id, ctx.id, entero(hasta) || 0);
  contadores.cambio('chat', { para: [ctx.id] });
  return { ultimoLeido: n };
}

// ── Editar y anular (2b) ───────────────────────────────────────────────────
/**
 * Cambia el texto de un mensaje propio. Sale «(editado)»; lo de antes queda en
 * el libro. Una mención nueva avisa; la que se quita no se des-avisa.
 */
async function editar(usuarioId, mensajeId, { texto: txt } = {}) {
  const ctx = await contexto(usuarioId);
  const { m, canal: c } = await delMensaje(ctx, mensajeId);
  if (Number(m.autor_id) !== ctx.id) throw error('Solo quien lo escribió puede editarlo', 403);
  if (m.anulado_at) throw error('Ese mensaje está anulado', 409);
  if (m.evento) throw error('Ese mensaje lo puso el sistema: no se edita', 409);
  if (c.archivado_at) throw error('Ese canal está archivado', 409);
  const t = limpiarTexto(txt);
  if (!t && !m.con_adjuntos) throw error('Escribe el mensaje (o anúlalo)');
  if (t.length > MAX_TEXTO) throw error(`Un mensaje no puede pasar de ${MAX_TEXTO} caracteres`);
  if (t === m.texto) return uno(ctx.id, m.id);
  const enlaceUrl = primerEnlace(t);
  const antes = (await repo.mencionesDe([Number(m.id)])).get(Number(m.id)) || { usuarios: [], todos: false };
  const { para, men } = await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: 'cambio' }, async cli => {
    await repo.editar(cli, m.id, { texto: t, enlaceUrl });
    const dentroAhora = new Set(await repo.idsMiembros(cli, c.id));
    const nuevas = await mencionadosDe(t, c, ctx.id, dentroAhora);
    if (nuevas.usuarios.length || nuevas.todos) await repo.mencionar(cli, m.id, nuevas);
    return { para: [...dentroAhora], men: nuevas };
  });
  avisarCambio(c.id, para, { id: Number(m.id), padre: m.padre_id, contar: true });
  if (enlaceUrl !== m.enlace_url) prepararEnlace(enlaceUrl, { canalId: c.id, para, id: Number(m.id), padre: m.padre_id });
  // Solo a quien nombra ahora y antes no: lo demás ya se avisó al mandarlo.
  const nuevas = { usuarios: men.usuarios.filter(u => !antes.usuarios.includes(u)), todos: men.todos && !antes.todos };
  if (nuevas.usuarios.length || nuevas.todos) {
    notificarMensaje({ canal: c, autorId: ctx.id, id: Number(m.id), padre: null, texto: t, men: nuevas, para, soloMenciones: true });
  }
  return uno(ctx.id, m.id);
}

/**
 * Anula un mensaje: deja de verse su texto (sale «Mensaje anulado») y se queda
 * en la fila y en el libro. Lo propio, sin motivo; lo de otro, solo quien lleva
 * los canales y con motivo, que ve el canal.
 */
async function anular(usuarioId, mensajeId, { motivo } = {}) {
  const ctx = await contexto(usuarioId);
  const { m, canal: c } = await delMensaje(ctx, mensajeId);
  const propio = Number(m.autor_id) === ctx.id;
  if (!propio && !await puedeGestionar(ctx.id)) throw error('Solo quien lo escribió, o quien lleva los canales, puede anularlo', 403);
  if (m.anulado_at) throw error('Ese mensaje ya estaba anulado', 409);
  const mot = texto(motivo, 500);
  if (!propio && mot.length < 3) throw error('Di por qué lo anulas (al menos 3 letras): lo verá el canal');
  const porque = mot || ANULADO_POR_AUTOR;
  await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: 'anulacion', motivo: porque }, async cli => {
    if (!await repo.anular(cli, m.id, { por: ctx.id, motivo: porque })) throw error('Ese mensaje ya estaba anulado', 409);
  });
  avisarCambio(c.id, await repo.idsMiembros(null, c.id), { id: Number(m.id), padre: m.padre_id, contar: true, fijados: true });
  // Lo anuló otro (quien lleva los canales): a su autor se le dice, con el motivo.
  if (!propio && m.autor_id) {
    notificarA([Number(m.autor_id)], async () => ({
      titulo: `Han anulado un mensaje tuyo en ${dondeDe(c)}`,
      cuerpo: `${await nombre(ctx.id)}: ${porque}`,
      url: `/chat?canal=${c.id}&mensaje=${m.id}`, etiqueta: `chat-${c.id}`,
    }));
  }
  return uno(ctx.id, m.id);
}

// ── Reacciones, fijar y guardar (2b) ───────────────────────────────────────
/** Pone una de las seis reacciones, o la quita si ya la tenía. */
async function reaccionar(usuarioId, mensajeId, { emoji } = {}) {
  const ctx = await contexto(usuarioId);
  if (!EMOJIS.includes(String(emoji))) throw error('Esa reacción no existe');
  const { m, canal: c, puedeEscribir } = await delMensaje(ctx, mensajeId);
  if (m.anulado_at) throw error('Ese mensaje está anulado', 409);
  if (!puedeEscribir) throw error('Ese canal está archivado', 409);
  const puesta = await repo.reaccionar(null, m.id, ctx.id, String(emoji));
  avisarCambio(c.id, await repo.idsMiembros(null, c.id), { id: Number(m.id), padre: m.padre_id });
  // A su autor, cuando otro la pone (quitarla no avisa).
  if (puesta && m.autor_id && Number(m.autor_id) !== ctx.id) {
    notificarA([Number(m.autor_id)], async () => ({
      titulo: `${await nombre(ctx.id)} ha reaccionado ${EMOJI_TXT[emoji]} a tu mensaje`,
      cuerpo: await vistaPrevia(m.texto, m.con_adjuntos ? 1 : 0),
      url: `/chat?canal=${c.id}&mensaje=${m.id}`, etiqueta: `chat-${c.id}-r`,
    }));
  }
  return uno(ctx.id, m.id);
}

/** Fija un mensaje en su canal (o lo desfija). Cualquiera del canal; queda quién. */
async function fijar(usuarioId, mensajeId, { fijar: si = true } = {}) {
  const ctx = await contexto(usuarioId);
  const { m, canal: c, puedeEscribir } = await delMensaje(ctx, mensajeId);
  if (!puedeEscribir) throw error('Ese canal está archivado', 409);
  if (si && m.anulado_at) throw error('Ese mensaje está anulado', 409);
  const hecho = await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: si ? 'alta' : 'baja' },
    cli => (si ? repo.fijar(cli, m.id, c.id, ctx.id) : repo.desfijar(cli, m.id, ctx.id)));
  if (!hecho) throw error(si ? 'Ya estaba fijado' : 'No estaba fijado', 409);
  avisarCambio(c.id, await repo.idsMiembros(null, c.id), { id: Number(m.id), padre: m.padre_id, fijados: true });
  // A su autor, cuando otro lo fija (desfijar no avisa).
  if (si && m.autor_id && Number(m.autor_id) !== ctx.id) {
    notificarA([Number(m.autor_id)], async () => ({
      titulo: `${await nombre(ctx.id)} ha fijado tu mensaje en ${dondeDe(c)}`,
      cuerpo: await vistaPrevia(m.texto, m.con_adjuntos ? 1 : 0),
      url: `/chat?canal=${c.id}&mensaje=${m.id}`, etiqueta: `chat-${c.id}-r`,
    }));
  }
  return uno(ctx.id, m.id);
}

/** Lo fijado en un canal, lo último primero. */
async function fijados(usuarioId, canalId) {
  const ctx = await contexto(usuarioId);
  const { canal: c } = await acceso(ctx, canalId);
  return { mensajes: await completar(await repo.fijadosCanal(c.id), ctx) };
}

/** Guarda un mensaje para luego (o deja de guardarlo). Solo lo ve quien lo guarda. */
async function guardar(usuarioId, mensajeId, { guardar: si = true } = {}) {
  const ctx = await contexto(usuarioId);
  const { m } = await delMensaje(ctx, mensajeId);
  if (si && m.anulado_at) throw error('Ese mensaje está anulado', 409);
  await repo.guardar(null, ctx.id, m.id, !!si);
  return uno(ctx.id, m.id);
}

/** Lo que tiene guardado, de los canales que aún puede ver. */
async function guardados(usuarioId) {
  const ctx = await contexto(usuarioId);
  const filas = await repo.guardadosDe(ctx.id);
  const hechos = await completar(filas, ctx);
  return { mensajes: hechos.map((m, i) => ({ ...m, canal: { id: m.canalId, tipo: filas[i].canal_tipo, nombre: filas[i].canal_nombre } })) };
}

// ── Los ficheros de un mensaje (2b, con el servicio de adjuntos A6) ────────
// Se suben ANTES de mandar, a un borrador de quien escribe ('chat_borrador',
// «<su id>-<al azar>»): solo él los sube, los ve y los quita. Al mandar, pasan
// al mensaje ('chat_mensaje'): los ve quien ve el mensaje y los quita su autor
// o quien lleva los canales. A un mensaje ya mandado no se le suben más.
const BORRADOR = /^(\d{1,9})-[a-z0-9]{8,40}$/;
/** El borrador, si es de esa persona; si no, null. */
function borradorValido(v, usuarioId) {
  const s = String(v || '').trim().toLowerCase();
  const m = BORRADOR.exec(s);
  return m && Number(m[1]) === Number(usuarioId) ? s : null;
}
async function puedeFicheroDeBorrador(quien, duenoId) {
  try {
    const ctx = await contexto(quien && quien.id);
    return !!borradorValido(duenoId, ctx.id);
  } catch (_) {
    return false;
  }
}
adjuntos.registrarDueno('chat_borrador', {
  etiqueta: 'Fichero del chat aún sin mandar',
  ver: puedeFicheroDeBorrador,
  adjuntar: puedeFicheroDeBorrador,
  anular: puedeFicheroDeBorrador,
});

async function puedeFichero(cual, quien, duenoId) {
  try {
    const ctx = await contexto(quien && quien.id);
    const { m } = await delMensaje(ctx, duenoId);
    if (m.anulado_at) return false;
    if (cual === 'ver') return true;
    if (cual === 'adjuntar') return false;
    return Number(m.autor_id) === ctx.id || await puedeGestionar(ctx.id);
  } catch (_) {
    return false;
  }
}
adjuntos.registrarDueno('chat_mensaje', {
  etiqueta: 'Mensaje del chat',
  ver: (quien, id) => puedeFichero('ver', quien, id),
  adjuntar: (quien, id) => puedeFichero('adjuntar', quien, id),
  anular: (quien, id) => puedeFichero('anular', quien, id),
});

// ── La vista previa de los enlaces (2b) ────────────────────────────────────
// Se lee después de mandar, sin hacer esperar a nadie, y una sola vez por
// enlace a la semana. Cuando está, se avisa al canal y la pantalla la pinta.
const SEMANA = 7 * 86400 * 1000;
let leerPrevia = enlaces.vistaPrevia;
const pendientes = new Set();
function prepararEnlace(url, { canalId, para, id, padre }) {
  if (!url || !leerPrevia) return;
  const trabajo = (async () => {
    const ya = await repo.enlace(url);
    if (ya && Date.now() - new Date(ya.leido_at).getTime() < SEMANA) return;
    let v = null, estado = 'error';
    try { v = await leerPrevia(url); estado = v ? 'ok' : 'nada'; } catch (_) { estado = 'error'; }
    await repo.guardarEnlace(url, { estado, titulo: v && v.titulo, descripcion: v && v.descripcion, sitio: v && v.sitio });
    if (estado === 'ok') avisarCambio(canalId, para, { id, padre });
  })().catch(e => console.error('❌ [Chat] vista previa de un enlace:', e.message))
    .finally(() => pendientes.delete(trabajo));
  pendientes.add(trabajo);
}

// ── Convertir en tarea (2b; el primer criterio del ítem 1) ─────────────────
/**
 * Una tarjeta del tablero a partir de un mensaje: como una tarea a mano (con
 * responsable, plazo y, si quien la crea no aprueba, aprobación). Una por
 * mensaje. El mensaje lleva su sello y la tarjeta, el enlace al mensaje.
 */
async function convertirEnTarea(usuarioId, mensajeId, { titulo, descripcion, responsableId, plazoDias, venceEl } = {}) {
  const ctx = await contexto(usuarioId);
  const { m, canal: c } = await delMensaje(ctx, mensajeId);
  if (m.anulado_at) throw error('Ese mensaje está anulado', 409);
  const ya = (await repo.tareasDe([Number(m.id)])).get(Number(m.id));
  if (ya && ya.estado !== 'anulada') throw error('Ese mensaje ya es una tarea', 409);
  const enlace = `/chat?canal=${c.id}&mensaje=${m.id}`;
  let tarjeta;
  try {
    tarjeta = await tablero.crear(ctx.id, { titulo, descripcion, responsableId, plazoDias, venceEl }, { tipo: 'mensaje', origenId: String(m.id), enlace });
  } catch (e) {
    if (e.code === '23505') throw error('Ese mensaje ya es una tarea', 409);
    throw e;
  }
  avisarCambio(c.id, await repo.idsMiembros(null, c.id), { id: Number(m.id), padre: m.padre_id });
  return { tarea: tarjeta, ...(await uno(ctx.id, m.id)) };
}

// Al cerrarla desde el tablero: se cierra, y la respuesta sale en el hilo del
// mensaje, firmada por Telecab (quien la cierra puede no estar en el canal) y
// mencionando a quien la creó, que así se entera.
tablero.registrarTipo('mensaje', {
  etiqueta: 'Mensaje del chat', aprobacion: true, abrir: 'Abrir el mensaje',
  verOrigen: mensajeDeTarea,
  async alCerrar(t, { quien, nota }) {
    const mid = entero(t.origen_id);
    const m = mid ? await repo.mensajeCrudo(null, mid) : null;
    const creador = entero(t.creada_por);
    let nueva = null;
    await libro.conFirma({ usuarioId: quien.id, origen: 'chat', accion: 'cierre', motivo: nota }, async cli => {
      await tablero.cerrarPorOrigen(cli, { tipo: 'mensaje', origenId: String(t.origen_id), autorId: quien.id, nota });
      if (!m) return;
      const c = await repo.canal(cli, Number(m.canal_id));
      const dentro = new Set(await repo.idsMiembros(cli, c.id));
      const avisa = creador && (c.tipo === 'publico' || dentro.has(creador)) ? creador : null;
      const quienCierra = await repo.nombreDe(cli, quien.id);
      // Un nombre como «Laura B.» ya acaba en punto: no se pone otro.
      const fin = quienCierra && quienCierra.endsWith('.') ? '' : '.';
      const txt = `${avisa ? `<@${avisa}> ` : ''}Tarea hecha: «${t.titulo}»${quienCierra ? `, la cerró ${quienCierra}` : ''}${fin}\n${nota}`.slice(0, MAX_TEXTO);
      const padre = m.padre_id ? Number(m.padre_id) : Number(m.id);
      const id = await repo.escribir(cli, { canalId: c.id, autorId: null, padreId: padre, texto: txt, evento: 'tarea_cerrada' });
      if (avisa) await repo.mencionar(cli, id, { usuarios: [avisa] });
      nueva = { id, padre, canal: c, para: [...dentro], texto: txt, avisa };
    });
    if (nueva) {
      avisar(nueva.canal.id, nueva.para, { id: nueva.id, padre: nueva.padre });
      avisarCambio(nueva.canal.id, nueva.para, { id: mid, padre: m.padre_id });
      // A quien la creó (mención) y a quien escribió en el hilo, como notificación.
      notificarMensaje({ canal: nueva.canal, autorId: null, id: nueva.id, padre: nueva.padre, texto: nueva.texto,
        men: { usuarios: nueva.avisa ? [nueva.avisa] : [], todos: false }, para: nueva.para, evento: 'tarea_cerrada' });
    }
  },
});

// ── Canales, directos y miembros ───────────────────────────────────────────
/** El nombre de un canal, como en Slack: minúsculas, sin tildes ni espacios. */
function nombreDeCanal(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^#/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** Un canal nuevo. Público: dentro toda la oficina. Privado: quien lo crea. */
async function crearCanal(usuarioId, { nombre, tipo = 'publico', tema = '', descripcion = '' } = {}) {
  const ctx = await contexto(usuarioId);
  await organizacion.exigir(ctx.id, 'chat_canales').catch(e => { throw conEstado(e, 403); });
  if (!['publico', 'privado'].includes(tipo)) throw error('Un canal es público o privado');
  const n = nombreDeCanal(nombre);
  if (n.length < 2) throw error('Ponle un nombre al canal (letras, números y guiones)');
  const id = await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: 'alta' }, async cli => {
    if (await repo.canalPorNombre(cli, n)) throw error(`Ya hay un canal #${n}`, 409);
    const nuevo = await repo.crearCanal(cli, { tipo, nombre: n, tema: texto(tema, 250) || null, descripcion: texto(descripcion, 2000) || null, creadoPor: ctx.id });
    if (tipo === 'publico') await repo.meterOficina(cli, nuevo);
    else await repo.meter(cli, nuevo, ctx.id, ctx.id);
    return nuevo;
  });
  const para = await repo.idsMiembros(null, id);
  tiempoReal.publicar('chat', { canal: id, tipo: 'canal' }, { para });
  return ficha(ctx.id, id);
}

/** El directo con esas personas (uno a uno o de grupo): el que ya había, o uno nuevo. */
async function directo(usuarioId, { usuarios = [] } = {}) {
  const ctx = await contexto(usuarioId);
  const ids = [...new Set([ctx.id, ...[].concat(usuarios).map(entero).filter(Boolean)])].sort((a, b) => a - b);
  if (ids.length < 2) throw error('Elige con quién');
  if (ids.length > MAX_DIRECTO) throw error(`Un mensaje directo es de hasta ${MAX_DIRECTO} personas: para más, un canal`);
  for (const u of ids) if (!await repo.esDeLaOficina(u)) throw error('Alguien de los elegidos no es de la oficina o está bloqueado');
  const clave = ids.join(',');
  const id = await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: 'alta' }, async cli => {
    const ya = await repo.directoPorClave(cli, clave);
    if (ya) return Number(ya.id);
    const nuevo = await repo.crearCanal(cli, { tipo: 'directo', claveDirecto: clave, creadoPor: ctx.id });
    for (const u of ids) await repo.meter(cli, nuevo, u, ctx.id);
    return nuevo;
  });
  return ficha(ctx.id, id);
}

/** Añade a alguien a un privado: quien está dentro, o quien lleva los canales. */
async function anadir(usuarioId, canalId, { usuarioId: otro } = {}) {
  const ctx = await contexto(usuarioId);
  const c = entero(canalId) ? await repo.canal(null, entero(canalId)) : null;
  if (!c) throw error(NO_ESTA, 404);
  const yo = await repo.miembro(null, c.id, ctx.id);
  const dentro = !!(yo && !yo.salido_at);
  const gestiona = await puedeGestionar(ctx.id);
  if (c.tipo !== 'privado') {
    if (!dentro && c.tipo !== 'publico') throw error(NO_ESTA, 404);
    throw error(c.tipo === 'publico' ? 'En los públicos ya está toda la oficina' : 'Un mensaje directo es de un grupo fijo: para sumar a alguien, empieza otro', 409);
  }
  if (!dentro && !gestiona) throw error(NO_ESTA, 404);
  if (c.archivado_at) throw error('Ese canal está archivado', 409);
  const u = entero(otro);
  if (!u || !await repo.esDeLaOficina(u)) throw error('Esa persona no es de la oficina o está bloqueada');
  await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: 'alta' }, cli => repo.meter(cli, c.id, u, ctx.id));
  const para = await repo.idsMiembros(null, c.id);
  tiempoReal.publicar('chat', { canal: Number(c.id), tipo: 'miembros' }, { para });
  contadores.cambio('chat', { para: [u] });
  if (u !== ctx.id) {
    notificarA([u], async () => ({
      titulo: `Te han añadido a ${dondeDe(c)}`,
      cuerpo: `${await nombre(ctx.id)} te ha añadido: ya puedes leer lo que se ha escrito.`,
      url: `/chat?canal=${c.id}`, etiqueta: `chat-${c.id}`,
    }));
  }
  return dentro ? ficha(ctx.id, c.id) : { ok: true };
}

/** Saca a alguien de un privado: quien lo creó o quien lleva los canales; o uno mismo, que se sale. */
async function quitar(usuarioId, canalId, { usuarioId: otro } = {}) {
  const ctx = await contexto(usuarioId);
  const c = entero(canalId) ? await repo.canal(null, entero(canalId)) : null;
  if (!c || c.tipo !== 'privado') throw error(NO_ESTA, 404);
  const u = entero(otro);
  const gestiona = await puedeGestionar(ctx.id);
  const yo = await repo.miembro(null, c.id, ctx.id);
  const dentro = !!(yo && !yo.salido_at);
  if (!dentro && !gestiona) throw error(NO_ESTA, 404);
  if (u !== ctx.id && !gestiona && c.creado_por !== ctx.id) throw error('Solo quien creó el canal, o quien lleva los canales, saca a alguien', 403);
  const hecho = await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: 'baja' }, cli => repo.sacar(cli, c.id, u, ctx.id));
  if (!hecho) throw error('Esa persona no está en el canal', 409);
  const para = [...await repo.idsMiembros(null, c.id), u];
  tiempoReal.publicar('chat', { canal: c.id, tipo: 'miembros' }, { para });
  contadores.cambio('chat', { para });
  // Si le saca otro, se le dice (salirse uno mismo no avisa).
  if (u !== ctx.id) {
    notificarA([u], async () => ({
      titulo: `Te han sacado de ${dondeDe(c)}`,
      cuerpo: `Lo ha hecho ${await nombre(ctx.id)}. Ya no verás sus mensajes.`,
      url: '/chat', etiqueta: `chat-${c.id}`,
    }));
  }
  return { ok: true };
}

const personas = async usuarioId => { await contexto(usuarioId); return { personas: (await repo.personas()).map(p => ({ id: Number(p.id), nombre: p.nombre, puesto: p.puesto })) }; };

// ── Las notificaciones al dispositivo (A8) ─────────────────────────────────
// Camilo, 17/11/2026: «además de menciones, todo lo que sea referente al
// usuario debe de llegarle como noti». Le llega a cada uno, aunque no tenga el
// ERP abierto:
//   · un mensaje directo (de 1 a 1 o de grupo);
//   · una mención a él, y @canal en un canal en el que está;
//   · una respuesta en un hilo que empezó o en el que ha escrito;
//   · que le añadan a un privado o le saquen, y que quien lleva los canales le
//     anule un mensaje;
//   · una reacción o que le fijen un mensaje.
// Una por mensaje y persona (la que más le toca: directo > mención > @canal >
// hilo), nunca a quien lo escribe, y con la etiqueta del canal: la nueva
// sustituye a la anterior en vez de amontonarse. Si esa persona tiene ESE canal
// delante, no sale (lo decide public/sw.js). El «no molestar», con la 2c.
let _push = null;
const push = () => (_push || (_push = require('../../services/notificacionesPush')));
const EMOJI_TXT = { ok: '👍', hecho: '✅', visto: '👀', gracias: '🙏', risa: '😂', corazon: '❤️' };
const dondeDe = c => (c.tipo === 'directo' ? 'un mensaje directo' : `#${c.nombre}`);
const nombre = async id => (id ? (await repo.nombreDe(null, id)) || 'Alguien' : 'Telecab');

/**
 * El texto de un mensaje para la notificación: con los nombres en vez de
 * <@id>, sin las marcas de formato y SIN DNI, NIE ni cuentas (sale en la
 * pantalla bloqueada). Corto: lo entero está en el chat.
 */
/**
 * El mensaje del que nace una tarea, para la ficha del tablero (17/11/2026):
 * quien la aprueba no tiene por qué estar en su canal, y al abrir el mensaje le
 * salía «no existe». Quien convierte un mensaje en tarea lo comparte con quien
 * la aprueba: solo ese mensaje, nada más del canal. `puedeAbrir`: si está en
 * el canal (si no, la ficha no le enseña el enlace).
 */
async function mensajeDeTarea(t, usuarioId) {
  const mid = entero(t.origen_id);
  const m = mid ? await repo.mensaje(null, mid) : null;
  if (!m) return null;
  const c = await repo.canal(null, Number(m.canal_id));
  const yo = c.tipo === 'publico' ? null : await repo.miembro(null, c.id, usuarioId);
  let texto = null;
  if (!m.anulado_at) {
    texto = String(m.texto || '');
    const ids = [...new Set([...texto.matchAll(/<@(\d{1,9})>/g)].map(x => Number(x[1])))];
    for (const id of ids) texto = texto.split(`<@${id}>`).join(`@${await nombre(id)}`);
    texto = texto.replace(/<!canal>/g, '@canal');
  }
  return {
    tipo: 'mensaje',
    autor: m.autor || nombreCorto(m.autor_externo) || 'Telecab',
    creadoAt: m.creado_at,
    donde: c.tipo === 'directo' ? 'Un mensaje directo' : `#${c.nombre}`,
    privado: c.tipo !== 'publico',
    texto, anulado: !!m.anulado_at, conFicheros: !!m.con_adjuntos,
    puedeAbrir: c.tipo === 'publico' || !!(yo && !yo.salido_at),
  };
}

async function vistaPrevia(texto, ficheros = 0) {
  let t = String(texto || '');
  const ids = [...new Set([...t.matchAll(/<@(\d{1,9})>/g)].map(m => Number(m[1])))];
  for (const id of ids) t = t.split(`<@${id}>`).join(`@${await nombre(id)}`);
  t = t.replace(/<!canal>/g, '@canal')
    .replace(/```/g, ' ').replace(/[*_~`]/g, '')
    .replace(/\b[XYZ]?\d{7,8}[-\s]?[A-Z]\b/gi, '•••')                 // DNI y NIE
    .replace(/\b[A-Z]{2}\d{2}(?:[\s-]?\d{4}){4,6}\b/gi, '•••')         // IBAN
    .replace(/\s+/g, ' ').trim();
  if (t.length > 140) t = t.slice(0, 139).trimEnd() + '…';
  if (!t && ficheros) t = ficheros === 1 ? 'Ha mandado un fichero' : `Ha mandado ${ficheros} ficheros`;
  return t;
}

/** Manda una notificación sin hacer esperar a nadie (y sin romper nada si falla). */
function notificarA(ids, datos) {
  const para = [...new Set(ids.map(Number).filter(Boolean))];
  if (!para.length) return;
  const trabajo = (async () => push().enviar(para, typeof datos === 'function' ? await datos() : datos))()
    .catch(e => console.error('❌ [Chat] notificación:', e.message))
    .finally(() => pendientes.delete(trabajo));
  pendientes.add(trabajo);
}

/**
 * Las notificaciones de un mensaje nuevo (o de las menciones nuevas al editarlo,
 * con `soloMenciones`). `para`: quién está en el canal ahora.
 */
function notificarMensaje({ canal: c, autorId, id, padre, texto: t, men = {}, para = [], ficheros = 0, evento = null, soloMenciones = false }) {
  const trabajo = (async () => {
    const dentro = new Set(para.map(Number));
    const PRIORIDAD = { directo: 4, mencion: 3, todos: 2, hilo: 1 };
    const motivos = new Map();
    const poner = (u, motivo) => {
      const n = Number(u);
      if (!n || n === Number(autorId)) return;
      const ya = motivos.get(n);
      if (!ya || PRIORIDAD[motivo] > PRIORIDAD[ya]) motivos.set(n, motivo);
    };
    if (c.tipo === 'directo' && !soloMenciones) dentro.forEach(u => poner(u, 'directo'));
    (men.usuarios || []).forEach(u => poner(u, 'mencion'));
    if (men.todos) dentro.forEach(u => poner(u, 'todos'));
    if (padre && !soloMenciones) {
      (await repo.participantesHilo(padre)).forEach(u => { if (c.tipo === 'publico' || dentro.has(u)) poner(u, 'hilo'); });
    }
    if (!motivos.size) return;
    const quien = await nombre(autorId);
    const donde = dondeDe(c);
    const cuerpo = await vistaPrevia(t, ficheros);
    const grupo = c.tipo === 'directo' && dentro.size > 2;
    const tituloDe = motivo => (evento === 'tarea_cerrada' ? `Tarea hecha · ${donde}`
      : motivo === 'directo' ? (grupo ? `${quien} · grupo` : quien)
        : motivo === 'mencion' ? `${quien} te ha mencionado en ${donde}`
          : motivo === 'todos' ? `${quien} avisa a todo ${donde}`
            : `${quien} ha respondido en un hilo de ${donde}`);
    const porTitulo = new Map();
    motivos.forEach((motivo, u) => {
      const tit = tituloDe(motivo);
      if (!porTitulo.has(tit)) porTitulo.set(tit, []);
      porTitulo.get(tit).push(u);
    });
    const url = `/chat?canal=${c.id}&mensaje=${id}`;
    for (const [titulo, ids] of porTitulo) {
      await push().enviar(ids, { titulo, cuerpo, url, etiqueta: `chat-${c.id}` });
    }
  })().catch(e => console.error('❌ [Chat] notificaciones de un mensaje:', e.message))
    .finally(() => pendientes.delete(trabajo));
  pendientes.add(trabajo);
}

// ── Avisar (tiempo real y contadores) ──────────────────────────────────────
tiempoReal.registrarCanal('chat', { etiqueta: 'Chat interno', puede: async q => !!(q && q.id) });

function avisar(canalId, para, { id, padre }) {
  try {
    tiempoReal.publicar('chat', { canal: Number(canalId), tipo: 'mensaje', id, padre: padre || null }, { para });
    contadores.cambio('chat', { para });
  } catch (e) {
    console.error('❌ [Chat] al avisar de un mensaje:', e.message);
  }
}
/**
 * Un mensaje cambió (editado, anulado, una reacción, sus ficheros, su enlace,
 * fijado, su tarjeta): que lo vuelvan a pedir. `contar`: cambian los no leídos
 * o las menciones; `fijados`: cambia la cuenta de fijados del canal.
 */
function avisarCambio(canalId, para, { id, padre = null, contar = false, fijados: f = false }) {
  try {
    tiempoReal.publicar('chat', { canal: Number(canalId), tipo: 'cambio', id: Number(id), padre: padre ? Number(padre) : null, fijados: !!f }, { para });
    if (contar) contadores.cambio('chat', { para });
  } catch (e) {
    console.error('❌ [Chat] al avisar de un cambio:', e.message);
  }
}

// Los números del menú (A9): en rojo, los directos sin leer y las menciones; si
// no hay, en azul lo que haya sin leer en los canales.
contadores.registrarFuente('chat', {
  async contar(quien) {
    if (!quien || !quien.id) return {};
    try { await contexto(quien.id); } catch (_) { return {}; }
    const r = await repo.resumen(quien.id);
    const propios = r.directos + r.menciones;
    return {
      'chat.sin_leer': { n: r.canales, tono: 'info', titulo: `${r.canales} sin leer en los canales` },
      'chat.menu': propios
        ? { n: propios, tono: 'aviso', titulo: [r.directos ? `${r.directos} en mensajes directos` : '', r.menciones ? `${r.menciones} ${r.menciones === 1 ? 'mención' : 'menciones'}` : ''].filter(Boolean).join(' · ') }
        : { n: r.canales, tono: 'info', titulo: `${r.canales} sin leer en los canales` },
    };
  },
});

// ── Para las pruebas ───────────────────────────────────────────────────────
/** Olvidar a quién ya se metió en los públicos. */
const olvidar = () => asegurados.clear();
/** Cambiar cómo se lee la vista previa (no hay red en las pruebas); null la apaga. */
const usarVistaPrevia = fn => { leerPrevia = fn === undefined ? enlaces.vistaPrevia : fn; };
/** Esperar a que acaben las vistas previas que se están leyendo. */
const esperarPendientes = () => Promise.all([...pendientes]);

module.exports = {
  nombreCorto,
  canales, ficha, mensajes, uno, hilo, enviar, leido, crearCanal, directo, anadir, quitar, personas,
  editar, anular, reaccionar, fijar, fijados, guardar, guardados, convertirEnTarea,
  nombreDeCanal, primerEnlace, EMOJIS, olvidar, usarVistaPrevia, esperarPendientes,
};
