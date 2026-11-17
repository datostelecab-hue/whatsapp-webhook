// ============================================================
// LA BASE DE PRUEBAS — que el banco de pruebas es de fiar
// ============================================================
// Antes de fiarse de un test hay que fiarse de dónde corre: que es la base
// sintética y no la copia de producción, que lo de un test no se le cuela al
// siguiente, que el transaccion() del código se sigue deshaciendo si falla y
// que el reloj se puede fijar.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { fijarAhora } = require('./apoyo/reloj');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../services/db');

test('es la base de pruebas, sin una sola persona de verdad', () => conBase(async ({ consulta }) => {
  const marca = await consulta('SELECT migraciones FROM base_de_pruebas');
  assert.equal(marca.rows.length, 1);
  assert.ok(marca.rows[0].migraciones > 200, 'tiene aplicadas las migraciones de db/');
  const n = async sql => Number((await consulta(sql)).rows[0].n);
  assert.equal(await n('SELECT count(*) n FROM conductor WHERE NOT es_centinela'), 0);
  assert.equal(await n('SELECT count(*) n FROM usuario'), 0);
  assert.equal(await n('SELECT count(*) n FROM conductor_externo'), 0);
}));

test('lo que hace un test se deshace al acabar (1 de 2: lo crea)', () => conBase(async ({ fabrica, consulta }) => {
  await fabrica.usuario({ nombre: 'Efímero' });
  const r = await consulta(`SELECT count(*)::int n FROM usuario WHERE nombre = 'Efímero'`);
  assert.equal(r.rows[0].n, 1);
}));

test('lo que hace un test se deshace al acabar (2 de 2: ya no está)', () => conBase(async ({ consulta }) => {
  const r = await consulta(`SELECT count(*)::int n FROM usuario WHERE nombre = 'Efímero'`);
  assert.equal(r.rows[0].n, 0);
}));

test('el transaccion() del código deshace lo suyo si falla, y el test sigue', () => conBase(async ({ fabrica, consulta }) => {
  const u = await fabrica.usuario();
  await assert.rejects(db.transaccion(async cli => {
    await cli.query(`UPDATE usuario SET nombre = 'A medias' WHERE id = $1`, [u.id]);
    throw new Error('falla a mitad');
  }), /falla a mitad/);
  const r = await consulta('SELECT nombre FROM usuario WHERE id = $1', [u.id]);
  assert.equal(r.rows[0].nombre, u.nombre, 'el cambio a medias se deshizo');
}));

test('una consulta fuera de conBase() no se deja hacer', () => {
  assert.throws(() => db.consulta('SELECT 1'), /fuera de conBase/);
});

test('las fábricas hacen filas válidas e inventadas', () => conBase(async ({ fabrica, consulta }) => {
  const u = await fabrica.usuario({ rol: 'taller' });
  assert.match(u.email, /@telecab\.invalid$/);
  const rol = await consulta('SELECT codigo FROM rol WHERE id = $1', [u.rol_id]);
  assert.equal(rol.rows[0].codigo, 'taller');

  const c = await fabrica.conductor({ alta: '2026-03-02' });
  assert.equal(c.empleo_vigente, true, 'el disparador del periodo de empleo lo marca vigente');
  assert.equal(c.dni_nie, null);

  const v = await fabrica.vehiculo({ estado: 'X' });
  assert.match(v.matricula, /^\d{4}PRB$/);
  const h = await consulta('SELECT estado_codigo FROM vehiculo_estado_hist WHERE vehiculo_id = $1 AND hasta IS NULL', [v.id]);
  assert.equal(h.rows[0].estado_codigo, 'X');
}));

test('el reloj se puede fijar en un test', t => {
  fijarAhora(t, '2026-11-13T09:00:00+01:00');
  assert.equal(new Date().toISOString(), '2026-11-13T08:00:00.000Z');
  assert.equal(Date.now(), Date.parse('2026-11-13T08:00:00Z'));
});
