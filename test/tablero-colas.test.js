// ============================================================
// LAS COLAS EN EL TABLERO (ítem 1, entrega 1c, db/252 y db/261)
// ============================================================
// Lo que decidió Camilo el 16/11/2026, para lo que sea una cola del tablero:
//   · nace a nombre de quien la resuelve; sin nadie, «por asignar»;
//   · con el plazo de las colas (2 días hábiles, un parámetro);
//   · la cierra su cola, venga de donde venga; si vuelve a estar pendiente,
//     se reabre la misma; una anulada no vuelve a nacer;
//   · lo que ya esperaba pasa de una vez; de los tickets, solo desde el corte.
// Y el 17/11/2026: las J, las −J y las correcciones de fichaje SALEN del
// tablero («no son cosas urgentes»; «la corrección de fichajes no será
// prioridad»). Hoy solo los tickets son una cola; el resto se prueba con una
// cola de mentira.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const push = require('../services/notificacionesPush');
const tablero = require('../services/tablero');
const colas = require('../services/tableroColas');
const calendario = require('../services/calendario');
const contadores = require('../services/contadores');
const tareasProgramadas = require('../services/tareasProgramadas');
const repoJ = require('../services/repo/justificantes');
const menosJ = require('../services/repo/menosJ');
require('../modules/Control/justificantes.service');
const fichaje = require('../modules/Fichaje/fichaje.service');
const tarjetas = require('../modules/Ticketera/tarjetas');

let enviadas = [];
const enviar = push.enviar;
push.enviar = async (ids, aviso) => { enviadas.push({ ids: [...ids], ...aviso }); return {}; };
afterEach(() => { enviadas = []; contadores.olvidar(); pendientes.clear(); resueltas.clear(); });
process.on('exit', () => { push.enviar = enviar; });

// Una cola de mentira: lo que espera y cómo acabó, en memoria.
const pendientes = new Map();   // origenId → { titulo, quien, creadaPor }
const resueltas = new Map();    // origenId → { autorId, nota }
colas.registrar('prueba_cola', {
  etiqueta: 'Cola de prueba',
  abrir: 'Abrir la cosa',
  abiertas: async () => [...pendientes].map(([origenId, x]) => ({ origenId, titulo: x.titulo, enlace: '/prueba', reparto: x.quien, creadaPor: x.creadaPor })),
  responsable: async it => it.reparto || null,
  comoAcabaron: async ids => new Map(ids.filter(i => resueltas.has(i)).map(i => [i, resueltas.get(i)])),
});

async function gente({ fabrica, consulta }) {
  const p = {};
  for (const n of ['Ignacio', 'William', 'Laura', 'Oscar', 'Diana']) p[n.toLowerCase()] = (await fabrica.usuario({ nombre: n })).id;
  const funciones = [[p.ignacio, 'tareas_aprueba'], [p.ignacio, 'tareas_asigna'], [p.william, 'j_trafico'], [p.william, 'menos_j'],
    [p.laura, 'j_rrhh'], [p.oscar, 'j_taller']];
  for (const [u, f] of funciones) {
    await consulta('INSERT INTO usuario_funcion (usuario_id, funcion, suplente, creado_por) VALUES ($1, $2, FALSE, $1)', [u, f]);
  }
  p.conductor = (await fabrica.conductor({ nombre: 'Luis', apellidos: 'Pérez' })).id;
  return p;
}

/** La tarjeta de una cosa de origen, como la ve quien la lleva o Ignacio. */
async function tarjetaDe(quien, tipo, origenId) {
  const filas = [...await tablero.listar(quien, { vista: 'equipo' }), ...await tablero.listar(quien, { vista: 'pendientes' })];
  return filas.find(t => t.tipo === tipo && t.origenId === String(origenId)) || null;
}

const dosHabiles = async () => (await calendario.de('madrid')).sumarDiasHabiles(calendario.hoy(), 2);

