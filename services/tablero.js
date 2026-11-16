// ============================================================
// EL TABLERO DE TAREAS — el lugar único del trabajo pendiente (db/251)
// ============================================================
// Ítem 1 de docs/Hoja de ruta.md, entrega 1a (16/11/2026). Una tarjeta es algo
// que alguien tiene que hacer, con su responsable, su plazo en días hábiles y
// su historia. Lo que decidieron Camilo e Ignacio el 16/11/2026:
//
//   · A MANO (o desde el chat): cualquiera la crea, para otro o para sí, y
//     espera a que la apruebe quien tiene la función «tareas_aprueba»
//     (Ignacio). El plazo cuenta desde que la aprueba.
//   · DE UN TICKET: cada ticket nuevo crea su tarjeta «por asignar», y quien
//     tiene «tareas_asigna» (Ignacio) le pone responsable y plazo a mano. Cerrar
//     la tarjeta cierra el ticket, y al revés (modules/Ticketera/tarjetas.js).
//   · CERRAR NO PIDE APROBACIÓN: pasa a «cerrada» y ya.
//
// LAS COLUMNAS: por aprobar → por asignar → por hacer → en curso → bloqueada →
// cerrada (y, sin columna, rechazada y anulada).
//
// LOS TIPOS de tarjeta los registra cada módulo (`registrarTipo`): si pide
// aprobación, si se puede cerrar a mano y qué hace al cerrarse en su origen.
//
// QUIÉN VE QUÉ: cada uno, las suyas (de las que es responsable, las que creó y
// en las que colabora); quien lleva un área o es superior, las de su gente
// (organizacion.equipo); quien tiene «ve_todos_los_tableros» o reparte
// («tareas_asigna»), todas; quien aprueba, las que esperan su aprobación.
//
// CADA CAMBIO, dentro de una transacción firmada en el libro (A4), deja su
// evento en la historia de la tarjeta, y después avisa: contadores (A9),
// tiempo real (A7) y, lo que importa, una notificación al móvil (A8).
'use strict';

const libro = require('./libro');
const calendario = require('./calendario');
const organizacion = require('./organizacion');
const repo = require('./repo/tablero');
const contadores = require('./contadores');
const tiempoReal = require('./tiempoReal');
const tareasProgramadas = require('./tareasProgramadas');

const TRABAJANDO = ['por_hacer', 'en_curso', 'bloqueada'];
const ABIERTAS = ['por_aprobar', 'por_asignar', ...TRABAJANDO];
const FINALES = ['cerrada', 'rechazada', 'anulada'];
const ETIQUETA_ESTADO = {
  por_aprobar: 'Por aprobar', por_asignar: 'Por asignar', por_hacer: 'Por hacer', en_curso: 'En curso',
  bloqueada: 'Bloqueada', cerrada: 'Cerrada', rechazada: 'Rechazada', anulada: 'Anulada',
};
const URL_TABLERO = '/tablero';

function conEstado(e, status) { e.status = status; return e; }
const error = (msg, status = 400) => conEstado(new Error(msg), status);
const entero = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// ── Los tipos de tarjeta ───────────────────────────────────────────────────
const TIPOS = new Map();

/**
 * Un módulo dice cómo son sus tarjetas:
 *   aprobacion   true: nace «por aprobar» (las de a mano).
 *   cierreManual false: no se cierra desde el tablero; la cierra su origen (las
 *                colas de 1c: una J se cierra al aprobarla en su pantalla).
 *   alCerrar(tarea, { quien, nota, estadoOrigen }): lo que hace en su origen al
 *                cerrarla desde el tablero (un ticket: cerrar el ticket, que a
 *                su vez cierra la tarjeta). Sin él, se cierra aquí.
 *   alAsignar(tarea, { responsable, quien }): lo que hace en su origen.
 */
function registrarTipo(tipo, { etiqueta, aprobacion = false, cierreManual = true, alCerrar = null, alAsignar = null } = {}) {
  if (!/^[a-z][a-z_]{0,23}$/.test(String(tipo || ''))) throw new Error(`Tipo de tarjeta no válido: «${tipo}»`);
  TIPOS.set(tipo, { tipo, etiqueta: etiqueta || tipo, aprobacion, cierreManual, alCerrar, alAsignar });
}
const tipoDe = t => TIPOS.get(t) || { tipo: t, etiqueta: t, aprobacion: false, cierreManual: true };

registrarTipo('manual', { etiqueta: 'Tarea', aprobacion: true });

// ── Quién es quién ─────────────────────────────────────────────────────────
/** Lo que hace falta saber de quien mira para decidir qué ve y qué puede hacer. */
async function contexto(usuarioId) {
  const id = entero(usuarioId);
  if (!id) throw error('Sesión requerida', 401);
  const [aprueba, asigna, equipo] = await Promise.all([
    organizacion.tiene(id, 'tareas_aprueba'), organizacion.tiene(id, 'tareas_asigna'), organizacion.equipo(id),
  ]);
  return { id, aprueba, asigna, todos: !!equipo.todos || asigna, equipo: new Set(equipo.personas.map(p => p.id)) };
}

