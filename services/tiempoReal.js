// ============================================================
// TIEMPO REAL — el servidor avisa a las pantallas abiertas (A7)
// ============================================================
// Pieza A7 de docs/Hoja de ruta.md (16/11/2026). Hasta aquí cada pantalla
// preguntaba cada pocos segundos si había algo nuevo (de 3 s a 5 min). Ahora el
// servidor lo AVISA en cuanto pasa, por una conexión que la pantalla deja
// abierta (Server-Sent Events: GET /tiempo-real/eventos, en modules/TiempoReal).
//
//   // 1. El módulo registra su canal UNA vez (al cargarse), y dice quién lo oye:
//   tiempoReal.registrarCanal('tickets', {
//     etiqueta: 'Tickets',
//     puede: async quien => …,            // quien = { id, rol }
//   });
//
//   // 2. Cuando algo cambia, lo avisa. A todos los que oyen el canal, o solo a
//   //    unos (`para`, ids de usuario):
//   tiempoReal.publicar('tickets', { id: 42, que: 'nuevo' });
//   tiempoReal.publicar('tickets', { id: 42 }, { para: [7, 19] });
//
//   // 3. La pantalla, con el componente de la casa (public/assets/js/tiempoReal.js):
//   TiempoReal.escuchar('tickets', { alLlegar: d => recargar(), sondear: recargar, cada: 30000 });
//
// EL AVISO DICE QUÉ CAMBIÓ, NO LOS DATOS: «el ticket 42 es nuevo», y la pantalla
// los pide a su API, que mira el permiso como siempre. Por eso hay un tope de
// 16 KB por aviso.
//
// SI SE CORTA, NO SE PIERDE NADA: cada aviso lleva un id y se guardan los de
// los últimos 10 minutos (hasta 1000). Al volver, el navegador dice el último
// que vio (Last-Event-ID) y se le mandan los que faltan. Si ya no están (más de
// 10 minutos fuera, o el servidor se ha reiniciado: el id lleva la marca de
// este proceso), se le dice «reinicio» y la pantalla se pone al día entera.
//
// UNA SOLA INSTANCIA: el bus está en memoria, que es lo que hay en Render. Con
// más de una, los avisos tendrían que pasar por la base (LISTEN/NOTIFY); está
// apuntado en docs/nucleo/Tiempo real.md.
'use strict';

const crypto = require('crypto');

// La marca de este proceso: un id de otro arranque no se puede continuar.
const ARRANQUE = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

const AJUSTES = {
  guardarMs: 10 * 60 * 1000,     // cuánto se guardan los avisos para quien vuelve
  maxGuardados: 1000,
  latidoMs: 25000,               // Cloudflare corta a los 100 s sin un byte
  revisarSesionMs: 2 * 60 * 1000, // cada cuánto se mira que la sesión siga abierta
  maxPorUsuario: 12,             // pestañas a la vez; con más, se cierra la más vieja
  maxTotal: 1000,
  maxPendiente: 1024 * 1024,     // lo que puede quedar sin salir hacia un navegador lento
  maxAviso: 16 * 1024,
};

/** Para las pruebas: latidos y revisiones en milisegundos, no en minutos. */
function configurar(cambios) {
  Object.assign(AJUSTES, cambios || {});
  reloj();
}

// ── Los canales ────────────────────────────────────────────────────────────
const CANALES = new Map();
const NOMBRE_VALIDO = /^[a-z][a-z0-9_.-]{0,59}$/;

/**
 * Un módulo abre un canal y dice quién lo oye. `puede(quien)` contesta sí o no
 * (quien = { id, rol }); ante la duda, no. Se pregunta al conectar y cada vez
 * que se revisa la sesión: quien pierde el permiso deja de oírlo.
 */
function registrarCanal(nombre, { etiqueta, puede } = {}) {
  if (!NOMBRE_VALIDO.test(String(nombre || ''))) throw new Error(`Nombre de canal de tiempo real no válido: «${nombre}»`);
  if (typeof puede !== 'function') throw new Error(`El canal «${nombre}» tiene que decir quién lo oye (puede)`);
  CANALES.set(nombre, { nombre, etiqueta: etiqueta || nombre, puede });
}

