// ============================================================
// LAS COLAS EN EL TABLERO (ítem 1, entrega 1c, db/252)
// ============================================================
// Lo que decidió Camilo el 16/11/2026:
//   · las J nacen a nombre de quien lleva su tipo (funciones de Organización),
//     las −J a quien lleva las −J, las correcciones de fichaje y las vacaciones
//     a quien tiene su llave; sin nadie, «por asignar»;
//   · todas con el plazo de las colas (2 días hábiles, un parámetro);
//   · las cierra su cola (aprobar, rechazar, retirar), venga de donde venga;
//   · lo que ya esperaba pasa de una vez; de los tickets, solo desde el corte.
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
require('../modules/Control/justificantes.service');   // registra las colas de J y −J
const fichaje = require('../modules/Fichaje/fichaje.service');
const tarjetas = require('../modules/Ticketera/tarjetas');

let enviadas = [];
const enviar = push.enviar;
push.enviar = async (ids, aviso) => { enviadas.push({ ids: [...ids], ...aviso }); return {}; };
afterEach(() => { enviadas = []; contadores.olvidar(); });
process.on('exit', () => { push.enviar = enviar; });

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

test('1. una J pendiente nace a nombre de quien lleva su tipo, con 2 días hábiles, y aprobarla la cierra', () => conBase(async h => {
  const p = await gente(h);
  const j = await repoJ.guardarPorId({ conductorId: p.conductor, diaIso: '2026-11-12', horas: '2', observacion: 'Retraso en el aeropuerto', tipo: 'trafico', usuarioId: p.diana, origen: 'control' });
  await colas.esperar();

  const t = await tarjetaDe(p.ignacio, 'j', j.justificanteId);
  assert.ok(t, 'nace sola, al guardar la J');
  assert.equal(t.estado, 'por_hacer');
  assert.equal(t.responsable.id, p.william, 'Tráfico la lleva William');
  assert.equal(t.titulo, 'J Tráfico · Luis Pérez · 12/11');
  assert.equal(t.plazo.venceEl, await dosHabiles(), 'el plazo de las colas: 2 días hábiles');
  assert.equal(t.creadaPor.id, p.diana, 'la pidió quien puso la J');
  assert.equal(t.enlace, '/justificantes?tipo=trafico&dia=2026-11-12');
  assert.deepEqual([t.abrir, t.seCierraEnSuOrigen, t.puede.cerrar], ['Abrir la J', true, false]);
  assert.ok((await tablero.listar(p.william, { vista: 'mias' })).some(x => x.id === t.id), 'en «Mi tablero» de William');
  assert.equal(enviadas.length, 0, 'sin notificación al nacer: es su trabajo de cada día');

  await assert.rejects(tablero.cerrar(p.william, t.id, { nota: 'Hecha' }), e => e.status === 409, 'no se cierra desde el tablero');

  await repoJ.aprobar(j.justificanteId, { usuarioId: p.laura });
  await colas.esperar();
  const c = await tablero.ficha(p.ignacio, t.id);
  assert.equal(c.estado, 'cerrada');
  assert.equal(c.cierreNota, 'J aprobada');
  assert.equal(c.responsable.id, p.william, 'la llevaba William aunque la aprobara otra persona');
  const fila = (await h.consulta('SELECT cerrada_por FROM tarea WHERE id = $1', [t.id])).rows[0];
  assert.equal(fila.cerrada_por, p.laura, 'y queda quién la resolvió');
}));

test('2. cambiar el tipo la pasa a quien toca; editar una aprobada la reabre; rechazarla la cierra con el motivo', () => conBase(async h => {
  const p = await gente(h);
  const base = { conductorId: p.conductor, diaIso: '2026-11-10', observacion: 'Médico', usuarioId: p.diana, origen: 'control' };
  const j = await repoJ.guardarPorId({ ...base, horas: '3', tipo: 'rrhh' });
  await colas.esperar();
  const t = await tarjetaDe(p.ignacio, 'j', j.justificanteId);
  assert.equal(t.responsable.id, p.laura, 'RR. HH. la lleva Laura');

  await repoJ.guardarPorId({ ...base, horas: '3', tipo: 'taller' });
  await colas.esperar();
  let f = await tablero.ficha(p.ignacio, t.id);
  assert.equal(f.titulo, 'J Taller · Luis Pérez · 10/11');
  assert.equal(f.responsable.id, p.oscar, 'nadie la había repartido a mano: pasa a Óscar');
  assert.ok(f.historia.some(e => e.tipo === 'reasignada' && e.datos.porSuOrigen));

  // Una que repartió una persona no se pisa.
  await tablero.reasignar(p.ignacio, t.id, { responsableId: p.diana, motivo: 'Óscar está de vacaciones' });
  await repoJ.guardarPorId({ ...base, horas: '3', tipo: 'rrhh' });
  await colas.esperar();
  f = await tablero.ficha(p.ignacio, t.id);
  assert.equal(f.responsable.id, p.diana);

  await repoJ.aprobar(j.justificanteId, { usuarioId: p.laura });
  await colas.esperar();
  assert.equal((await tablero.ficha(p.ignacio, t.id)).estado, 'cerrada');

  // Aprobada y editada (otras horas): vuelve a pendiente, y su tarjeta se reabre.
  await repoJ.guardarPorId({ ...base, horas: '4', tipo: 'rrhh' });
  await colas.esperar();
  f = await tablero.ficha(p.ignacio, t.id);
  assert.equal(f.estado, 'por_hacer', 'la misma tarjeta, otra vez abierta');
  assert.equal(f.responsable.id, p.laura);
  assert.ok(f.historia.some(e => e.tipo === 'reabierta'));

  await repoJ.rechazar(j.justificanteId, { usuarioId: p.laura, motivo: 'No hay parte médico' });
  await colas.esperar();
  f = await tablero.ficha(p.ignacio, t.id);
  assert.equal(f.estado, 'cerrada');
  assert.equal(f.cierreNota, 'J no se aprobó: No hay parte médico');
  const n = (await h.consulta(`SELECT count(*)::int n FROM tarea WHERE tipo = 'j' AND origen_id = $1`, [String(j.justificanteId)])).rows[0].n;
  assert.equal(n, 1, 'una sola tarjeta para la J en toda su vida');
}));