function puedeVer(ctx, t) {
  if (ctx.todos) return true;
  if (ctx.aprueba && t.estado === 'por_aprobar') return true;
  if (t.responsable_id === ctx.id || t.creada_por === ctx.id || (t.colaboradores || []).includes(ctx.id)) return true;
  return !!(t.responsable_id && ctx.equipo.has(t.responsable_id));
}

/** Lo que puede hacer con ella quien mira (la pantalla enseña solo eso). */
function permisos(ctx, t) {
  const tipo = tipoDe(t.tipo);
  const lleva = t.responsable_id === ctx.id;
  const viva = !FINALES.includes(t.estado);
  return {
    aprobar: ctx.aprueba && t.estado === 'por_aprobar',
    asignar: ctx.asigna && t.estado === 'por_asignar',
    reasignar: ctx.asigna && TRABAJANDO.includes(t.estado),
    cambiarPlazo: ctx.asigna && TRABAJANDO.includes(t.estado),
    mover: (lleva || ctx.asigna) && TRABAJANDO.includes(t.estado),
    cerrar: (lleva || ctx.asigna) && TRABAJANDO.includes(t.estado) && tipo.cierreManual,
    anular: viva && (ctx.asigna || (t.creada_por === ctx.id && t.estado === 'por_aprobar')),
    comentar: puedeVer(ctx, t),
    colaboradores: (lleva || ctx.asigna) && TRABAJANDO.includes(t.estado),
  };
}

async function exigirPersona(id) {
  const p = entero(id) ? await repo.persona(entero(id)) : null;
  if (!p || p.estado === 'bloqueado' || p.rol === 'conductor') throw error('Esa persona no puede llevar tarjetas (no existe, está bloqueada o es un conductor)');
  return p;
}

// ── El plazo ───────────────────────────────────────────────────────────────
/**
 * El plazo que se pide: `{ dias }` (días hábiles desde hoy, el de hoy no
 * cuenta) o `{ venceEl: 'aaaa-mm-dd' }`. → { plazoDias, venceEl } ya calculado.
 */
async function plazoDe({ plazoDias, venceEl } = {}, { obligatorio = true } = {}) {
  const cal = await calendario.de('madrid');
  const hoy = calendario.hoy();
  if (venceEl != null && venceEl !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(venceEl))) throw error('La fecha límite va como aaaa-mm-dd');
    if (venceEl < hoy) throw error('La fecha límite no puede ser anterior a hoy');
    return { plazoDias: Math.max(0, cal.diasHabilesEntre(hoy, venceEl)), venceEl: String(venceEl) };
  }
  if (plazoDias != null && plazoDias !== '') {
    const n = Number(plazoDias);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw error('El plazo va en días hábiles, de 0 a 365');
    return { plazoDias: n, venceEl: n === 0 ? cal.habilEnODespues(hoy) : cal.sumarDiasHabiles(hoy, n) };
  }
  if (obligatorio) throw error('Falta el plazo: en días hábiles o con una fecha límite');
  return { plazoDias: null, venceEl: null };
}

/** El semáforo y lo que queda, para la pantalla. Sin plazo o acabada, nada. */
async function semaforoDe(t, cal, hoy) {
  if (!t.vence_el || FINALES.includes(t.estado) || !TRABAJANDO.includes(t.estado)) return null;
  return { color: cal.semaforo(t.vence_el, hoy), quedan: cal.diasHabilesEntre(hoy, t.vence_el) };
}

// ── Lo que ve la pantalla ──────────────────────────────────────────────────
function publica(ctx, t, sem) {
  return {
    id: Number(t.id), tipo: t.tipo, tipoEtiqueta: tipoDe(t.tipo).etiqueta, origenId: t.origen_id,
    titulo: t.titulo, descripcion: t.sensible ? null : t.descripcion, enlace: t.enlace, sensible: t.sensible,
    estado: t.estado, estadoEtiqueta: ETIQUETA_ESTADO[t.estado],
    responsable: t.responsable_id ? { id: t.responsable_id, nombre: t.responsable_nombre } : null,
    creadaPor: t.creada_por ? { id: t.creada_por, nombre: t.creada_por_nombre } : null,
    creadaAt: t.creada_at,
    plazo: { dias: t.plazo_dias, venceEl: t.vence_el, desde: t.plazo_desde, semaforo: sem ? sem.color : null, quedan: sem ? sem.quedan : null },
    bloqueoMotivo: t.bloqueo_motivo, cerradaAt: t.cerrada_at, cierreNota: t.cierre_nota, motivoDemora: t.motivo_demora,
    colaboradores: (t.colaboradores || []).map(Number), comentarios: t.comentarios, actualizadaAt: t.actualizada_at,
    puede: permisos(ctx, t),
  };
}

