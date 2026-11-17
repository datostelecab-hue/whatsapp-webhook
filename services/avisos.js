// ============================================================
// LOS AVISOS ENTRE MÓDULOS — ítem 3 de la hoja de ruta (db/254)
// ============================================================
// Cuando un módulo genera algo que afecta a otro, AVISA AL ÁREA que le toca, y
// el aviso se queda hasta que alguien lo resuelve. Lo que decidió Camilo el
// 16/11/2026:
//
//   · EL DESTINO ES UN ÁREA DE ORGANIZACIÓN (Control, Taller, RR. HH.…): le
//     llega a su gente y a su responsable (organizacion.deArea). O a una
//     persona concreta. Un área vacía se la queda quien reparte (Ignacio).
//   · LEÍDO, CADA UNO EL SUYO (aviso_lectura); RESUELTO, DE TODOS, con quién,
//     cuándo y en qué quedó.
//   · SE RESUELVE SOLO SI SE PUEDE (su módulo sabe que ya está); si no, a mano
//     con una nota. Con hora (una cita), CADUCA al pasar.
//   · Se ve en LA CAMPANA, con su número en la entrada del módulo en el menú
//     (contadores A9: `avisos.<módulo>` y `avisos.sin_leer`), al momento
//     (tiempo real A7, canal «avisos») y, si es urgente, en el móvil (A8).
//
// CÓMO LO USA UN MÓDULO. Dos formas:
//
//   1. Emitirlo cuando pasa algo (y cerrarlo cuando se resuelve):
//        avisos.registrarTipo('j_rechazada', { etiqueta: 'J rechazada', modulo: 'control', icono: 'fa-file-circle-xmark' });
//        await avisos.emitir({ tipo: 'j_rechazada', origenId: j.id, area: 'control', titulo, texto, enlace });
//        await avisos.resolverPorOrigen({ tipo: 'j_rechazada', origenId: j.id, nota: 'Se llamó' });
//
//   2. Que se REPASE SOLO (como las colas del tablero): el tipo dice qué está
//      pendiente en su módulo y cómo acabó lo que ya no; aquí se emite lo que
//      falte y se cierra lo resuelto. El módulo pide un repaso al cambiar algo
//      (`pedir(tipo)`) y hay uno cada día. Así lo hacen las citas del taller
//      (modules/Vehiculos/avisosCitas.js).
//
// Un aviso por cosa de origen y tipo, en toda su vida: emitirlo dos veces no lo
// duplica y, si alguien lo resolvió a mano, el repaso no lo vuelve a sacar.
'use strict';

const libro = require('./libro');
const organizacion = require('./organizacion');
const repo = require('./repo/avisos');
const contadores = require('./contadores');
const tiempoReal = require('./tiempoReal');
const tareasProgramadas = require('./tareasProgramadas');

function conEstado(e, status) { e.status = status; return e; }
const error = (msg, status = 400) => conEstado(new Error(msg), status);
const entero = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// ── Los tipos de aviso ─────────────────────────────────────────────────────
const TIPOS = new Map();

/**
 * Un módulo dice cómo son sus avisos:
 *   etiqueta  'Cita del taller'       modulo  'taller' (su número sale en la entrada del menú de ese módulo)
 *   icono     'fa-screwdriver-wrench' area    el área a la que van por defecto
 *   urgente   true: además, notificación al móvil
 * Y, si se repasa solo:
 *   abiertos()        → [{ origenId, titulo, texto, enlace, caducaAt, area?, usuarioId? }]: lo que tiene que estar avisado
 *   comoAcabaron(ids) → Map origenId → { estado: 'resuelto' | 'caducado' | 'anulado', nota, autorId }
 */
function registrarTipo(tipo, def = {}) {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(String(tipo || ''))) throw new Error(`Tipo de aviso no válido: «${tipo}»`);
  if (!/^[a-z][a-z0-9_]{0,29}$/.test(String(def.modulo || ''))) throw new Error(`${tipo}: falta el módulo`);
  if (TIPOS.has(tipo)) throw new Error(`El tipo de aviso «${tipo}» ya está registrado`);
  if ((def.abiertos && !def.comoAcabaron) || (!def.abiertos && def.comoAcabaron)) throw new Error(`${tipo}: «abiertos» y «comoAcabaron» van juntos`);
  TIPOS.set(tipo, { tipo, etiqueta: def.etiqueta || tipo, modulo: def.modulo, icono: def.icono || 'fa-bell',
    area: def.area || null, urgente: !!def.urgente, abiertos: def.abiertos || null, comoAcabaron: def.comoAcabaron || null });
}
const tipoDe = t => TIPOS.get(t) || { tipo: t, etiqueta: t, modulo: 'general', icono: 'fa-bell', urgente: false };

