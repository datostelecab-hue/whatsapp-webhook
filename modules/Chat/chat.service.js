// ============================================================
// EL CHAT INTERNO — ítem 2 de la hoja de ruta, entrega 2a (db/256)
// ============================================================
// «Reemplazar Slack por un chat dentro del ERP, con sus mismas funciones.» Solo
// para la oficina. La 2a: canales públicos y privados, mensajes directos (de 1 a
// 1 y de grupo), tiempo real, no leídos, menciones e hilos. Lo que decidió
// Camilo el 17/11/2026:
//
//   · LOS PÚBLICOS, DE TODA LA OFICINA, también los de bajas médicas, nóminas,
//     RR. HH. y efectivo; y toda la oficina DENTRO de todos (quien llega
//     después, entra solo: asegurarPublicos).
//   · LOS PRIVADOS Y LOS DIRECTOS, solo de quien está dentro: a cualquier otro,
//     un 404 (ni sabe que existen).
//   · CREAN, ARCHIVAN Y RENOMBRAN CANALES los puestos de Dirección y Desarrollo
//     (función de Organización «chat_canales»). A un privado añade gente
//     quien está dentro; quita gente quien lo creó o quien lleva los canales.
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
// del canal y mueve sus contadores (A9). Las notificaciones al móvil llegan con
// la 2c, junto al «no molestar».
'use strict';

const libro = require('../../services/libro');
const organizacion = require('../../services/organizacion');
const contadores = require('../../services/contadores');
const tiempoReal = require('../../services/tiempoReal');
const repo = require('./chat.repo');

function conEstado(e, status) { e.status = status; return e; }
const error = (msg, status = 400) => conEstado(new Error(msg), status);
const entero = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const MAX_TEXTO = 8000;
const MAX_DIRECTO = 9;   // como Slack: un directo de grupo, de hasta 9 personas
const NO_ESTA = 'Ese canal no existe o no estás en él';

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
    yo: { id: ctx.id, puedeCrear: puede },
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
  const [gente, gestiona] = await Promise.all([repo.miembros(null, c.id), puedeGestionar(ctx.id)]);
  const otros = c.tipo === 'directo' ? gente.filter(p => Number(p.id) !== ctx.id) : null;
  return {
    id: Number(c.id), tipo: c.tipo, nombre: c.nombre, titulo: tituloDe(c, otros), tema: c.tema, descripcion: c.descripcion,
    creadoPor: c.creado_por_nombre || null, creadoAt: c.creado_at, archivado: !!c.archivado_at,
    miembros: gente.map(p => ({ id: Number(p.id), nombre: p.nombre, puesto: p.puesto })),
    dentro,
    puede: {
      escribir: !c.archivado_at && (dentro || c.tipo === 'publico'),
      anadir: c.tipo === 'privado' && !c.archivado_at && (dentro || gestiona),
      quitar: c.tipo === 'privado' && !c.archivado_at && (gestiona || c.creado_por === ctx.id),
    },
  };
}

async function conMenciones(filas) {
  const m = await repo.mencionesDe(filas.map(x => Number(x.id)));
  return filas.map(x => publico(x, m.get(Number(x.id))));
}
function publico(x, menciones) {
  return {
    id: Number(x.id), canalId: Number(x.canal_id), autorId: x.autor_id, autor: x.autor || 'Telecab',
    padreId: x.padre_id ? Number(x.padre_id) : null, creadoAt: x.creado_at,
    texto: x.texto, anulado: !!x.anulado_at, editado: !!x.editado_at,
    respuestas: x.respuestas, ultimaRespuestaAt: x.ultima_respuesta_at,
    menciones: menciones || { usuarios: [], todos: false },
  };
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
  return { mensajes: await conMenciones(filas), hayMas, ultimoLeido: yo ? Number(yo.ultimo_leido_id) : 0 };
}