test('1. lo pendiente de una cola nace a nombre de quien lo resuelve, con 2 días hábiles; resolverlo la cierra; si vuelve, se reabre la misma', () => conBase(async h => {
  const p = await gente(h);
  pendientes.set('7', { titulo: 'Cosa 7', quien: p.william, creadaPor: p.diana });
  assert.deepEqual(await colas.sincronizar('prueba_cola'), { nacen: 1, reabren: 0, ajustan: 0, cierran: 0 });
  const t = await tarjetaDe(p.ignacio, 'prueba_cola', '7');
  assert.deepEqual([t.estado, t.responsable.id, t.titulo, t.creadaPor.id], ['por_hacer', p.william, 'Cosa 7', p.diana]);
  assert.equal(t.plazo.venceEl, await dosHabiles(), 'el plazo de las colas: 2 días hábiles');
  assert.deepEqual([t.abrir, t.seCierraEnSuOrigen, t.puede.cerrar], ['Abrir la cosa', true, false]);
  assert.equal(enviadas.length, 0, 'sin notificación al nacer: es su trabajo de cada día');
  await assert.rejects(tablero.cerrar(p.william, t.id, { nota: 'Hecha' }), e => e.status === 409, 'no se cierra desde el tablero');

  // Cambia quién la resuelve: nadie la había repartido a mano, pasa a quien toca.
  pendientes.set('7', { titulo: 'Cosa 7 (otra)', quien: p.oscar, creadaPor: p.diana });
  await colas.sincronizar('prueba_cola');
  let f = await tablero.ficha(p.ignacio, t.id);
  assert.deepEqual([f.titulo, f.responsable.id], ['Cosa 7 (otra)', p.oscar]);

  pendientes.delete('7');
  resueltas.set('7', { autorId: p.laura, nota: 'Resuelta' });
  await colas.sincronizar('prueba_cola');
  f = await tablero.ficha(p.ignacio, t.id);
  assert.deepEqual([f.estado, f.cierreNota], ['cerrada', 'Resuelta']);

  pendientes.set('7', { titulo: 'Cosa 7 (otra)', quien: p.oscar });
  assert.equal((await colas.sincronizar('prueba_cola')).reabren, 1);
  f = await tablero.ficha(p.ignacio, t.id);
  assert.equal(f.estado, 'por_hacer', 'la misma tarjeta, otra vez abierta');
  const n = (await h.consulta(`SELECT count(*)::int n FROM tarea WHERE tipo = 'prueba_cola' AND origen_id = '7'`)).rows[0].n;
  assert.equal(n, 1, 'una sola tarjeta en toda su vida');
}));

test('2. sin nadie que la resuelva, «por asignar»; una anulada no vuelve a nacer', () => conBase(async h => {
  const p = await gente(h);
  pendientes.set('8', { titulo: 'Cosa 8', quien: null });
  await colas.sincronizar('prueba_cola');
  const t = await tarjetaDe(p.ignacio, 'prueba_cola', '8');
  assert.deepEqual([t.estado, t.plazo.venceEl], ['por_asignar', null]);
  await tablero.anular(p.ignacio, t.id, { motivo: 'Se lleva por otro lado' });
  assert.deepEqual(await colas.sincronizar('prueba_cola'), { nacen: 0, reabren: 0, ajustan: 0, cierran: 0 }, 'anulada, no vuelve a nacer');
}));