/**
 * Las tarjetas de una vista: 'mias' (de las que es responsable, creó o
 * colabora), 'equipo' (las de su gente; todas si ve todos los tableros) o
 * 'pendientes' (las que esperan su aprobación o su asignación).
 */
async function listar(usuarioId, { vista = 'mias', acabadasDias = 14 } = {}) {
  const ctx = await contexto(usuarioId);
  const dias = Math.min(Math.max(Number(acabadasDias) || 14, 0), 90);
  let filas;
  if (vista === 'mias') filas = await repo.listar({ usuarioId: ctx.id, acabadasDias: dias });
  else if (vista === 'equipo') {
    filas = ctx.todos ? await repo.listar({ todas: true, acabadasDias: dias })
      : await repo.listar({ responsables: [...ctx.equipo], acabadasDias: dias });
  } else if (vista === 'pendientes') {
    const estados = [...(ctx.aprueba ? ['por_aprobar'] : []), ...(ctx.asigna ? ['por_asignar'] : [])];
    filas = estados.length ? await repo.listar({ estados, acabadasDias: 0 }) : [];
    filas = filas.filter(t => estados.includes(t.estado));
  } else throw error(`Vista desconocida: «${vista}»`);
  const cal = await calendario.de('madrid');
  const hoy = calendario.hoy();
  const visibles = filas.filter(t => puedeVer(ctx, t));
  return Promise.all(visibles.map(async t => publica(ctx, t, await semaforoDe(t, cal, hoy))));
}

/** Una tarjeta con su historia, sus comentarios y lo que se puede hacer con ella. */
async function ficha(usuarioId, id) {
  const ctx = await contexto(usuarioId);
  const t = entero(id) ? await repo.una(null, entero(id)) : null;
  if (!t || !puedeVer(ctx, t)) throw error('Esa tarjeta no existe o no es de las que puedes ver', 404);
  const cal = await calendario.de('madrid');
  const [eventos, comentarios] = await Promise.all([repo.eventos(t.id), repo.comentarios(t.id)]);
  return {
    ...publica(ctx, t, await semaforoDe(t, cal, calendario.hoy())),
    historia: eventos.map(e => ({ tipo: e.tipo, autor: e.autor_nombre, en: e.en, datos: e.datos, motivo: e.motivo })),
    comentariosLista: comentarios.map(c => ({ id: Number(c.id), autor: c.autor_nombre, autorId: c.autor_id, texto: c.texto, en: c.creado_at, mio: c.autor_id === ctx.id })),
  };
}

// ── Avisar ─────────────────────────────────────────────────────────────────
tiempoReal.registrarCanal('tablero', { etiqueta: 'Tablero de tareas', puede: async q => !!(q && q.id) });

let _push = null;
const push = () => (_push || (_push = require('./notificacionesPush')));

/** Quiénes tienen que enterarse de un cambio en una tarjeta. */
async function interesados(t) {
  const ids = new Set([t.responsable_id, t.creada_por, ...(t.colaboradores || [])].filter(Boolean).map(Number));
  const funciones = [];
  if (t.estado === 'por_aprobar') funciones.push('tareas_aprueba');
  funciones.push('tareas_asigna');
  for (const f of funciones) (await organizacion.quienes(f)).forEach(p => ids.add(p.id));
  return [...ids];
}

/**
 * Después de cambiar (ya fuera de la transacción): el tiempo real y los
 * contadores a los interesados, y la notificación a quien toque. Nunca lanza:
 * un aviso que no sale no deshace el cambio.
 */
async function avisar(id, { notificar = [], aviso = null } = {}) {
  try {
    const t = await repo.una(null, id);
    if (!t) return;
    const para = await interesados(t);
    tiempoReal.publicar('tablero', { id: Number(id), estado: t.estado }, { para });
    contadores.cambio('tareas', { para });
    const a = [...new Set(notificar.filter(Boolean).map(Number))];
    if (aviso && a.length) {
      await push().enviar(a, {
        titulo: aviso.titulo,
        cuerpo: t.sensible ? `${tipoDe(t.tipo).etiqueta}` : t.titulo,
        url: `${URL_TABLERO}?tarjeta=${id}`,
        etiqueta: `tarea-${id}`,
      });
    }
  } catch (e) {
    console.error(`❌ [Tablero] aviso de la tarjeta ${id}:`, e.message);
  }
}

// Escribir: transacción firmada, la tarjeta cogida, el cambio y su evento.
async function escribir(ctx, id, { accion, motivo } = {}, fn) {
  return libro.conFirma({ usuarioId: ctx.id, origen: 'tablero', accion, motivo }, async cli => {
    const t = await repo.una(cli, id, { bloquear: true });
    if (!t || !puedeVer(ctx, t)) throw error('Esa tarjeta no existe o no es de las que puedes ver', 404);
    return fn(cli, t);
  });
}

// ── Crear ──────────────────────────────────────────────────────────────────
/**
 * Una tarea a mano: para otra persona o para uno mismo, con responsable y
 * plazo. Espera la aprobación de «tareas_aprueba», salvo que la cree él.
 *   → la tarjeta
 */