/** De los canales pedidos, los que puede oír y los que no (que no existen o sin permiso). */
async function canalesDe(pedidos, quien) {
  const aceptados = [];
  const rechazados = [];
  for (const nombre of [...new Set(pedidos)]) {
    const canal = CANALES.get(nombre);
    let si = false;
    if (canal && quien && quien.id) {
      try { si = !!(await canal.puede(quien)); } catch (e) {
        console.error(`❌ [Tiempo real] ${nombre}.puede:`, e.message);
      }
    }
    (si ? aceptados : rechazados).push(nombre);
  }
  return { aceptados, rechazados };
}

// ── Los avisos ─────────────────────────────────────────────────────────────
let ultimo = 0;
const guardados = [];   // { n, canal, marco, para: Set|null, en }

const idDe = n => `${ARRANQUE}-${n}`;
function leerId(texto) {
  const m = /^([a-z0-9]+)-(\d{1,15})$/.exec(String(texto || '').trim());
  return m ? { arranque: m[1], n: Number(m[2]) } : null;
}

const llegaA = (aviso, c) => c.canales.has(aviso.canal) && (!aviso.para || aviso.para.has(c.quien.id));

function podar() {
  const limite = Date.now() - AJUSTES.guardarMs;
  while (guardados.length > AJUSTES.maxGuardados || (guardados.length && guardados[0].en < limite)) guardados.shift();
}

/**
 * Avisa a quien oiga el canal (o solo a `para`). → el id del aviso.
 * No espera a nadie: escribe en las conexiones abiertas y vuelve.
 */
function publicar(canal, datos = {}, { para } = {}) {
  if (!CANALES.has(canal)) throw new Error(`No existe el canal de tiempo real «${canal}»: hay que registrarlo antes`);
  const json = JSON.stringify({ c: canal, d: datos === undefined ? null : datos });
  if (Buffer.byteLength(json) > AJUSTES.maxAviso) {
    throw new Error(`Un aviso de tiempo real no puede pasar de ${AJUSTES.maxAviso / 1024} KB: que diga qué cambió, y la pantalla pide los datos`);
  }
  const n = ++ultimo;
  const aviso = {
    n, canal, en: Date.now(),
    para: para == null ? null : new Set([].concat(para).map(Number).filter(Number.isFinite)),
    // El marco SSE, hecho una vez: `id` para retomar, y el JSON en una línea.
    marco: `id: ${idDe(n)}\ndata: ${json}\n\n`,
  };
  guardados.push(aviso);
  podar();
  for (const c of conexiones) if (llegaA(aviso, c)) c.escribir(aviso.marco);
  return idDe(n);
}

/**
 * Los avisos que se perdió quien vuelve con `desde` (su último id) y oye lo que
 * oye `c`. → la lista (quizá vacía), o null si no se puede retomar (otro
 * arranque, o ya no se guardan): entonces la pantalla se pone al día entera.
 */
function perdidos(desde, c) {
  const p = leerId(desde);
  if (!p || p.arranque !== ARRANQUE || p.n > ultimo) return null;
  podar();
  const primero = guardados.length ? guardados[0].n : ultimo + 1;
  if (p.n < primero - 1) return null;
  return guardados.filter(a => a.n > p.n && llegaA(a, c));
}

// ── Las conexiones ─────────────────────────────────────────────────────────
const conexiones = new Set();
let siguiente = 1;

/**
 * Apunta una conexión abierta. `escribir(texto)` manda al navegador,
 * `pendiente()` dice cuánto queda sin salir y `cerrar(motivo)` la termina.
 * `revisar()` (opcional) dice si sigue valiendo: { ok, canales? }.
 *   → la conexión: { id, quien, canales, escribir, cerrar, … }
 */