// ── A quién le llega ───────────────────────────────────────────────────────
async function destinatarios(a) {
  const ids = new Set();
  if (a.usuario_id) ids.add(Number(a.usuario_id));
  if (a.area_codigo) (await organizacion.deArea(a.area_codigo)).forEach(id => ids.add(Number(id)));
  return [...ids];
}

tiempoReal.registrarCanal('avisos', { etiqueta: 'Avisos entre módulos', puede: async q => !!(q && q.id) });

let _push = null;
const push = () => (_push || (_push = require('./notificacionesPush')));

/**
 * Después de un cambio, ya fuera de la transacción: el tiempo real y los
 * contadores a quien le llega y, si acaba de nacer urgente, la notificación al
 * móvil. Nunca lanza: un aviso que no sale no deshace nada.
 */
async function avisar(id, { nuevo = false } = {}) {
  try {
    const a = await repo.uno(null, id);
    if (!a) return;
    const para = await destinatarios(a);
    if (!para.length) return;
    tiempoReal.publicar('avisos', { id: Number(id), estado: a.estado }, { para });
    contadores.cambio('avisos', { para });
    if (nuevo && a.urgente && a.estado === 'abierto') {
      await push().enviar(para, { titulo: a.titulo, cuerpo: a.texto || tipoDe(a.tipo).etiqueta, url: a.enlace || '/', etiqueta: `aviso-${id}`, urgente: true });
    }
  } catch (e) {
    console.error(`❌ [Avisos] al avisar del aviso ${id}:`, e.message);
  }
}

// ── Emitir y cerrar (los módulos) ──────────────────────────────────────────
/**
 * Un aviso nuevo. `area` (un área de Organización) y/o `usuarioId`. Si ya hay
 * uno de esa cosa de origen (en cualquier estado), ese: no se duplica.
 *   → { id, nuevo }
 * Con `cli` va dentro de la transacción de quien lo emite, y entonces es él quien
 * llama a `avisos.avisar(id, { nuevo: true })` cuando la cierre.
 */
async function emitir({ tipo, origenId = null, titulo, texto: txt = null, enlace = null, area = null, usuarioId = null,
  urgente = null, caducaAt = null, autorId = null } = {}, { cli = null } = {}) {
  const t = TIPOS.get(tipo);
  if (!t) throw error(`Tipo de aviso sin registrar: «${tipo}»`);
  const tit = texto(titulo, 200);
  if (!tit) throw error('Un aviso necesita un título');
  const destinoArea = area || t.area || null;
  const destinoPersona = entero(usuarioId);
  if (!destinoArea && !destinoPersona) throw error('Un aviso va a un área o a una persona');
  if (enlace && !/^\/[^/]/.test(String(enlace))) throw error('El enlace de un aviso es una ruta del ERP');
  const datos = {
    tipo, modulo: t.modulo, origenId, titulo: tit, texto: texto(txt, 2000) || null, enlace: enlace ? texto(enlace, 300) : null,
    urgente: urgente == null ? t.urgente : !!urgente, area: destinoArea, usuarioId: destinoPersona,
    caducaAt: caducaAt || null, creadoPor: entero(autorId),
  };
  const hacer = async c => {
    if (origenId != null) {
      const ya = await repo.porOrigen(c, tipo, origenId);
      if (ya) return { id: Number(ya.id), nuevo: false };
    }
    return { id: await repo.insertar(c, datos), nuevo: true };
  };
  if (cli) return hacer(cli);
  const r = await libro.conFirma({ usuarioId: entero(autorId), origen: 'avisos', accion: 'alta' }, hacer);
  if (r.nuevo) await avisar(r.id, { nuevo: true });
  return r;
}

/**
 * Lo cierra su módulo: la cosa se resolvió (o caducó, o ya no aplica). Si no
 * había aviso abierto, nada. → id o null
 */