async function crear(usuarioId, { titulo, descripcion, responsableId, plazoDias, venceEl } = {}, { tipo = 'manual', origenId = null } = {}) {
  const ctx = await contexto(usuarioId);
  const tit = texto(titulo, 200);
  if (!tit) throw error('Ponle un título a la tarea');
  const resp = await exigirPersona(responsableId);
  const plazo = await plazoDe({ plazoDias, venceEl });
  const conAprobacion = tipoDe(tipo).aprobacion && !ctx.aprueba;
  const id = await libro.conFirma({ usuarioId: ctx.id, origen: 'tablero', accion: 'alta' }, async cli => {
    const nueva = await repo.insertar(cli, {
      tipo, origenId, titulo: tit, descripcion: texto(descripcion, 4000) || null,
      estado: conAprobacion ? 'por_aprobar' : 'por_hacer', responsableId: resp.id, creadaPor: ctx.id,
      // Por aprobar, el plazo queda pedido en días y cuenta al aprobarla.
      plazoDias: plazo.plazoDias, venceEl: conAprobacion ? null : plazo.venceEl, plazoDesde: conAprobacion ? null : new Date(),
      aprobadaAt: conAprobacion ? null : new Date(), aprobadaPor: conAprobacion ? null : ctx.id,
    });
    await repo.evento(cli, nueva, { tipo: 'creada', autorId: ctx.id, datos: { responsable: resp.nombre, plazoDias: plazo.plazoDias, venceEl: plazo.venceEl } });
    if (!conAprobacion) await repo.evento(cli, nueva, { tipo: 'aprobada', autorId: ctx.id, datos: { porQuienLaCrea: true } });
    return nueva;
  });
  if (conAprobacion) {
    const aprobadores = (await organizacion.quienes('tareas_aprueba')).map(p => p.id);
    await avisar(id, { notificar: aprobadores, aviso: { titulo: 'Tarea por aprobar' } });
  } else {
    await avisar(id, { notificar: resp.id !== ctx.id ? [resp.id] : [], aviso: { titulo: 'Tienes una tarea nueva' } });
  }
  return ficha(ctx.id, id);
}

/**
 * Una tarjeta que nace de otra cosa (un ticket), sin pasar por nadie:
 * «por asignar», sin responsable ni plazo. Si ya tiene una viva, esa.
 * Va dentro de la transacción de quien la crea (`cli`). → id
 */
async function nacer(cli, { tipo, origenId, titulo, enlace, sensible = false, descripcion = null }) {
  const ya = await repo.porOrigen(cli, tipo, origenId);
  if (ya) return { id: Number(ya.id), nueva: false };
  const id = await repo.insertar(cli, { tipo, origenId, titulo: texto(titulo, 200) || tipoDe(tipo).etiqueta, enlace, sensible, descripcion, estado: 'por_asignar' });
  await repo.evento(cli, id, { tipo: 'creada', datos: { origen: tipo, origenId: String(origenId) } });
  return { id, nueva: true };
}

// ── Aprobar o rechazar (las de a mano) ─────────────────────────────────────
async function aprobar(usuarioId, id, { plazoDias, venceEl, responsableId } = {}) {
  const ctx = await contexto(usuarioId);
  let resp = null;
  const r = await escribir(ctx, entero(id), { accion: 'aprobacion' }, async (cli, t) => {
    if (!permisos(ctx, t).aprobar) throw error(t.estado === 'por_aprobar' ? 'Solo quien aprueba las tareas puede aprobarla' : `Ya no está por aprobar: está ${ETIQUETA_ESTADO[t.estado].toLowerCase()}`, 403);
    resp = responsableId ? await exigirPersona(responsableId) : await exigirPersona(t.responsable_id);
    // El plazo cuenta desde ahora: el pedido (en días), o el que ponga quien aprueba.
    const plazo = await plazoDe(plazoDias != null || venceEl ? { plazoDias, venceEl } : { plazoDias: t.plazo_dias });
    await repo.cambiar(cli, t.id, {
      estado: 'por_hacer', responsable_id: resp.id, plazo_dias: plazo.plazoDias, vence_el: plazo.venceEl,
      plazo_desde: new Date(), aprobada_at: new Date(), aprobada_por: ctx.id,
    });
    await repo.evento(cli, t.id, { tipo: 'aprobada', autorId: ctx.id, datos: { responsable: resp.nombre, plazoDias: plazo.plazoDias, venceEl: plazo.venceEl } });
    return t;
  });
  await avisar(r.id, { notificar: [resp.id, r.creada_por].filter(x => x !== ctx.id), aviso: { titulo: 'Tarea aprobada' } });
  return ficha(ctx.id, r.id);
}