function conectar({ quien, canales, escribir, pendiente, cerrar, revisar }) {
  if (conexiones.size >= AJUSTES.maxTotal) {
    const e = new Error('Hay demasiadas pantallas conectadas ahora mismo: esta preguntará cada poco hasta que haya sitio');
    e.status = 503;
    throw e;
  }
  // Las de una misma persona, con tope: la más vieja (una pestaña olvidada) se cierra.
  const suyas = [...conexiones].filter(x => x.quien.id === quien.id);
  while (suyas.length >= AJUSTES.maxPorUsuario) suyas.shift().terminar('demasiadas');

  const c = {
    id: siguiente++, quien, canales: new Set(canales), abierta: true,
    desde: Date.now(), revisarEn: Date.now() + AJUSTES.revisarSesionMs, revisando: false,
    escribir(texto) {
      if (!c.abierta) return;
      // Un navegador que no lee (la pestaña dormida en un móvil) no puede
      // hacer crecer la memoria sin fin: se corta y, al volver, retoma.
      if (pendiente && pendiente() > AJUSTES.maxPendiente) { c.terminar('lento'); return; }
      try { escribir(texto); } catch (_) { c.terminar('roto'); }
    },
    terminar(motivo) {
      if (!c.abierta) return;
      c.abierta = false;
      conexiones.delete(c);
      try { cerrar(motivo); } catch (_) { /* ya estaba cerrada */ }
    },
    revisar,
  };
  conexiones.add(c);
  reloj();
  return c;
}

/** Se cerró por el otro lado (el navegador se fue). */
function soltar(c) {
  if (!c) return;
  c.abierta = false;
  conexiones.delete(c);
}

// ── El latido y la revisión, con UN reloj para todas ──────────────────────
let temporizador = null;
let cadaMs = 0;
function reloj() {
  const quiero = Math.min(AJUSTES.latidoMs, AJUSTES.revisarSesionMs);
  if (!conexiones.size) {
    if (temporizador) { clearInterval(temporizador); temporizador = null; }
    return;
  }
  if (temporizador && cadaMs === quiero) return;
  if (temporizador) clearInterval(temporizador);
  cadaMs = quiero;
  temporizador = setInterval(latir, quiero);
  if (temporizador.unref) temporizador.unref();
}

let ultimoLatido = 0;
function latir() {
  const ahora = Date.now();
  // Un comentario SSE: el navegador no lo ve, pero Cloudflare y los proxies
  // saben que la conexión está viva (si no, la cortan a los 100 s).
  if (ahora - ultimoLatido >= AJUSTES.latidoMs - 5) {
    ultimoLatido = ahora;
    for (const c of conexiones) c.escribir(`: latido ${ahora}\n\n`);
  }
  for (const c of conexiones) {
    if (!c.revisar || c.revisando || c.revisarEn > ahora) continue;
    c.revisando = true;
    c.revisarEn = ahora + AJUSTES.revisarSesionMs;
    Promise.resolve().then(() => c.revisar()).then(r => {
      if (!r || !r.ok) return c.terminar('sesion');
      if (r.canales) {
        const antes = [...c.canales];
        c.canales = new Set(r.canales.filter(x => c.canales.has(x)));
        const fuera = antes.filter(x => !c.canales.has(x));
        if (fuera.length) c.escribir(marcoDe('suscrito', { canales: [...c.canales], rechazados: fuera, ultimo: idDe(ultimo) }));
      }
    }).catch(e => {
      // Si la base no contesta no se echa a nadie, como en services/sesion.js.
      console.error('❌ [Tiempo real] no se pudo revisar una conexión:', e.message);
    }).finally(() => { c.revisando = false; });
  }
  reloj();
}

/** Un evento con nombre (suscrito, reinicio, fin). Sin `id`: no cuenta para retomar. */
const marcoDe = (evento, datos) => `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;

/** Cierra todas (las pruebas; o un apagado ordenado). */
function cerrarTodas(motivo = 'apagado') {
  for (const c of [...conexiones]) c.terminar(motivo);   // `cerrar` le dice el motivo
  reloj();
}

/** Para el banco y la pantalla del desarrollador: cuántas hay, sin quién. */
function estado(quienId) {
  const porCanal = {};
  for (const c of conexiones) for (const k of c.canales) porCanal[k] = (porCanal[k] || 0) + 1;
  return {
    conexiones: conexiones.size,
    mias: [...conexiones].filter(c => c.quien.id === quienId).length,
    porCanal,
    canales: [...CANALES.values()].map(c => ({ nombre: c.nombre, etiqueta: c.etiqueta })),
    guardados: guardados.length,
    ultimo: idDe(ultimo),
    instancia: ARRANQUE,
  };
}

module.exports = {
  registrarCanal, canalesDe, publicar, perdidos, conectar, soltar, cerrarTodas, estado, marcoDe,
  ultimoId: () => idDe(ultimo),
  // Para las pruebas:
  configurar, AJUSTES, ARRANQUE, leerId, guardados: () => guardados.length,
};
