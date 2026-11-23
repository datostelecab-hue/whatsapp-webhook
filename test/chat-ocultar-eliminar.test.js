// ============================================================
// EL CHAT — OCULTAR, SALIR Y SACAR DE UN GRUPO, ARCHIVAR Y «ELIMINAR» (db/274)
// ============================================================
// Camilo, 23/11/2026: «en los chats me deja crear grupos, pero no me deja luego
// eliminarlos o quitar gente de los grupos creados». Y: «que se "borren" los
// chats, pero que nunca se borre de la base de datos, que se guarden siempre
// como "Mensajes eliminados"». Lo eliminado lo lee solo el rol desarrollador.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const chat = require('../modules/Chat/chat.service');
const contadores = require('../services/contadores');

beforeEach(() => chat.olvidar());
afterEach(() => contadores.olvidar());

async function oficina({ fabrica, consulta }) {
  const a = (await fabrica.usuario({ nombre: 'Camilo' })).id;
  const b = (await fabrica.usuario({ nombre: 'Angel' })).id;
  const c = (await fabrica.usuario({ nombre: 'Daiane' })).id;
  const d = (await fabrica.usuario({ nombre: 'Fernando' })).id;
  const dev = (await fabrica.usuario({ nombre: 'Dev', rol: 'desarrollador' })).id;
  await consulta(`INSERT INTO usuario_funcion (usuario_id, funcion, suplente, creado_por) VALUES ($1, 'chat_canales', FALSE, $1)`, [dev]);
  for (const u of [a, b, c, d, dev]) await chat.canales(u);
  return { a, b, c, d, dev };
}
const ids = async u => (await chat.canales(u)).canales.map(x => x.id);

test('un grupo: quien lo creó saca a alguien, cualquiera se sale, y se suma gente; con esas personas se empieza otro', () => conBase(async h => {
  const p = await oficina(h);
  const g = await chat.directo(p.a, { usuarios: [p.b, p.c, p.d] });
  assert.equal(g.grupo, true);
  assert.equal(g.puede.quitar, true, 'quien lo creó saca');
  assert.equal((await chat.ficha(p.b, g.id)).puede.quitar, false, 'los demás no');
  await assert.rejects(chat.quitar(p.b, g.id, { usuarioId: p.c }), e => e.status === 403);

  await chat.quitar(p.a, g.id, { usuarioId: p.d });
  await assert.rejects(chat.mensajes(p.d, g.id), e => e.status === 404, 'sacado, ya no lo ve');
  assert.deepEqual((await chat.ficha(p.a, g.id)).miembros.map(x => x.id).sort(), [p.a, p.b, p.c].sort());

  await chat.quitar(p.c, g.id, { usuarioId: p.c });   // se sale
  assert.equal((await ids(p.c)).includes(g.id), false);

  // Ya no es «el directo de esas cuatro personas»: con ellas se empieza otro.
  const otro = await chat.directo(p.a, { usuarios: [p.b, p.c, p.d] });
  assert.notEqual(otro.id, g.id);

  await chat.anadir(p.b, g.id, { usuarioId: p.d });
  assert.equal((await chat.ficha(p.d, g.id)).dentro, true, 'a un grupo suma gente quien está dentro');

  // Un directo de 1 a 1 sigue sin sumar ni sacar a nadie.
  const uno = await chat.directo(p.a, { usuarios: [p.b] });
  assert.equal(uno.grupo, false);
  await assert.rejects(chat.anadir(p.a, uno.id, { usuarioId: p.c }), e => e.status === 409);
  await assert.rejects(chat.quitar(p.a, uno.id, { usuarioId: p.b }), e => e.status === 404);
}));