async function rechazar(usuarioId, id, { motivo } = {}) {
  const ctx = await contexto(usuarioId);
  const m = texto(motivo, 2000);
  if (m.length < 3) throw error('Di por qué no se aprueba');
  const r = await escribir(ctx, entero(id), { accion: 'rechazo', motivo: m }, async (cli, t) => {
    if (!permisos(ctx, t).aprobar) throw error(t.estado === 'por_aprobar' ? 'Solo quien aprueba las tareas puede rechazarla' : `Ya no está por aprobar: está ${ETIQUETA_ESTADO[t.estado].toLowerCase()}`, 403);
    await repo.cambiar(cli, t.id, { estado: 'rechazada', cerrada_at: new Date(), cerrada_por: ctx.id, cierre_nota: m });
    await repo.evento(cli, t.id, { tipo: 'rechazada', autorId: ctx.id, motivo: m });
    return t;
  });
  await avisar(r.id, { notificar: [r.creada_por].filter(x => x && x !== ctx.id), aviso: { titulo: 'Tarea no aprobada' } });
  return ficha(ctx.id, r.id);
}

// ── Asignar y reasignar ────────────────────────────────────────────────────
/** La de un ticket (por asignar): responsable y plazo, los dos a mano y obligatorios. */
async function asignar(usuarioId, id, { responsableId, plazoDias, venceEl } = {}) {
  const ctx = await contexto(usuarioId);
  const resp = await exigirPersona(responsableId);
  const plazo = await plazoDe({ plazoDias, venceEl });
  const r = await escribir(ctx, entero(id), { accion: 'asignacion' }, async (cli, t) => {
    if (!permisos(ctx, t).asignar) throw error(t.estado === 'por_asignar' ? 'Solo quien reparte las tarjetas puede asignarla' : `Ya no está por asignar: está ${ETIQUETA_ESTADO[t.estado].toLowerCase()}`, 403);
    await repo.cambiar(cli, t.id, {
      estado: 'por_hacer', responsable_id: resp.id, plazo_dias: plazo.plazoDias, vence_el: plazo.venceEl,
      plazo_desde: new Date(), asignada_at: new Date(), asignada_por: ctx.id,
    });
    await repo.evento(cli, t.id, { tipo: 'asignada', autorId: ctx.id, datos: { responsable: resp.nombre, plazoDias: plazo.plazoDias, venceEl: plazo.venceEl } });
    return t;
  });
  const tipo = tipoDe(r.tipo);
  if (tipo.alAsignar) {
    try { await tipo.alAsignar(r, { responsable: resp, quien: ctx }); }
    catch (e) { console.error(`❌ [Tablero] al asignar la tarjeta ${r.id} en su origen:`, e.message); }
  }
  await avisar(r.id, { notificar: [resp.id].filter(x => x !== ctx.id), aviso: { titulo: 'Te han asignado una tarea' } });
  return ficha(ctx.id, r.id);
}

/** Pasarla a otra persona: con motivo, y se avisa a los dos. */
async function reasignar(usuarioId, id, { responsableId, motivo } = {}) {
  const ctx = await contexto(usuarioId);
  const m = texto(motivo, 2000);
  if (m.length < 3) throw error('Di por qué se reasigna: queda en su historia');
  const resp = await exigirPersona(responsableId);
  let antes = null;
  const r = await escribir(ctx, entero(id), { accion: 'reasignacion', motivo: m }, async (cli, t) => {
    if (!permisos(ctx, t).reasignar) throw error('Solo quien reparte las tarjetas puede reasignarla', 403);
    if (t.responsable_id === resp.id) throw error('Ya la lleva esa persona');
    antes = { id: t.responsable_id, nombre: t.responsable_nombre };
    await repo.cambiar(cli, t.id, { responsable_id: resp.id, asignada_at: new Date(), asignada_por: ctx.id });
    await repo.evento(cli, t.id, { tipo: 'reasignada', autorId: ctx.id, motivo: m, datos: { de: antes.nombre, a: resp.nombre } });
    return t;
  });
  const tipo = tipoDe(r.tipo);
  if (tipo.alAsignar) {
    try { await tipo.alAsignar(r, { responsable: resp, quien: ctx }); }
    catch (e) { console.error(`❌ [Tablero] al reasignar la tarjeta ${r.id} en su origen:`, e.message); }
  }
  await avisar(r.id, { notificar: [resp.id, antes.id].filter(x => x && x !== ctx.id), aviso: { titulo: 'Tarea reasignada' } });
  return ficha(ctx.id, r.id);
}