test('3. una J sin nadie que lleve su tipo nace «por asignar»; la −J va a quien lleva las −J; una anulada no vuelve', () => conBase(async h => {
  const p = await gente(h);
  const j = await repoJ.guardarPorId({ conductorId: p.conductor, diaIso: '2026-11-11', horas: '1', observacion: 'Caída de la app', tipo: 'bolt', usuarioId: p.diana, origen: 'control' });
  await colas.esperar();
  const t = await tarjetaDe(p.ignacio, 'j', j.justificanteId);
  assert.equal(t.estado, 'por_asignar', 'nadie lleva las J de BOLT: la reparte Ignacio');
  assert.equal(t.plazo.venceEl, null);

  const m = await menosJ.poner({ conductorId: p.conductor, dia: '2026-11-11', motivo: 'Dejó el coche sin gasolina', usuarioId: p.diana, pantalla: 'bitacora' });
  await colas.esperar();
  const tm = await tarjetaDe(p.ignacio, 'menos_j', m.id);
  assert.equal(tm.responsable.id, p.william);
  assert.equal(tm.titulo, '−J · Luis Pérez · 11/11');

  await tablero.anular(p.ignacio, tm.id, { motivo: 'Se lleva por otro lado' });
  assert.deepEqual(await colas.sincronizar('menos_j'), { nacen: 0, reabren: 0, ajustan: 0, cierran: 0 }, 'anulada, no vuelve a nacer');

  await menosJ.aprobar(m.id, { usuarioId: p.william });
  await colas.esperar();
  assert.equal((await tablero.ficha(p.ignacio, tm.id)).estado, 'anulada', 'y aprobar la −J no la toca');
}));

test('4. una corrección de fichaje va a quien tiene la llave del registro, y la retira quien la pidió', () => conBase(async h => {
  const p = await gente(h);
  await h.consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/fichaje/revisar')`, [p.ignacio]);
  const c = (await h.consulta(
    `INSERT INTO fichaje_correccion (usuario_id, nueva, dia, entrada, salida, motivo)
     VALUES ($1, TRUE, '2026-11-13', '2026-11-13 08:00+01', '2026-11-13 16:00+01', 'Se me olvidó fichar') RETURNING id`, [p.diana])).rows[0];
  await colas.sincronizar('correccion_fichaje');
  const t = await tarjetaDe(p.ignacio, 'correccion_fichaje', c.id);
  assert.equal(t.responsable.id, p.ignacio, 'quien tiene la llave /fichaje/revisar');
  assert.equal(t.creadaPor.id, p.diana, 'y la ve quien la pidió');
  assert.equal(t.titulo, 'Corrección de fichaje · Diana De Prueba · 13/11');
  assert.ok((await tablero.listar(p.diana, { vista: 'mias' })).some(x => x.id === t.id));

  // Por el servicio de verdad: retirarla pide el repaso y la cierra.
  await fichaje.retirarCorreccion(p.diana, c.id);
  const f = await tablero.ficha(p.ignacio, t.id);
  assert.equal(f.estado, 'cerrada');
  assert.equal(f.cierreNota, 'La retiró quien la pidió');
}));

test('5. los tickets: las vacaciones, a quien las aprueba; los de antes del corte, sin tarjeta; un ticket cerrado por otro camino la cierra', () => conBase(async h => {
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

test('6. lo que ya esperaba pasa de una vez, y repasar otra vez no hace nada', () => conBase(async h => {
  const p = await gente(h);
  // J que ya estaban antes del tablero: escritas sin pasar por el repo (sin aviso).
  for (const [dia, tipo] of [['2026-11-03', 'trafico'], ['2026-11-04', 'taller']]) {
    await h.consulta(`INSERT INTO justificante (conductor_id, dia_operativo, observacion, tipo, usuario_id) VALUES ($1, $2, 'De antes', $3, $4)`,
      [p.conductor, dia, tipo, p.diana]);
  }
  assert.ok(tareasProgramadas.registradas().some(t => t.clave === 'tablero.colas'), 'es una tarea programada (A10)');
  const r = await colas.sincronizarTodas();
  assert.equal(r['j.nacen'], 2);
  const otra = await colas.sincronizarTodas();
  assert.equal(otra['j.nacen'], 0);
  assert.equal(otra['j.cierran'], 0);
  const n = (await h.consulta(`SELECT count(*)::int n FROM tarea WHERE tipo = 'j'`)).rows[0].n;
  assert.equal(n, 2);
}));