test('ocultar un directo: sale de SU lista, vuelve si alguien escribe o si lo abre otra vez', () => conBase(async h => {
  const p = await oficina(h);
  const d1 = await chat.directo(p.a, { usuarios: [p.b] });
  await chat.enviar(p.a, d1.id, { texto: 'Hola' });
  await chat.ocultar(p.a, d1.id);
  assert.equal((await ids(p.a)).includes(d1.id), false, 'oculto para quien lo ocultó');
  assert.equal((await ids(p.b)).includes(d1.id), true, 'el otro lo sigue viendo');
  await chat.enviar(p.b, d1.id, { texto: '¿Sigues?' });
  assert.equal((await ids(p.a)).includes(d1.id), true, 'alguien escribe: vuelve');

  await chat.ocultar(p.a, d1.id);
  await chat.directo(p.a, { usuarios: [p.b] });
  assert.equal((await ids(p.a)).includes(d1.id), true, 'abrirlo otra vez lo devuelve');
  const general = Number((await h.consulta(`SELECT id FROM chat_canal WHERE nombre = '1-general-telecab'`)).rows[0].id);
  await assert.rejects(chat.ocultar(p.a, general), e => e.status === 409, 'los canales no se ocultan');
}));

test('archivar un canal: se queda para leer, no se escribe; se saca del archivo', () => conBase(async h => {
  const p = await oficina(h);
  const c = await chat.crearCanal(p.dev, { nombre: 'pruebas-archivo', tipo: 'privado' });
  await chat.anadir(p.dev, c.id, { usuarioId: p.a });
  await assert.rejects(chat.archivar(p.a, c.id), e => e.status === 403, 'ni lo creó ni lleva los canales');
  const f = await chat.archivar(p.dev, c.id);
  assert.deepEqual([f.archivado, f.puede.escribir, f.puede.desarchivar], [true, false, true]);
  const enLista = (await chat.canales(p.a)).canales.find(x => x.id === c.id);
  assert.equal(enLista.archivado, true, 'sale en la lista, como archivado');
  await assert.rejects(chat.enviar(p.a, c.id, { texto: 'hola' }), e => e.status === 409);
  await chat.archivar(p.dev, c.id, { archivar: false });
  assert.equal((await chat.enviar(p.a, c.id, { texto: 'hola' })).mensaje.texto, 'hola');
}));

test('eliminar: desaparece para todos, nada se borra, y el desarrollador lo lee en «Mensajes eliminados»', () => conBase(async h => {
  const p = await oficina(h);
  const g = await chat.directo(p.a, { usuarios: [p.b, p.c] });
  const m = (await chat.enviar(p.b, g.id, { texto: 'Esto no se pierde' })).mensaje;
  await assert.rejects(chat.eliminar(p.b, g.id), e => e.status === 403, 'un grupo lo elimina quien lo creó');
  await chat.eliminar(p.a, g.id);

  for (const u of [p.a, p.b, p.c]) {
    assert.equal((await ids(u)).includes(g.id), false);
    await assert.rejects(chat.mensajes(u, g.id), e => e.status === 404, 'para los de dentro, ya no existe');
  }
  const fila = (await h.consulta('SELECT texto FROM chat_mensaje WHERE id = $1', [m.id])).rows[0];
  assert.equal(fila.texto, 'Esto no se pierde', 'en la base sigue');

  await assert.rejects(chat.eliminados(p.a), e => e.status === 403, 'solo el desarrollador');
  const lista = (await chat.eliminados(p.dev)).eliminados;
  assert.ok(lista.some(x => x.id === g.id && x.mensajes === 1));
  const leida = await chat.mensajes(p.dev, g.id);
  assert.equal(leida.mensajes[0].texto, 'Esto no se pierde', 'el desarrollador lo lee');
  const ficha = await chat.ficha(p.dev, g.id);
  assert.deepEqual([ficha.puede.escribir, !!ficha.eliminado], [false, true], 'solo leer');
  await assert.rejects(chat.enviar(p.dev, g.id, { texto: 'x' }), e => e.status === 409);

  // Con esas mismas personas se puede volver a empezar uno.
  assert.notEqual((await chat.directo(p.a, { usuarios: [p.b, p.c] })).id, g.id);
  // Un 1 a 1 lo elimina cualquiera de los dos.
  const uno = await chat.directo(p.a, { usuarios: [p.b] });
  await chat.eliminar(p.b, uno.id);
  assert.equal((await ids(p.a)).includes(uno.id), false);
}));