/** Cambiar el plazo: quien reparte, con motivo. Cuenta desde ahora. */
async function cambiarPlazo(usuarioId, id, { plazoDias, venceEl, motivo } = {}) {
  const ctx = await contexto(usuarioId);
  const m = texto(motivo, 2000);
  if (m.length < 3) throw error('Di por qué cambia el plazo: queda en su historia');
  const plazo = await plazoDe({ plazoDias, venceEl });
  const r = await escribir(ctx, entero(id), { accion: 'plazo', motivo: m }, async (cli, t) => {
    if (!permisos(ctx, t).cambiarPlazo) throw error('Solo quien reparte las tarjetas puede cambiar el plazo', 403);
    await repo.cambiar(cli, t.id, { plazo_dias: plazo.plazoDias, vence_el: plazo.venceEl, plazo_desde: new Date(), vencida_avisada_at: null });
    await repo.evento(cli, t.id, { tipo: 'plazo', autorId: ctx.id, motivo: m, datos: { antes: t.vence_el, plazoDias: plazo.plazoDias, venceEl: plazo.venceEl } });
    return t;
  });
  await avisar(r.id, { notificar: [r.responsable_id].filter(x => x && x !== ctx.id), aviso: { titulo: 'Te han cambiado el plazo de una tarea' } });
  return ficha(ctx.id, r.id);
}

// ── Moverla (por hacer, en curso, bloqueada) ───────────────────────────────
async function mover(usuarioId, id, { estado, motivo } = {}) {
  const ctx = await contexto(usuarioId);
  if (!TRABAJANDO.includes(estado)) throw error('Se mueve a «Por hacer», «En curso» o «Bloqueada». Para acabarla, «Cerrar»');
  const m = texto(motivo, 2000);
  if (estado === 'bloqueada' && m.length < 3) throw error('Di qué la bloquea: así quien reparte puede desbloquearla');
  const r = await escribir(ctx, entero(id), { accion: 'estado', motivo: m || null }, async (cli, t) => {
    if (!permisos(ctx, t).mover) throw error('Solo quien la lleva, o quien reparte las tarjetas, puede moverla', 403);
    if (t.estado === estado) return t;
    await repo.cambiar(cli, t.id, { estado, bloqueo_motivo: estado === 'bloqueada' ? m : null });
    await repo.evento(cli, t.id, { tipo: 'estado', autorId: ctx.id, motivo: m || null, datos: { de: t.estado, a: estado } });
    return t;
  });
  const asignadores = estado === 'bloqueada' ? (await organizacion.quienes('tareas_asigna')).map(p => p.id) : [];
  await avisar(r.id, { notificar: asignadores.filter(x => x !== ctx.id), aviso: { titulo: 'Tarea bloqueada' } });
  return ficha(ctx.id, r.id);
}

// ── Cerrar ─────────────────────────────────────────────────────────────────
/**
 * Hecha: a «cerrada», sin aprobación. Pasado el plazo, hay que decir por qué
 * (motivo de demora: lo mide el ítem 22). La de un ticket cierra el ticket, y
 * es el ticket el que la cierra a ella (modules/Ticketera/tarjetas.js).
 */
async function cerrar(usuarioId, id, { nota, motivoDemora, estadoOrigen } = {}) {
  const ctx = await contexto(usuarioId);
  const n = texto(nota, 4000);
  const demora = texto(motivoDemora, 2000);
  const t0 = entero(id) ? await repo.una(null, entero(id)) : null;
  if (!t0 || !puedeVer(ctx, t0)) throw error('Esa tarjeta no existe o no es de las que puedes ver', 404);
  const tipo = tipoDe(t0.tipo);
  if (!tipo.cierreManual) throw error(`Una tarjeta de «${tipo.etiqueta}» no se cierra desde el tablero: se cierra sola al resolverla en su pantalla`, 409);
  if (!permisos(ctx, t0).cerrar) throw error('Solo quien la lleva, o quien reparte las tarjetas, puede cerrarla', 403);
  if (n.length < 3) throw error('Di en qué quedó: queda en su historia');
  const vencida = t0.vence_el && calendario.hoy() > t0.vence_el;
  if (vencida && demora.length < 3) throw error(`Venció el ${t0.vence_el}: di por qué se cierra tarde (motivo de demora)`);

  if (tipo.alCerrar) {
    // En su origen; el origen la cierra aquí (cerrarPorOrigen). Si falla, no se cierra.
    await tipo.alCerrar(t0, { quien: ctx, nota: n, estadoOrigen });
    if (vencida) await escribir(ctx, t0.id, { accion: 'demora', motivo: demora }, async cli => repo.cambiar(cli, t0.id, { motivo_demora: demora }));
    return ficha(ctx.id, t0.id);
  }
  const r = await escribir(ctx, t0.id, { accion: 'cierre', motivo: n }, async (cli, t) => {
    if (!TRABAJANDO.includes(t.estado)) throw error(`Ya está ${ETIQUETA_ESTADO[t.estado].toLowerCase()}`, 409);
    await repo.cambiar(cli, t.id, { estado: 'cerrada', bloqueo_motivo: null, cerrada_at: new Date(), cerrada_por: ctx.id, cierre_nota: n, motivo_demora: vencida ? demora : null });
    await repo.evento(cli, t.id, { tipo: 'cerrada', autorId: ctx.id, motivo: n, datos: vencida ? { tarde: true, motivoDemora: demora } : {} });
    return t;
  });
  await avisar(r.id, { notificar: [r.creada_por].filter(x => x && x !== ctx.id), aviso: { titulo: 'Tarea hecha' } });
  return ficha(ctx.id, r.id);
}

