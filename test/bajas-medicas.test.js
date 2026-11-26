// ============================================================
// LAS BAJAS MÉDICAS Y SUS PARTES (módulo 1, db/303, 26/11/2026)
// ============================================================
// El parte de baja abre la baja de su ficha; la confirmación cambia la fecha
// prevista; dos días hábiles antes del fin previsto nace la tarjeta de
// «comprobar»; el alta la cierra el día del alta (vuelve al siguiente), con su
// tarjeta de reincorporación y el aviso a Planificación; la rectificación
// corrige fechas con motivo.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const bajas = require('../modules/RRHH/bajas.service');

test('de la baja al alta: la ficha, las tarjetas y el aviso a Planificación', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  for (const c of ['/ausencias', '/ausencias/validar']) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
  const d = { usuarioId: u.id, rol: 'oficina' };
  const mira = await fabrica.usuario({ rol: 'oficina', nombre: 'Mira' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/ausencias')`, [mira.id]);
  const m = { usuarioId: mira.id, rol: 'oficina' };
  const c = await fabrica.conductor({ nombre: 'BAJA' });

  await assert.rejects(bajas.nuevaBaja({ conductorId: c.id, fecha: '2026-12-01' }, m), e => e.status === 403);
  const { id } = await bajas.nuevaBaja({ conductorId: c.id, fecha: '2026-12-01', prevista: '2026-12-10', contingencia: 'comun' }, d);
  let s = (await consulta(`SELECT estado, to_char(desde, 'YYYY-MM-DD') AS desde, hasta, to_char(hasta_previsto, 'YYYY-MM-DD') AS prevista FROM conductor_estado_hist WHERE id = $1`, [id])).rows[0];
  assert.deepEqual([s.estado, s.desde, s.hasta, s.prevista], ['baja_medica', '2026-12-01', null, '2026-12-10']);
  await assert.rejects(bajas.nuevaBaja({ conductorId: c.id, fecha: '2026-12-03' }, d), e => e.status === 409);

  // Dos días hábiles antes del fin previsto: la tarjeta de «comprobar».
  assert.equal((await bajas.revisar({ hoy: '2026-12-01' })).nacidas, 0, 'aún lejos');
  assert.equal((await bajas.revisar({ hoy: '2026-12-08' })).nacidas, 1);
  const tarjeta = async tipo => (await consulta(`SELECT estado FROM tarea WHERE tipo = $1 AND origen_id = $2`, [tipo, id])).rows[0];
  assert.notEqual((await tarjeta('baja_revisar')).estado, 'cerrada');

  // La prórroga: la nueva fecha prevista, y la tarjeta se cierra.
  await bajas.confirmacion(id, { fecha: '2026-12-09', prevista: '2026-12-20' }, d);
  s = (await consulta(`SELECT to_char(hasta_previsto, 'YYYY-MM-DD') AS prevista FROM conductor_estado_hist WHERE id = $1`, [id])).rows[0];
  assert.equal(s.prevista, '2026-12-20');
  assert.equal((await tarjeta('baja_revisar')).estado, 'cerrada');

  // El alta: se cierra el día del alta y vuelve al siguiente; tarjeta y aviso.
  const r = await bajas.alta(id, { fecha: '2026-12-15' }, d);
  assert.equal(r.vuelve, '2026-12-16');
  s = (await consulta(`SELECT to_char(hasta, 'YYYY-MM-DD') AS hasta FROM conductor_estado_hist WHERE id = $1`, [id])).rows[0];
  assert.equal(s.hasta, '2026-12-15');
  assert.ok(await tarjeta('baja_reincorporacion'), 'la tarjeta de su reincorporación');
  const aviso = (await consulta(`SELECT area_codigo AS area, titulo FROM aviso WHERE tipo = 'baja_vuelve' AND origen_id = $1`, [id])).rows[0];
  assert.equal(aviso.area, 'planificacion');
  assert.match(aviso.titulo, /vuelve de baja médica el 16\/12\/2026/);
  await assert.rejects(bajas.alta(id, { fecha: '2026-12-16' }, d), /ya tiene el alta/);

  // Rectificar: el primer día, con motivo.
  await assert.rejects(bajas.rectificar(id, { desde: '2026-11-30' }, d), /Di qué/);
  await bajas.rectificar(id, { desde: '2026-11-30', nota: 'El parte decía el 30' }, d);
  const f = await bajas.ficha(id, m);
  assert.deepEqual([f.desde, f.hasta, f.vuelve, f.historia.map(p => p.tipo)], ['2026-11-30', '2026-12-15', '2026-12-16', ['baja', 'confirmacion', 'alta', 'rectificacion']]);
  assert.equal((await bajas.lista(m)).filas.find(x => x.id === id).estado.clave, 'alta');
}));
