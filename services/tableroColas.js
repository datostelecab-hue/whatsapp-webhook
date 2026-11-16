// ============================================================
// LAS COLAS EN EL TABLERO — J, −J, correcciones de fichaje (ítem 1, entrega 1c)
// ============================================================
// Lo que espera en una cola de hoy tiene su tarjeta en el tablero, y la cierra
// su cola. Lo que decidió Camilo el 16/11/2026:
//
//   · NACEN YA ASIGNADAS a quien las resuelve hoy (las J, por su tipo; las
//     correcciones, a quien tiene la llave del registro de jornada), con un
//     plazo de `tablero.plazo_colas_dias_habiles` (2 días hábiles, Parámetros).
//     Sin nadie a quien darlas, «por asignar»: las reparte Ignacio.
//   · SE CIERRAN SOLAS al resolverlas en su pantalla (aprobar, rechazar,
//     retirar…): desde el tablero no se cierran (cierreManual: false).
//   · LO QUE YA ESPERABA PASA DE UNA VEZ: el primer repaso crea las de todo lo
//     pendiente.
//
// NO SE ENGANCHA A CADA RUTA: cada cola dice qué tiene pendiente y cómo acabó lo
// que ya no lo está, y aquí se compara con sus tarjetas (sincronizar). Así una
// J que se aprueba desde la bitácora, desde /justificantes o desde Control
// cierra su tarjeta igual, y una ruta nueva no se puede olvidar de avisar.
// Se repasa:
//   · al cambiar algo en la cola: la cola llama a `pedir(tipo)` (las J y −J con
//     su `avisarCambios`; el fichaje, tras pedir, retirar o resolver);
//   · cada día a las 05:00, por si algo cambió por otro camino (tarea
//     programada `tablero.colas`, A10). La primera vez es el paso «de una vez».
// Repasar dos veces no hace nada: una tarjeta por cosa (uq_tarea_origen).
'use strict';

const libro = require('./libro');
const tablero = require('./tablero');
const parametros = require('./parametros');
const organizacion = require('./organizacion');
const repo = require('./repo/tablero');
const tareasProgramadas = require('./tareasProgramadas');

const COLAS = new Map();
const PLAZO = 'tablero.plazo_colas_dias_habiles';

/**
 * Una cola del tablero:
 *   etiqueta, abrir   lo que dice la tarjeta («J por aprobar», «Abrir la J»)
 *   abiertas()        lo que espera en su origen:
 *                     [{ origenId, titulo, enlace, creadaPor, reparto, sensible }]
 *   responsable(item) → id de quien la resuelve (o null: por asignar)
 *   comoAcabaron(ids) → Map origenId → { autorId, nota } de lo que ya no espera
 * O, para lo que ya tiene sus propios enganches (los tickets), solo
 *   sincronizar()     → { nacen, cierran }
 */
function registrar(tipo, def) {
  if (COLAS.has(tipo)) throw new Error(`La cola «${tipo}» ya está registrada`);
  if (!def.sincronizar) {
    if (typeof def.abiertas !== 'function' || typeof def.comoAcabaron !== 'function') throw new Error(`${tipo}: faltan «abiertas» y «comoAcabaron»`);
    tablero.registrarTipo(tipo, { etiqueta: def.etiqueta, abrir: def.abrir, cierreManual: false });
  }
  COLAS.set(tipo, def);
}

/** El primer titular de una función de Organización (A5), o null. */
async function titularDe(funcion) {
  const p = await organizacion.quienes(funcion, { conSuplentes: false });
  return p.length ? p[0].id : null;
}

/** Que pueda llevar tarjetas: activa y de la oficina. Si no, null (por asignar). */
async function valida(id, cache) {
  if (!id) return null;
  if (!cache.has(id)) {
    const p = await repo.persona(Number(id));
    cache.set(id, p && p.estado !== 'bloqueado' && p.rol !== 'conductor' ? Number(id) : null);
  }
  return cache.get(id);
}

/** Lo que dice el parámetro, o 2 si no se puede leer. */
const plazoColas = () => parametros.valor(PLAZO).catch(() => 2);