/**
 * La cierra su origen (el ticket se cerró, la J se aprobó). Va dentro de la
 * transacción del origen si la hay (`cli`). Si ya estaba acabada, nada.
 */
async function cerrarPorOrigen(cli, { tipo, origenId, autorId = null, nota }) {
  const t = await repo.porOrigen(cli, tipo, origenId);
  if (!t || FINALES.includes(t.estado)) return null;
  const n = texto(nota, 4000) || 'Se resolvió en su origen';
  await repo.cambiar(cli, t.id, {
    estado: 'cerrada', bloqueo_motivo: null, cerrada_at: new Date(), cerrada_por: autorId || null, cierre_nota: n,
    // Sin responsable (por asignar, por aprobar): queda como lo cerró quien lo resolvió.
    responsable_id: t.responsable_id || autorId || null,
  });
  await repo.evento(cli, t.id, { tipo: 'cerrada', autorId, motivo: n, datos: { porSuOrigen: true } });
  return Number(t.id);
}

/**
 * La asigna su origen (alguien se hizo cargo del ticket en su bandeja): si
 * estaba por asignar, pasa a esa persona, sin plazo (lo pone quien reparte).
 */
async function asignarPorOrigen(cli, { tipo, origenId, responsableId, autorId = null }) {
  const t = await repo.porOrigen(cli, tipo, origenId);
  if (!t || t.estado !== 'por_asignar' || !responsableId) return null;
  await repo.cambiar(cli, t.id, { estado: 'por_hacer', responsable_id: responsableId, asignada_at: new Date(), asignada_por: autorId || null });
  await repo.evento(cli, t.id, { tipo: 'asignada', autorId, datos: { porSuOrigen: true } });
  return Number(t.id);
}

/** Anular: quien reparte, o quien la pidió mientras espera aprobación. Con motivo. */
async function anular(usuarioId, id, { motivo } = {}) {
  const ctx = await contexto(usuarioId);
  const m = texto(motivo, 2000);
  if (m.length < 3) throw error('Di por qué se anula: queda en su historia');
  const r = await escribir(ctx, entero(id), { accion: 'anulacion', motivo: m }, async (cli, t) => {
    if (!permisos(ctx, t).anular) throw error('Solo quien reparte las tarjetas (o quien la pidió, mientras espera aprobación) puede anularla', 403);
    await repo.cambiar(cli, t.id, { estado: 'anulada', bloqueo_motivo: null, cerrada_at: new Date(), cerrada_por: ctx.id, cierre_nota: m });
    await repo.evento(cli, t.id, { tipo: 'anulada', autorId: ctx.id, motivo: m });
    return t;
  });
  await avisar(r.id, { notificar: [r.responsable_id, r.creada_por].filter(x => x && x !== ctx.id), aviso: { titulo: 'Tarea anulada' } });
  return ficha(ctx.id, r.id);
}

// ── Comentarios y colaboradores ────────────────────────────────────────────
async function comentar(usuarioId, id, { texto: t } = {}) {
  const ctx = await contexto(usuarioId);
  const tx = texto(t, 4000);
  if (!tx) throw error('Escribe el comentario');
  const r = await escribir(ctx, entero(id), { accion: 'comentario' }, async (cli, tarea) => {
    await repo.comentar(cli, tarea.id, ctx.id, tx);
    return tarea;
  });
  await avisar(r.id);
  return ficha(ctx.id, r.id);
}

async function anularComentario(usuarioId, comentarioId, { motivo } = {}) {
  const ctx = await contexto(usuarioId);
  const m = texto(motivo, 500) || 'Lo quitó quien lo escribió';
  const c = entero(comentarioId) ? await repo.comentario(null, entero(comentarioId)) : null;
  if (!c || c.anulado_at) throw error('Ese comentario no existe', 404);
  if (c.autor_id !== ctx.id) throw error('Solo quien lo escribió puede quitarlo', 403);
  await escribir(ctx, Number(c.tarea_id), { accion: 'anulacion', motivo: m }, async cli => repo.anularComentario(cli, c.id, { por: ctx.id, motivo: m }));
  await avisar(Number(c.tarea_id));
  return ficha(ctx.id, Number(c.tarea_id));
}

async function colaborador(usuarioId, id, { usuarioId: otro, quitar = false } = {}) {
  const ctx = await contexto(usuarioId);
  const p = await exigirPersona(otro);
  const r = await escribir(ctx, entero(id), { accion: quitar ? 'baja' : 'alta' }, async (cli, t) => {
    if (!permisos(ctx, t).colaboradores) throw error('Solo quien la lleva, o quien reparte las tarjetas, decide quién colabora', 403);
    const hecho = quitar ? await repo.quitarColaborador(cli, t.id, p.id, ctx.id) : await repo.ponerColaborador(cli, t.id, p.id, ctx.id);
    if (hecho) await repo.evento(cli, t.id, { tipo: quitar ? 'colaborador_fuera' : 'colaborador', autorId: ctx.id, datos: { persona: p.nombre } });
    return t;
  });
  await avisar(r.id, { notificar: quitar || p.id === ctx.id ? [] : [p.id], aviso: { titulo: 'Te han añadido a una tarea' } });
  return ficha(ctx.id, r.id);
}

