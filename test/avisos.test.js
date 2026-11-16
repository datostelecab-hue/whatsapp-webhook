// ============================================================
// LOS AVISOS ENTRE MÓDULOS (ítem 3, db/254)
// ============================================================
// Lo que decidió Camilo el 16/11/2026, una prueba por cosa:
//   · el destino es un ÁREA de Organización (y su responsable), o una persona;
//     un área vacía se la queda quien reparte;
//   · leído, cada uno el suyo; resuelto, de todos, con quién y cuándo;
//   · se resuelve solo si se puede, si no a mano con nota; con hora, caduca;
//   · el primero de verdad: cada cita del taller de Madrid avisa a Control.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const avisos = require('../services/avisos');
const contadores = require('../services/contadores');
const citas = require('../modules/Vehiculos/citas.service');

afterEach(() => { contadores.olvidar(); });

// Un tipo de prueba, para las reglas de la bandeja.
avisos.registrarTipo('prueba', { etiqueta: 'Aviso de prueba', modulo: 'prueba', icono: 'fa-flask', area: 'control' });

async function gente({ fabrica, consulta }) {
  const p = {};
  for (const n of ['Karen', 'Lorenzo', 'Laura', 'Ignacio']) p[n.toLowerCase()] = (await fabrica.usuario({ nombre: n })).id;
  await consulta(`UPDATE usuario SET area_codigo = 'control' WHERE id = ANY($1::int[])`, [[p.karen, p.lorenzo]]);
  await consulta(`UPDATE usuario SET area_codigo = 'rrhh' WHERE id = $1`, [p.laura]);
  await consulta(`INSERT INTO usuario_funcion (usuario_id, funcion, suplente, creado_por) VALUES ($1, 'tareas_asigna', FALSE, $1)`, [p.ignacio]);
  return p;
}
const ids = r => r.avisos.map(a => a.id);

test('el aviso de un área le llega a su gente; leído, cada uno el suyo; resuelto, de todos y con nota', () => conBase(async h => {
  const p = await gente(h);
  const a = await avisos.emitir({ tipo: 'prueba', origenId: 'x1', titulo: 'Un coche sale al taller', texto: 'Mañana a las 9', enlace: '/control/citas-taller' });
  assert.equal(a.nuevo, true);
  assert.equal((await avisos.emitir({ tipo: 'prueba', origenId: 'x1', titulo: 'Otra vez' })).id, a.id, 'emitirlo dos veces no lo duplica');

  assert.deepEqual(ids(await avisos.mios(p.karen)), [a.id]);
  assert.deepEqual(ids(await avisos.mios(p.lorenzo)), [a.id]);
  assert.deepEqual(ids(await avisos.mios(p.laura)), [], 'a otra área, no');
  assert.equal((await avisos.mios(p.karen)).avisos[0].areaEtiqueta, 'Control');

  const n = await contadores.recuentos({ id: p.karen });
  assert.equal(n['avisos.sin_leer'].n, 1);
  assert.equal(n['avisos.prueba'].n, 1, 'y su número en la entrada de su módulo');

  await avisos.marcarLeidos(p.karen, { ids: [a.id] });
  assert.equal((await avisos.mios(p.karen)).sinLeer, 0, 'Karen lo ha leído');
  assert.equal((await avisos.mios(p.lorenzo)).sinLeer, 1, 'Lorenzo, todavía no');
  await h.consulta('SAVEPOINT intocable');
  await assert.rejects(h.consulta('DELETE FROM aviso_lectura'), /no se cambia ni se borra/);
  await h.consulta('ROLLBACK TO SAVEPOINT intocable');

  await assert.rejects(avisos.resolver(p.laura, a.id, { nota: 'Hecho' }), e => e.status === 404, 'solo quien lo recibe');
  await assert.rejects(avisos.resolver(p.lorenzo, a.id, { nota: '' }), /en qué quedó/);
  await avisos.resolver(p.lorenzo, a.id, { nota: 'Llamado, lo confirma' });
  assert.deepEqual(ids(await avisos.mios(p.karen)), [], 'resuelto, desaparece para toda el área');
  const f = (await h.consulta('SELECT estado, cerrado_por, cerrado_solo, nota FROM aviso WHERE id = $1', [a.id])).rows[0];
  assert.deepEqual([f.estado, f.cerrado_por, f.cerrado_solo, f.nota], ['resuelto', p.lorenzo, false, 'Llamado, lo confirma']);
}));

