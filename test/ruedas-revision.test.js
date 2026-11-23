// ============================================================
// RUEDAS — LAS REVISIONES, CON SU OBSERVACIÓN (db/275, 23/11/2026)
// ============================================================
// «Que se pueda inputar también la última revisión, no mantenimiento sino
// revisión con su respectiva observación». Una revisión no es un cambio: no
// mueve los 30.000 km. Se anula con motivo; no se borra.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ruedas = require('../modules/Vehiculos/ruedas.service');

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const ddmm = iso => iso.split('-').reverse().join('/');

test('apuntar una revisión: sale como la última, con su observación, y no cuenta como cambio', () => conBase(async ({ fabrica, consulta }) => {
  const yo = (await fabrica.usuario({ nombre: 'Óscar' })).id;
  const v = await fabrica.vehiculo();
  const quien = { usuarioId: yo, sedes: ['madrid'] };

  await ruedas.apuntarRevision({ vehiculoId: v.id, fecha: '01/11/2026', km: '84.500', observacion: 'Dibujo a 4 mm' }, quien);
  await ruedas.apuntarRevision({ vehiculoId: v.id, fecha: ddmm(hoy()), observacion: 'Delanteras gastadas por dentro: alinear' }, quien);

  const fila = (await ruedas.cuadro({ sedes: ['madrid'] })).filas.find(f => Number(f.id) === Number(v.id));
  assert.equal(fila.revision.observacion, 'Delanteras gastadas por dentro: alinear', 'la última, arriba');
  assert.equal(fila.revision.km, null, 'los km son opcionales');
  assert.deepEqual(fila.revisiones.map(r => [r.fecha, r.km]), [[hoy(), null], ['2026-11-01', 84500]]);
  assert.equal(fila.revisiones[0].por, 'Óscar De Prueba', 'quién la apuntó');
  assert.equal(fila.cambio, null, 'una revisión no es un cambio de ruedas');
  assert.equal(fila.estado, 'sin_dato');

  // Anular: con motivo, y no se borra.
  const id = fila.revisiones[0].id;
  await assert.rejects(ruedas.anularRevision({ id, motivo: '' }, quien), /por qué/);
  await ruedas.anularRevision({ id, motivo: 'Era de otro coche' }, quien);
  const otra = (await ruedas.cuadro({ sedes: ['madrid'] })).filas.find(f => Number(f.id) === Number(v.id));
  assert.equal(otra.revision.observacion, 'Dibujo a 4 mm');
  const guardada = (await consulta('SELECT anulado_motivo FROM ruedas_revision WHERE id = $1', [id])).rows[0];
  assert.equal(guardada.anulado_motivo, 'Era de otro coche', 'sigue en la base');
}));

test('lo que no se apunta: sin observación, sin día, un día que no ha llegado, o un coche de otra sede', () => conBase(async ({ fabrica }) => {
  const yo = (await fabrica.usuario()).id;
  const v = await fabrica.vehiculo();
  const bcn = await fabrica.vehiculo({ sede: 'barcelona' });
  const quien = { usuarioId: yo, sedes: ['madrid'] };
  await assert.rejects(ruedas.apuntarRevision({ vehiculoId: v.id, fecha: '01/11/2026', observacion: '  ' }, quien), /observación/);
  await assert.rejects(ruedas.apuntarRevision({ vehiculoId: v.id, observacion: 'Bien' }, quien), /día/);
  await assert.rejects(ruedas.apuntarRevision({ vehiculoId: v.id, fecha: '01/01/2099', observacion: 'Bien' }, quien), /no ha llegado/);
  await assert.rejects(ruedas.apuntarRevision({ vehiculoId: bcn.id, fecha: '01/11/2026', observacion: 'Bien' }, quien), /sede/);
}));