async function resolverPorOrigen({ tipo, origenId, nota = null, autorId = null, estado = 'resuelto' } = {}, { cli = null } = {}) {
  if (!['resuelto', 'caducado', 'anulado'].includes(estado)) throw error('Un aviso acaba resuelto, caducado o anulado');
  const hacer = async c => {
    const a = await repo.porOrigen(c, tipo, origenId);
    if (!a || a.estado !== 'abierto') return null;
    const hecho = await repo.cerrar(c, a.id, { estado, por: entero(autorId), solo: true, nota: texto(nota, 2000) || null });
    return hecho ? Number(a.id) : null;
  };
  if (cli) return hacer(cli);
  const id = await libro.conFirma({ usuarioId: entero(autorId), origen: 'avisos', accion: 'resolucion' }, hacer);
  if (id) await avisar(id);
  return id;
}

// ── Lo que hace una persona (la campana) ───────────────────────────────────
async function alcance(usuarioId) {
  const id = entero(usuarioId);
  if (!id) throw error('Sesión requerida', 401);
  return { id, areas: await organizacion.areasDeAvisos(id) };
}

function publico(a) {
  const t = tipoDe(a.tipo);
  return {
    id: Number(a.id), tipo: a.tipo, etiqueta: t.etiqueta, icono: t.icono, modulo: a.modulo,
    titulo: a.titulo, texto: a.texto, enlace: a.enlace, urgente: a.urgente,
    area: a.area_codigo, paraMi: !!a.usuario_id,
    creadoAt: a.creado_at, caducaAt: a.caduca_at, leido: !!a.leido,
  };
}

/** Los avisos vivos de quien mira, con si los ha leído. */
async function mios(usuarioId) {
  const { id, areas } = await alcance(usuarioId);
  const filas = await repo.vivosDe(id, areas);
  const etiquetas = new Map();
  for (const a of filas) {
    if (a.area_codigo && !etiquetas.has(a.area_codigo)) etiquetas.set(a.area_codigo, await organizacion.etiquetaDeArea(a.area_codigo));
  }
  const avisos = filas.map(a => ({ ...publico(a), areaEtiqueta: a.area_codigo ? etiquetas.get(a.area_codigo) : null }));
  return { avisos, sinLeer: avisos.filter(a => !a.leido).length };
}

/** Leídos: unos (`ids`) o todos los suyos. Solo los suyos y vivos. */
async function marcarLeidos(usuarioId, { ids = null } = {}) {
  const { id, areas } = await alcance(usuarioId);
  let lista;
  if (ids == null) lista = (await repo.vivosDe(id, areas, { limite: 1000 })).map(a => Number(a.id));
  else lista = await repo.suyosEntre(id, areas, [...new Set([].concat(ids).map(entero).filter(Boolean))]);
  const n = await repo.leer(id, lista);
  if (n) contadores.cambio('avisos', { para: [id] });
  return { leidos: n };
}

/** Resuelto a mano, con una nota: desaparece para todos los que lo reciben. */
async function resolver(usuarioId, avisoId, { nota } = {}) {
  const { id, areas } = await alcance(usuarioId);
  const n = texto(nota, 2000);
  if (n.length < 3) throw error('Di en qué quedó: lo leerán los demás');
  const aid = entero(avisoId);
  const suyo = aid ? await repo.suyosEntre(id, areas, [aid]) : [];
  if (!suyo.length) throw error('Ese aviso no existe, ya está resuelto o no es de los tuyos', 404);
  const hecho = await libro.conFirma({ usuarioId: id, origen: 'avisos', accion: 'resolucion', motivo: n },
    cli => repo.cerrar(cli, aid, { estado: 'resuelto', por: id, solo: false, nota: n }));
  if (!hecho) throw error('Ese aviso ya está resuelto', 409);
  await repo.leer(id, [aid]);
  await avisar(aid);
  return { ok: true };
}

