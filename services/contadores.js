// ============================================================
// LOS CONTADORES — los números del menú y de la barra (A9)
// ============================================================
// Pieza A9 de docs/Hoja de ruta.md (16/11/2026). Hasta aquí había tres
// contadores sueltos, cada uno con su petición y su reloj: la campana (cada
// 2 min), los cuadros de tickets (cada 2 min) y la chapa de correcciones de
// fichaje (cada 5 min). Con el menú plegado solo se veía el de Pendientes.
//
// AHORA: cada módulo registra una FUENTE que dice sus números para quien mira,
// la pantalla los pide TODOS en una petición (GET /contadores/api) y los pinta
// donde haya una marca (public/assets/js/contadores.js):
//
//   contadores.registrarFuente('tickets', {
//     contar: async quien => ({ 'tickets.RRHH': 3, 'tickets.RRHH.nomina': 1 }),
//   });
//   // Un número, o { n, tono: 'aviso' | 'info', titulo } para el título y el color.
//
//   // Cuando algo cambia, se avisa y las pantallas los vuelven a pedir al
//   // momento (por el tiempo real, A7). Sin aviso, se refrescan cada 2 min.
//   contadores.cambio('tickets');                  // a todos
//   contadores.cambio('fichaje', { para: [42] });  // solo a esos
//
// QUIEN = { id, rol, permisos }: `permisos` es la lista de llaves de esa
// persona, o null si su rol lo ve todo. Cada fuente decide con eso qué cuenta:
// nadie recibe el número de algo que no puede abrir.
'use strict';

const tiempoReal = require('./tiempoReal');

const FUENTES = new Map();
const NOMBRE = /^[a-z][a-z0-9_-]{0,39}$/;
const CLAVE = /^[A-Za-z0-9_.-]{1,80}$/;
const AJUSTES = {
  esperaMs: 4000,     // una fuente que tarda más no retiene a las demás
  memoriaMs: 10000,   // varias pestañas de una persona, una sola cuenta
};

/** Un módulo dice qué números da. `contar(quien)` → { clave: n | { n, tono, titulo } }. */
function registrarFuente(nombre, { contar } = {}) {
  if (!NOMBRE.test(String(nombre || ''))) throw new Error(`Nombre de fuente de contadores no válido: «${nombre}»`);
  if (typeof contar !== 'function') throw new Error(`La fuente «${nombre}» tiene que decir cómo cuenta (contar)`);
  FUENTES.set(nombre, { nombre, contar });
}

const TONOS = new Set(['aviso', 'info']);

/** Lo que devuelve una fuente, limpio: { clave: { n, tono?, titulo? } }. */
function normalizar(nombre, salida) {
  const r = {};
  if (!salida || typeof salida !== 'object') return r;
  for (const [clave, v] of Object.entries(salida)) {
    if (!CLAVE.test(clave)) { console.error(`❌ [Contadores] ${nombre}: clave no válida «${clave}»`); continue; }
    const n = Number(typeof v === 'object' && v !== null ? v.n : v);
    if (!Number.isFinite(n) || n < 0) continue;
    const x = { n: Math.floor(n) };
    if (v && typeof v === 'object') {
      if (TONOS.has(v.tono)) x.tono = v.tono;
      if (v.titulo) x.titulo = String(v.titulo).slice(0, 200);
    }
    r[clave] = x;
  }
  return r;
}

function conTiempo(promesa, ms) {
  let t;
  return Promise.race([promesa, new Promise((_, mal) => { t = setTimeout(() => mal(new Error(`tardó más de ${ms} ms`)), ms); })])
    .finally(() => clearTimeout(t));
}

// Lo último contado de cada persona, unos segundos: con cinco pestañas abiertas
// y un aviso de cambio, se cuenta una vez y no cinco.
const memoria = new Map();   // id → { en, valor: Promise }

/** Todos los números de quien mira. Una fuente que falla o tarda no se ve; las demás sí. */
async function recuentos(quien) {
  if (!quien || !quien.id) return {};
  const m = memoria.get(quien.id);
  if (m && Date.now() - m.en < AJUSTES.memoriaMs) return m.valor;
  const valor = (async () => {
    const partes = await Promise.all([...FUENTES.values()].map(async f => {
      try { return normalizar(f.nombre, await conTiempo(Promise.resolve().then(() => f.contar(quien)), AJUSTES.esperaMs)); }
      catch (e) { console.error(`❌ [Contadores] ${f.nombre}:`, e.message); return {}; }
    }));
    return Object.assign({}, ...partes);
  })();
  memoria.set(quien.id, { en: Date.now(), valor });
  if (memoria.size > 500) for (const [k, v] of memoria) if (Date.now() - v.en > AJUSTES.memoriaMs) memoria.delete(k);
  try { return await valor; } catch (e) { memoria.delete(quien.id); throw e; }
}

// ── Avisar de un cambio ────────────────────────────────────────────────────
// El canal del tiempo real: lo oye cualquiera con sesión. El aviso solo dice
// qué fuente cambió; el número lo pide cada pantalla, con su permiso.
tiempoReal.registrarCanal('contadores', { etiqueta: 'Contadores del menú', puede: async q => !!(q && q.id) });

/**
 * Algo ha cambiado en esa(s) fuente(s): las pantallas vuelven a pedir sus
 * números. Nunca lanza: un aviso que no sale no puede romper lo que lo provocó.
 */
function cambio(fuentes, { para } = {}) {
  try {
    const lista = [].concat(fuentes || []).map(String).filter(f => NOMBRE.test(f));
    if (para == null) memoria.clear();
    else [].concat(para).forEach(id => memoria.delete(Number(id)));
    tiempoReal.publicar('contadores', { fuentes: lista }, para == null ? {} : { para });
  } catch (e) {
    console.error('❌ [Contadores] aviso de cambio:', e.message);
  }
}

/** Para las pruebas: olvidar lo contado, y quitar una fuente de mentira. */
const olvidar = () => memoria.clear();
const quitarFuente = nombre => FUENTES.delete(nombre);

module.exports = { registrarFuente, recuentos, cambio, olvidar, quitarFuente, fuentes: () => [...FUENTES.keys()], AJUSTES, normalizar };