test('a una persona; un área vacía se la queda quien reparte; con hora, caduca; su módulo lo cierra', () => conBase(async h => {
  const p = await gente(h);
  const suyo = await avisos.emitir({ tipo: 'prueba', origenId: 'x2', titulo: 'Para Laura', usuarioId: p.laura, area: null });
  assert.deepEqual(ids(await avisos.mios(p.laura)), [suyo.id]);
  assert.equal((await avisos.mios(p.laura)).avisos[0].paraMi, true);

  const vacia = await avisos.emitir({ tipo: 'prueba', origenId: 'x3', titulo: 'Para el taller', area: 'taller' });
  assert.ok(ids(await avisos.mios(p.ignacio)).includes(vacia.id), 'nadie en Taller: le llega a quien reparte');

  const pasado = await avisos.emitir({ tipo: 'prueba', origenId: 'x4', titulo: 'Ya pasó', caducaAt: new Date(Date.now() - 60000) });
  assert.ok(!ids(await avisos.mios(p.karen)).includes(pasado.id), 'pasada su hora, no se enseña');
  const r = await avisos.repasoDiario();
  assert.equal(r.caducados, 1);
  assert.equal((await h.consulta('SELECT estado FROM aviso WHERE id = $1', [pasado.id])).rows[0].estado, 'caducado');

  const otro = await avisos.emitir({ tipo: 'prueba', origenId: 'x5', titulo: 'Se resuelve solo' });
  assert.equal(await avisos.resolverPorOrigen({ tipo: 'prueba', origenId: 'x5', nota: 'La J se aprobó' }), otro.id);
  const f = (await h.consulta('SELECT estado, cerrado_solo FROM aviso WHERE id = $1', [otro.id])).rows[0];
  assert.deepEqual([f.estado, f.cerrado_solo], ['resuelto', true]);
  assert.equal(await avisos.resolverPorOrigen({ tipo: 'prueba', origenId: 'x5' }), null, 'dos veces, nada');
}));

test('cada cita del taller de Madrid avisa a Control, y la llamada o el cambio de estado la cierran', () => conBase(async h => {
  const p = await gente(h);
  const coche = await h.fabrica.vehiculo({ matricula: '1234ABC' });
  const otro = await h.fabrica.vehiculo({ matricula: '5678DEF' });
  const bcn = await h.fabrica.vehiculo({ matricula: '9999BCN', sede: 'barcelona' });
  const conductor = await h.fabrica.conductor({ nombre: 'Luis' });
  const manana = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

  const c1 = await citas.crear({ vehiculoId: coche.id, fecha: manana, hora: '09:30' }, { usuarioId: p.laura });
  const c2 = await citas.crear({ vehiculoId: otro.id, fecha: manana, hora: '11:00' }, { usuarioId: p.laura });
  await citas.crear({ vehiculoId: bcn.id, fecha: manana, hora: '10:00' }, { usuarioId: p.laura }, { sede: 'barcelona' });
  await avisos.esperar();

  const de = r => r.avisos.filter(a => a.tipo === 'cita_taller');
  const vistos = de(await avisos.mios(p.karen));
  assert.equal(vistos.length, 2, 'las dos de Madrid; la de Barcelona es solo agenda');
  const a1 = vistos.find(a => a.titulo === 'Cita del taller: 1234ABC');
  assert.ok(a1, 'con la matrícula');
  assert.equal(a1.enlace, '/control/citas-taller');
  assert.ok(a1.caducaAt, 'caduca a la hora de la cita');
  assert.equal((await contadores.recuentos({ id: p.karen }))['avisos.taller'].n, 2, 'el número, en Mantenimientos');

  await citas.apuntarLlamada(c1.id, { resultado: 'confirma', conductorId: conductor.id }, { usuarioId: p.karen });
  await citas.cambiarEstado(c2.id, { estado: 'anulada', nota: 'El taller la cambia' }, { usuarioId: p.lorenzo });
  assert.deepEqual(de(await avisos.mios(p.karen)), [], 'la llamada y la anulación los cierran');
  const f = (await h.consulta(`SELECT origen_id, estado, cerrado_por, nota FROM aviso WHERE tipo = 'cita_taller' ORDER BY origen_id::bigint`)).rows;
  assert.deepEqual(f.map(x => [x.estado, x.cerrado_por, x.nota]), [
    ['resuelto', p.karen, 'Control llamó y apuntó la respuesta'],
    ['resuelto', p.lorenzo, 'La cita quedó anulada'],
  ]);

  const r = await avisos.sincronizar('cita_taller');
  assert.deepEqual(r, { emitidos: 0, cerrados: 0 }, 'repasar otra vez no hace nada');
}));