// ── Los números (A9) ───────────────────────────────────────────────────────
// `avisos.sin_leer`: todos (la campana). `avisos.<módulo>`: los de cada módulo
// (su entrada en el menú). En rojo si hay alguno urgente; si no, en azul.
contadores.registrarFuente('avisos', {
  async contar(quien) {
    if (!quien || !quien.id) return {};
    const areas = await organizacion.areasDeAvisos(quien.id);
    const filas = await repo.sinLeer(quien.id, areas);
    const salida = {};
    let n = 0, urgentes = 0;
    for (const f of filas) {
      n += f.n; urgentes += f.urgentes;
      salida[`avisos.${f.modulo}`] = { n: f.n, tono: f.urgentes ? 'aviso' : 'info', titulo: `${f.n} ${f.n === 1 ? 'aviso sin leer' : 'avisos sin leer'}` };
    }
    salida['avisos.sin_leer'] = { n, tono: urgentes ? 'aviso' : 'info', titulo: n ? `${n} ${n === 1 ? 'aviso sin leer' : 'avisos sin leer'}` : 'Sin avisos' };
    return salida;
  },
});

// ── Los que se repasan solos ───────────────────────────────────────────────
async function sincronizar(tipo) {
  const t = TIPOS.get(tipo);
  if (!t || !t.abiertos) throw new Error(`El aviso «${tipo}» no se repasa solo`);
  const items = await t.abiertos();
  const pendientes = new Set(items.map(i => String(i.origenId)));
  const ya = new Set((await repo.deOrigenes(tipo, [...pendientes])).map(a => String(a.origen_id)));
  const cuenta = { emitidos: 0, cerrados: 0 };
  // Lo que falta: un aviso por cosa en toda su vida (lo resuelto a mano no vuelve).
  for (const it of items) {
    if (ya.has(String(it.origenId))) continue;
    const r = await emitir({ ...it, tipo });
    if (r.nuevo) cuenta.emitidos++;
  }
  // Lo abierto que ya no está pendiente en su módulo: se cerró allí.
  const acabados = (await repo.abiertosDe(tipo)).filter(a => !pendientes.has(String(a.origen_id)));
  if (acabados.length) {
    const como = await t.comoAcabaron(acabados.map(a => String(a.origen_id)));
    for (const a of acabados) {
      const c = como.get(String(a.origen_id)) || { estado: 'resuelto', nota: 'Ya no está pendiente en su módulo' };
      if (await resolverPorOrigen({ tipo, origenId: a.origen_id, nota: c.nota, autorId: c.autorId || null, estado: c.estado || 'resuelto' })) cuenta.cerrados++;
    }
  }
  return cuenta;
}

// Un repaso a la vez por tipo; lo pedido mientras tanto, al acabar. Nunca lanza.
const enMarcha = new Map();
function pedir(tipo) {
  const t = TIPOS.get(tipo);
  if (!t || !t.abiertos) return Promise.resolve(null);
  const ya = enMarcha.get(tipo);
  if (ya) { ya.otraVez = true; return ya.promesa; }
  const e = { otraVez: false, promesa: null };
  enMarcha.set(tipo, e);
  e.promesa = (async () => {
    let r = null;
    try {
      do {
        e.otraVez = false;
        try { r = await sincronizar(tipo); } catch (err) { console.error(`❌ [Avisos] repaso de «${tipo}»:`, err.message); r = null; }
      } while (e.otraVez);
    } finally {
      enMarcha.delete(tipo);
    }
    return r;
  })();
  return e.promesa;
}
const esperar = () => Promise.all([...enMarcha.values()].map(e => e.promesa));

/** El repaso de cada día: caducar lo que pasó su hora y repasar los tipos que lo hacen solos. */
async function repasoDiario({ cli } = {}) {
  const caducados = await repo.caducar(cli || null);
  const salida = { caducados: caducados.length };
  for (const [tipo, t] of TIPOS) {
    if (!t.abiertos) continue;
    try {
      const r = await sincronizar(tipo);
      salida[`${tipo}.emitidos`] = r.emitidos;
      salida[`${tipo}.cerrados`] = r.cerrados;
    } catch (e) {
      salida[`${tipo}.fallo`] = String(e.message).slice(0, 150);
    }
  }
  if (caducados.length) contadores.cambio('avisos');
  return salida;
}

tareasProgramadas.registrar({
  clave: 'avisos.repaso',
  descripcion: 'Cierra los avisos que pasaron su hora y repasa los que se emiten solos (citas del taller…)',
  desde: '2026-11-17',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '05:10' }),
  hacer: repasoDiario,
});

module.exports = {
  registrarTipo, emitir, resolverPorOrigen, avisar,
  mios, marcarLeidos, resolver,
  sincronizar, pedir, esperar, repasoDiario,
  tipos: () => [...TIPOS.keys()],
};
