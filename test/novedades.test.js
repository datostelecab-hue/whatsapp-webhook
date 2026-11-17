// ============================================================
// LAS NOVEDADES (V3, db/253)
// ============================================================
// La ventana de cada versión sale UNA vez por persona, en cualquier
// dispositivo; y queda si hizo el recorrido guiado o lo dejó.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const novedades = require('../modules/Novedades/novedades.service');

test('la ventana sale hasta que se ve una vez; el recorrido queda, y un «hecho» no se pisa', () => conBase(async ({ fabrica }) => {
  const u = await fabrica.usuario({ nombre: 'Laura' });
  const v = novedades.ACTUAL;
  assert.deepEqual(await novedades.estado(u.id), { version: v, pendiente: true, recorrido: null });

  assert.equal((await novedades.marcar(u.id, { version: v })).pendiente, false, 'cerrarla la da por vista');
  assert.equal((await novedades.estado(u.id)).pendiente, false, 'y no vuelve a salir');

  assert.equal((await novedades.marcar(u.id, { version: v, recorrido: 'hecho' })).recorrido, 'hecho');
  assert.equal((await novedades.marcar(u.id, { version: v, recorrido: 'saltado' })).recorrido, 'hecho', 'un recorrido hecho no se pisa con uno saltado');

  const otra = await fabrica.usuario({ nombre: 'Diana' });
  assert.equal((await novedades.estado(otra.id)).pendiente, true, 'cada persona, la suya');
  assert.deepEqual(await novedades.cuentas(v), { vistas: 1, recorridos: 1, saltados: 0 });
}));

test('solo la versión de ahora, y el recorrido acaba «hecho» o «saltado»', () => conBase(async ({ fabrica }) => {
  const u = await fabrica.usuario();
  await assert.rejects(novedades.marcar(u.id, { version: 'v1' }), e => e.status === 400);
  await assert.rejects(novedades.marcar(u.id, { version: novedades.ACTUAL, recorrido: 'a medias' }), e => e.status === 400);
  await assert.rejects(novedades.estado(null), e => e.status === 401);
}));

test('el recorrido de una pantalla (chat, tablero): una vez por persona, y un «hecho» no se pisa', () => conBase(async ({ fabrica }) => {
  const u = await fabrica.usuario({ nombre: 'Karen' });
  assert.deepEqual(await novedades.pantalla(u.id, 'chat'), { pantalla: 'chat', visto: false, recorrido: null }, 'la primera vez, sale');
  assert.deepEqual(await novedades.marcarPantalla(u.id, 'chat', 'saltado'), { pantalla: 'chat', visto: true, recorrido: 'saltado' }, 'dejarlo también cuenta: no vuelve a salir solo');
  assert.equal((await novedades.marcarPantalla(u.id, 'chat', 'hecho')).recorrido, 'hecho', 'repetirlo entero lo deja hecho');
  assert.equal((await novedades.marcarPantalla(u.id, 'chat', 'saltado')).recorrido, 'hecho', 'y un hecho no se pisa');
  assert.equal((await novedades.pantalla(u.id, 'tablero')).visto, false, 'cada pantalla, el suyo');
  assert.equal((await novedades.estado(u.id)).pendiente, true, 'y no se mezcla con la ventana de la versión');
  await assert.rejects(novedades.pantalla(u.id, 'nominas'), e => e.status === 404, 'solo las pantallas que tienen recorrido');
  await assert.rejects(novedades.marcarPantalla(u.id, 'tablero', 'a medias'), e => e.status === 400);
}));