test('3. las J, las −J y las correcciones de fichaje ya no van al tablero (17/11/2026)', () => conBase(async h => {
  const p = await gente(h);
  await repoJ.guardarPorId({ conductorId: p.conductor, diaIso: '2026-11-12', horas: '2', observacion: 'Retraso en el aeropuerto', tipo: 'trafico', usuarioId: p.diana, origen: 'control' });
  await menosJ.poner({ conductorId: p.conductor, dia: '2026-11-11', motivo: 'Dejó el coche sin gasolina', usuarioId: p.diana, pantalla: 'bitacora' });
  await h.consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/fichaje/revisar')`, [p.ignacio]);
  const c = (await h.consulta(
    `INSERT INTO fichaje_correccion (usuario_id, nueva, dia, entrada, salida, motivo)
     VALUES ($1, TRUE, '2026-11-13', '2026-11-13 08:00+01', '2026-11-13 16:00+01', 'Se me olvidó fichar') RETURNING id`, [p.diana])).rows[0];
  await fichaje.retirarCorreccion(p.diana, c.id);   // el fichaje sigue funcionando sin tarjetas
  await colas.esperar();
  assert.deepEqual(colas.colas().filter(x => ['j', 'menos_j', 'correccion_fichaje'].includes(x)), [], 'no son colas del tablero');
  await colas.sincronizarTodas();
  const n = (await h.consulta(`SELECT count(*)::int n FROM tarea WHERE tipo IN ('j', 'menos_j', 'correccion_fichaje')`)).rows[0].n;
  assert.equal(n, 0, 'ninguna tarjeta');
}));

test('4. los tickets: las vacaciones, a quien las aprueba; los de antes del corte, sin tarjeta; un ticket cerrado por otro camino la cierra', () => conBase(async h => {
  const p = await gente(h);
  await h.consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/vacaciones/aprobar')`, [p.laura]);
  const nuevo = async (subtipo, creado = null) => (await h.consulta(
    `INSERT INTO ticket (codigo, origen, area_codigo, subtipo_codigo, nombre, descripcion, estado, creado_at)
     VALUES ($1, 'soporte', 'RRHH', $2, 'Ana Ruiz', 'Prueba', 'pendiente', COALESCE($3::timestamptz, now())) RETURNING id, codigo`,
    [`RH-C-${Math.floor(Math.random() * 1e6)}`, subtipo, creado])).rows[0];
  const vac = await nuevo('VACACIONES');
  const otro = await nuevo('INCIDENCIA_NOMINA');
  await nuevo('INCIDENCIA_NOMINA', '2026-09-01 10:00+02');   // antes del corte (24/09/2026)

  assert.equal(await tarjetas.deNuevos(), 2, 'los dos desde el corte; el de septiembre, no');
  const tv = await tarjetaDe(p.ignacio, 'ticket', vac.id);
  assert.equal(tv.estado, 'por_hacer');
  assert.equal(tv.responsable.id, p.laura, 'directas a quien tiene la llave de las vacaciones');
  assert.equal(tv.plazo.venceEl, await dosHabiles());
  assert.equal(tv.abrir, 'Abrir el ticket');
  assert.equal((await tarjetaDe(p.ignacio, 'ticket', otro.id)).estado, 'por_asignar', 'los demás, como siempre');

  // Cerrado sin pasar por la ticketera (una corrección a mano): el repaso lo ve.
  await h.consulta(`UPDATE ticket SET estado = (SELECT codigo FROM cat_ticket_estado WHERE cierra LIMIT 1), resuelto_at = now() WHERE id = $1`, [otro.id]);
  assert.deepEqual(await colas.sincronizar('ticket'), { nacen: 0, cierran: 1 });
  assert.equal((await tarjetaDe(p.ignacio, 'ticket', otro.id)).estado, 'cerrada');
}));

test('5. lo que ya esperaba pasa de una vez, y repasar otra vez no hace nada', () => conBase(async h => {
  const p = await gente(h);
  pendientes.set('1', { titulo: 'De antes 1', quien: p.william });
  pendientes.set('2', { titulo: 'De antes 2', quien: p.oscar });
  assert.ok(tareasProgramadas.registradas().some(t => t.clave === 'tablero.colas'), 'es una tarea programada (A10)');
  const r = await colas.sincronizarTodas();
  assert.equal(r['prueba_cola.nacen'], 2);
  const otra = await colas.sincronizarTodas();
  assert.equal(otra['prueba_cola.nacen'], 0);
  assert.equal(otra['prueba_cola.cierran'], 0);
  const n = (await h.consulta(`SELECT count(*)::int n FROM tarea WHERE tipo = 'prueba_cola'`)).rows[0].n;
  assert.equal(n, 2);
}));
