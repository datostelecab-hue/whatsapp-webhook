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
