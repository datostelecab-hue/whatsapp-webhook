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

  const fila = (await ruedas.cuadro({ sedes: ['madrid'] })).filas.find(f => Number(f.id) === Number(v.id));
  assert.equal(fila.revision.observacion, 'Dibujo a 4 mm');
  assert.deepEqual(fila.revisiones.map(r => [r.fecha, r.km]), [['2026-11-01', 84500]]);
  assert.equal(fila.revisiones[0].por, 'Óscar De Prueba', 'quién la apuntó');
  assert.equal(fila.cambio, null, 'una revisión no es un cambio de ruedas');
  assert.equal(fila.estado, 'sin_dato');
  // Una por tramo (db/276): la segunda no entra.
  await assert.rejects(ruedas.apuntarRevision({ vehiculoId: v.id, fecha: ddmm(hoy()), observacion: 'Otra' }, quien), /ya tiene su revisión/);

  // Anular: con motivo, y no se borra. Anulada, se puede apuntar la buena.
  const id = fila.revisiones[0].id;
  await assert.rejects(ruedas.anularRevision({ id, motivo: '' }, quien), /por qué/);
  await ruedas.anularRevision({ id, motivo: 'Era de otro coche' }, quien);
  const guardada = (await consulta('SELECT anulado_motivo FROM ruedas_revision WHERE id = $1', [id])).rows[0];
  assert.equal(guardada.anulado_motivo, 'Era de otro coche', 'sigue en la base');
  await ruedas.apuntarRevision({ vehiculoId: v.id, fecha: ddmm(hoy()), observacion: 'Delanteras gastadas por dentro: alinear' }, quien);
  const otra = (await ruedas.cuadro({ sedes: ['madrid'] })).filas.find(f => Number(f.id) === Number(v.id));
  assert.deepEqual([otra.revision.observacion, otra.revision.km], ['Delanteras gastadas por dentro: alinear', null], 'los km son opcionales');
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

// ── db/276: la revisión da 15.000 km más, y una por tramo ───────────────────
test('la revisión del tramo es la de después del último cambio; sin cambio, cualquiera', () => {
  const revs = [{ id: 3, fecha: '2026-11-20' }, { id: 2, fecha: '2026-04-01' }];
  assert.equal(ruedas._revisionDelTramo({ fecha: '2026-05-10' }, revs).id, 3);
  assert.equal(ruedas._revisionDelTramo({ fecha: '2026-11-21' }, revs), null, 'revisada antes del cambio: ese tramo ya pasó');
  assert.equal(ruedas._revisionDelTramo(null, revs).id, 3);
  // Con 45.000 de límite, a los 30.000 aún no toca; a los 45.000, sí o sí.
  const c = { km: 40000 };
  assert.equal(ruedas._semaforo({ odometro: 70000, cambio: c, intervalo: 45000 }).estado, 'ok');
  assert.equal(ruedas._semaforo({ odometro: 85000, cambio: c, intervalo: 45000 }).estado, 'toca');
});

test('con la base: apuntar la revisión sube el límite a 45.000, no admite otra en el tramo, y con un cambio nuevo vuelve a 30.000', () => conBase(async ({ fabrica }) => {
  const yo = (await fabrica.usuario()).id;
  const v = await fabrica.vehiculo();
  const quien = { usuarioId: yo, sedes: ['madrid'] };
  const fila = async () => (await ruedas.cuadro({ sedes: ['madrid'] })).filas.find(f => Number(f.id) === Number(v.id));

  await ruedas.apuntar({ vehiculoId: v.id, fecha: '10/05/2026', km: 40000, ruedas: 4 }, quien);
  assert.equal((await fila()).intervalo, 30000);
  await assert.rejects(ruedas.apuntarRevision({ vehiculoId: v.id, fecha: '01/05/2026', observacion: 'Bien' }, quien), /no puede ser de antes/);

  await ruedas.apuntarRevision({ vehiculoId: v.id, fecha: '20/11/2026', km: 70000, observacion: 'Dibujo a 3 mm' }, quien);
  const f = await fila();
  assert.deepEqual([f.intervalo, f.revisionTramo.observacion], [45000, 'Dibujo a 3 mm']);
  await assert.rejects(ruedas.apuntarRevision({ vehiculoId: v.id, fecha: '21/11/2026', observacion: 'Otra' }, quien), /ya tiene su revisión en este tramo/);

  // Cambio nuevo: tramo nuevo, otra vez 30.000 y se puede volver a revisar.
  await ruedas.apuntar({ vehiculoId: v.id, fecha: '22/11/2026', km: 76000, ruedas: 4 }, quien);
  const g = await fila();
  assert.deepEqual([g.intervalo, g.revisionTramo], [30000, null]);
}));

test('con la base: el aviso de los 45.000 sale aunque ya se avisara a los 30.000', () => conBase(async ({ fabrica, consulta }) => {
  const oscar = await fabrica.usuario({ rol: 'taller', nombre: 'Taller' });
  await consulta(`UPDATE usuario SET puesto_codigo = 'responsable_taller' WHERE id = $1`, [oscar.id]);
  const v = await fabrica.vehiculo();
  const base = { id: v.id, matricula: v.matricula, vehiculo: 'Toyota Corolla', estado: 'toca', cambio: { id: null, km: 40000, fecha: '2026-05-10' } };
  assert.equal((await ruedas.avisar({ filas: [{ ...base, desde: 31000, intervalo: 30000, revisionTramo: null }] })).avisados, 1);
  const rev = (await consulta(
    `INSERT INTO ruedas_revision (vehiculo_id, fecha, observacion) VALUES ($1, '2026-11-01', 'Bien') RETURNING id`, [v.id])).rows[0];
  const conRevision = { ...base, desde: 45500, intervalo: 45000, revisionTramo: { id: Number(rev.id), fecha: '2026-11-01' } };
  assert.equal((await ruedas.avisar({ filas: [conRevision] })).avisados, 1, 'con la revisión, otro aviso');
  assert.equal((await ruedas.avisar({ filas: [conRevision] })).avisados, 0, 'y una sola vez');
}));