/** Un mensaje (para refrescar las respuestas de un hilo que acaba de crecer). */
async function uno(usuarioId, mensajeId) {
  const ctx = await contexto(usuarioId);
  const m = entero(mensajeId) ? await repo.mensaje(null, entero(mensajeId)) : null;
  if (!m) throw error('Ese mensaje no existe', 404);
  await acceso(ctx, m.canal_id);
  return { mensaje: (await conMenciones([m]))[0] };
}

/** Un hilo: el mensaje de arriba y sus respuestas. */
async function hilo(usuarioId, mensajeId) {
  const ctx = await contexto(usuarioId);
  let raiz = entero(mensajeId) ? await repo.mensaje(null, entero(mensajeId)) : null;
  if (!raiz) throw error('Ese mensaje no existe', 404);
  if (raiz.padre_id) raiz = await repo.mensaje(null, Number(raiz.padre_id));
  await acceso(ctx, raiz.canal_id);
  const [r] = await conMenciones([raiz]);
  return { raiz: r, respuestas: await conMenciones(await repo.respuestas(Number(raiz.id))) };
}

// ── Escribir ───────────────────────────────────────────────────────────────
/**
 * Un mensaje (o la respuesta de un hilo con `padreId`). Las menciones van en
 * el texto: <@id> y <!canal>. En un privado o un directo solo cuenta la
 * mención a quien está dentro (el resto no lo podría leer).
 */
async function enviar(usuarioId, canalId, { texto: txt, padreId = null } = {}) {
  const ctx = await contexto(usuarioId);
  const t = String(txt == null ? '' : txt).replace(/\r\n/g, '\n').trim();
  if (!t) throw error('Escribe el mensaje');
  if (t.length > MAX_TEXTO) throw error(`Un mensaje no puede pasar de ${MAX_TEXTO} caracteres`);
  const { canal: c, dentro } = await acceso(ctx, canalId);
  if (c.archivado_at) throw error('Ese canal está archivado: ya no se escribe en él', 409);

  const r = await libro.conFirma({ usuarioId: ctx.id, origen: 'chat', accion: 'alta' }, async cli => {
    // Escribir en un público del que salió le vuelve a meter.
    if (!dentro) await repo.meter(cli, c.id, ctx.id, ctx.id);
    let padre = null;
    if (padreId) {
      const p = await repo.mensaje(cli, entero(padreId));
      if (!p || Number(p.canal_id) !== Number(c.id)) throw error('Ese hilo no es de este canal', 404);
      padre = p.padre_id ? Number(p.padre_id) : Number(p.id);
    }
    const id = await repo.escribir(cli, { canalId: c.id, autorId: ctx.id, padreId: padre, texto: t });
    const dentroAhora = new Set(await repo.idsMiembros(cli, c.id));
    const mencionados = [...new Set([...t.matchAll(/<@(\d{1,9})>/g)].map(m => Number(m[1])))]
      .filter(u => u !== ctx.id && (c.tipo === 'publico' || dentroAhora.has(u)));
    const deLaOficina = [];
    for (const u of mencionados) if (await repo.esDeLaOficina(u)) deLaOficina.push(u);
    const todos = /<!canal>/.test(t);
    if (deLaOficina.length || todos) await repo.mencionar(cli, id, { usuarios: deLaOficina, todos });
    return { id, padre, para: [...dentroAhora] };
  });
  avisar(c.id, r.para, { id: r.id, padre: r.padre });
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
  return { ok: true };
}

const personas = async usuarioId => { await contexto(usuarioId); return { personas: (await repo.personas()).map(p => ({ id: Number(p.id), nombre: p.nombre, puesto: p.puesto })) }; };

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

/** Para las pruebas: olvidar a quién ya se metió en los públicos. */
const olvidar = () => asegurados.clear();

module.exports = {
  canales, ficha, mensajes, uno, hilo, enviar, leido, crearCanal, directo, anadir, quitar, personas,
  nombreDeCanal, olvidar,
};