/** Para la pantalla: qué hace quien mira (si aprueba, si reparte, si lo ve todo). */
async function quienSoy(usuarioId) {
  const ctx = await contexto(usuarioId);
  return { id: ctx.id, aprueba: ctx.aprueba, asigna: ctx.asigna, todos: ctx.todos, equipo: ctx.equipo.size };
}

// ── Los números del menú (A9) ──────────────────────────────────────────────
contadores.registrarFuente('tareas', {
  async contar(quien) {
    if (!quien || !quien.id) return {};
    const [c, aprueba, asigna] = await Promise.all([
      repo.cuentas(quien.id, calendario.hoy()),
      organizacion.tiene(quien.id, 'tareas_aprueba'), organizacion.tiene(quien.id, 'tareas_asigna'),
    ]);
    const salida = {
      'tareas.mias': { n: c.mias, tono: c.vencidas ? 'aviso' : 'info',
        titulo: `${c.mias} ${c.mias === 1 ? 'tarea tuya' : 'tareas tuyas'}${c.vencidas ? `, ${c.vencidas} ${c.vencidas === 1 ? 'vencida' : 'vencidas'}` : ''}` },
    };
    if (aprueba) salida['tareas.por_aprobar'] = { n: c.por_aprobar, titulo: `${c.por_aprobar} por aprobar` };
    if (asigna) salida['tareas.por_asignar'] = { n: c.por_asignar, titulo: `${c.por_asignar} por asignar` };
    // La entrada «Tablero» del menú: las suyas y, a quien reparte o aprueba, lo
    // que espera por él. En rojo si hay algo vencido o esperándole.
    const espera = (aprueba ? c.por_aprobar : 0) + (asigna ? c.por_asignar : 0);
    salida['tareas.menu'] = {
      n: c.mias + espera, tono: c.vencidas || espera ? 'aviso' : 'info',
      titulo: [salida['tareas.mias'].titulo, espera ? `${espera} esperando que las apruebes o las repartas` : ''].filter(Boolean).join(' · '),
    };
    return salida;
  },
});

// ── Las que vencen: aviso al responsable y a su superior (A10) ─────────────
/**
 * Cada día hábil a las 09:00, las tarjetas que vencieron (pasó su último día
 * hábil) y aún no se avisaron: notificación al responsable y a su superior
 * (organizacion.superiorDe), y su evento. Una vez por tarjeta; si se le cambia
 * el plazo, vuelve a poder avisarse.
 */
async function avisarVencidas({ periodo, cli }) {
  const cal = await calendario.de('madrid');
  if (!cal.esHabil(periodo)) return { saltada: 'no es hábil' };
  const filas = await repo.vencidasSinAviso(cli, periodo);
  for (const t of filas) {
    await repo.cambiar(cli, t.id, { vencida_avisada_at: new Date() });
    await repo.evento(cli, t.id, { tipo: 'vencida', datos: { venceEl: t.vence_el } });
  }
  // Lo que sale fuera de la base, al final (la vez queda hecha con lo de arriba).
  let avisos = 0;
  for (const t of filas) {
    const sup = t.responsable_id ? await organizacion.superiorDe(t.responsable_id).catch(() => null) : null;
    const para = [t.responsable_id, sup && sup.id].filter(Boolean);
    if (!para.length) continue;
    await push().enviar(para, {
      titulo: 'Tarea vencida', cuerpo: t.sensible ? `Venció el ${t.vence_el}` : `${t.titulo} · venció el ${t.vence_el}`,
      url: `${URL_TABLERO}?tarjeta=${t.id}`, etiqueta: `tarea-${t.id}`, urgente: true,
    }).catch(e => console.error('❌ [Tablero] aviso de vencida:', e.message));
    avisos++;
  }
  if (filas.length) contadores.cambio('tareas');
  return { vencidas: filas.length, avisos };
}

tareasProgramadas.registrar({
  clave: 'tablero.vencidas',
  descripcion: 'Avisa al responsable y a su superior de las tarjetas que han vencido',
  desde: '2026-11-17',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '09:00' }),
  hacer: avisarVencidas,
});

module.exports = {
  TRABAJANDO, ABIERTAS, FINALES, ETIQUETA_ESTADO,
  registrarTipo, listar, ficha, crear, nacer, aprobar, rechazar, asignar, reasignar, cambiarPlazo, mover,
  cerrar, cerrarPorOrigen, asignarPorOrigen, anular, comentar, anularComentario, colaborador, avisar,
  personas: () => repo.personas(), quienSoy,
  // Para las pruebas:
  plazoDe, avisarVencidas, contexto, permisos,
};