async function sincronizarCola(tipo, def) {
  const items = await def.abiertas();
  const pendientes = new Set(items.map(i => String(i.origenId)));
  const tarjetas = new Map((await repo.deOrigenes(tipo, [...pendientes])).map(t => [String(t.origen_id), t]));
  const plazoDias = await plazoColas();
  const personas = new Map();
  const cambiadas = [];
  const cuenta = { nacen: 0, reabren: 0, ajustan: 0, cierran: 0 };

  for (const it of items) {
    const origenId = String(it.origenId);
    const ya = tarjetas.get(origenId);
    // La anuló alguien (o no se aprobó): esa cosa no es una tarjeta.
    if (ya && ['anulada', 'rechazada'].includes(ya.estado)) continue;
    const resp = await valida(await def.responsable(it), personas);
    if (ya && ya.estado !== 'cerrada') {
      if (ya.titulo === it.titulo) continue;
      const id = await libro.conFirma({ origen: 'tablero', accion: 'ajuste' },
        cli => tablero.ajustarPorOrigen(cli, { tipo, origenId, titulo: it.titulo, responsableId: resp }));
      if (id) { cuenta.ajustan++; cambiadas.push(id); }
      continue;
    }
    const r = await libro.conFirma({ origen: 'tablero', accion: 'alta' }, cli => tablero.nacer(cli, {
      tipo, origenId, titulo: it.titulo, enlace: it.enlace, sensible: !!it.sensible,
      responsableId: resp, plazoDias, creadaPor: it.creadaPor || null,
    }));
    if (r.nueva) cuenta.nacen++;
    if (r.reabierta) cuenta.reabren++;
    if (r.nueva || r.reabierta) cambiadas.push(r.id);
  }

  // Las vivas cuyo origen ya no espera: se resolvió.
  const acabadas = (await repo.vivasDe(tipo)).filter(t => !pendientes.has(String(t.origen_id)));
  if (acabadas.length) {
    const como = await def.comoAcabaron(acabadas.map(t => String(t.origen_id)));
    for (const t of acabadas) {
      const c = como.get(String(t.origen_id)) || { autorId: null, nota: 'Ya no está pendiente en su origen' };
      const id = await libro.conFirma({ usuarioId: c.autorId || null, origen: 'tablero', accion: 'cierre' },
        cli => tablero.cerrarPorOrigen(cli, { tipo, origenId: t.origen_id, autorId: c.autorId || null, nota: c.nota }));
      if (id) { cuenta.cierran++; cambiadas.push(id); }
    }
  }
  // Sin notificación al móvil: son el trabajo de cada día de quien las lleva (lo
  // ve en su contador). Al vencer, sí (tablero.vencidas).
  for (const id of cambiadas) await tablero.avisar(id);
  return cuenta;
}

/** Repasa una cola ya mismo. → sus recuentos */
async function sincronizar(tipo) {
  const def = COLAS.get(tipo);
  if (!def) throw new Error(`No hay ninguna cola «${tipo}»`);
  return def.sincronizar ? def.sincronizar() : sincronizarCola(tipo, def);
}

// ── Pedir un repaso (lo que llaman las colas al cambiar) ───────────────────
// Si ya hay uno en marcha, se repite al acabar (lo pedido mientras tanto pudo
// llegar tarde a la lectura). Nunca lanza: lo que cambió en la cola ya está hecho.
const enMarcha = new Map();

function pedir(tipo) {
  if (!COLAS.has(tipo)) return Promise.resolve(null);
  const ya = enMarcha.get(tipo);
  if (ya) { ya.otraVez = true; return ya.promesa; }
  const e = { otraVez: false, promesa: null };
  enMarcha.set(tipo, e);
  e.promesa = (async () => {
    let r = null;
    try {
      do {
        e.otraVez = false;
        try { r = await sincronizar(tipo); } catch (err) { console.error(`❌ [Tablero] repaso de la cola ${tipo}:`, err.message); r = null; }
      } while (e.otraVez);
    } finally {
      enMarcha.delete(tipo);
    }
    return r;
  })();
  return e.promesa;
}

/** Espera a los repasos en marcha (las pruebas, y quien quiera el resultado ya). */
const esperar = () => Promise.all([...enMarcha.values()].map(e => e.promesa));

/** Repasa todas las colas, una tras otra. → { 'j.nacen': 3, … } */
async function sincronizarTodas() {
  const salida = {};
  for (const tipo of COLAS.keys()) {
    try {
      const r = await sincronizar(tipo);
      for (const [k, v] of Object.entries(r || {})) salida[`${tipo}.${k}`] = v;
    } catch (e) {
      console.error(`❌ [Tablero] repaso de la cola ${tipo}:`, e.message);
      salida[`${tipo}.fallo`] = String(e.message).slice(0, 150);
    }
  }
  return salida;
}

// Cada día, y la primera vez (de una vez) en cuanto arranca con la 1c.
tareasProgramadas.registrar({
  clave: 'tablero.colas',
  descripcion: 'Repasa las colas (J, −J, correcciones de fichaje y tickets): crea las tarjetas que falten y cierra las resueltas',
  desde: '2026-11-17',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '05:00' }),
  hacer: () => sincronizarTodas(),
});

module.exports = { registrar, pedir, esperar, sincronizar, sincronizarTodas, titularDe, colas: () => [...COLAS.keys()], PLAZO };
