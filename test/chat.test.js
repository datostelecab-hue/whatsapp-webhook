// ============================================================
// EL CHAT INTERNO (ítem 2, entrega 2a, db/256)
// ============================================================
// Lo que decidió Camilo el 17/11/2026 y lo que pide la hoja de ruta para la 2a:
//   · los públicos, de toda la oficina y con toda la oficina dentro;
//   · los privados y los directos, solo de quien está dentro;
//   · crean canales los puestos de Dirección y Desarrollo (chat_canales);
//   · menciones, no leídos e hilos de un nivel.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const chat = require('../modules/Chat/chat.service');
const contadores = require('../services/contadores');

beforeEach(() => chat.olvidar());
afterEach(() => contadores.olvidar());

async function oficina({ fabrica, consulta }) {
  const a = (await fabrica.usuario({ nombre: 'Ignacio' })).id;
  const b = (await fabrica.usuario({ nombre: 'Karen' })).id;
  const c = (await fabrica.usuario({ nombre: 'Laura' })).id;
  await consulta(`INSERT INTO usuario_funcion (usuario_id, funcion, suplente, creado_por) VALUES ($1, 'chat_canales', FALSE, $1)`, [a]);
  const general = Number((await consulta(`SELECT id FROM chat_canal WHERE nombre = '1-general-telecab'`)).rows[0].id);
  // Ya están en la oficina: el ERP los ha visto (entran en los públicos al verlos
  // por primera vez, y lo de antes no les cuenta como no leído).
  for (const u of [a, b, c]) await chat.canales(u);
  return { a, b, c, general };
}
const de = (lista, id) => lista.canales.find(x => x.id === id);

test('los públicos son de toda la oficina; los privados y los directos, de quien está dentro', () => conBase(async h => {
  const p = await oficina(h);
  const suyos = await chat.canales(p.b);
  assert.equal(suyos.canales.filter(x => x.tipo === 'publico').length, 16, 'los 16 de Slack, y dentro desde el primer día');
  assert.equal(suyos.yo.puedeCrear, false);

  await assert.rejects(chat.crearCanal(p.b, { nombre: 'compras' }), e => e.status === 403, 'crear canales es de Dirección y Desarrollo');
  const priv = await chat.crearCanal(p.a, { nombre: 'Compras Ñandú', tipo: 'privado' });
  assert.equal(priv.nombre, 'compras-nandu', 'el nombre, como en Slack');
  await assert.rejects(chat.ficha(p.b, priv.id), e => e.status === 404, 'a quien no está, ni existe');
  await assert.rejects(chat.mensajes(p.b, priv.id), e => e.status === 404);
  await chat.anadir(p.a, priv.id, { usuarioId: p.b });
  assert.equal((await chat.ficha(p.b, priv.id)).dentro, true, 'añadida, lo ve');
  await assert.rejects(chat.crearCanal(p.a, { nombre: 'compras nandu' }), e => e.status === 409, 'dos canales no se llaman igual');

  const d1 = await chat.directo(p.a, { usuarios: [p.b] });
  assert.equal((await chat.directo(p.b, { usuarios: [p.a] })).id, d1.id, 'el mismo directo, lo abra quien lo abra');
  assert.equal(d1.titulo, 'Karen De Prueba');
  await assert.rejects(chat.mensajes(p.c, d1.id), e => e.status === 404, 'un directo es privado');

  const fuera = (await h.fabrica.usuario({ nombre: 'Luis', estado: 'bloqueado' })).id;
  await assert.rejects(chat.canales(fuera), e => e.status === 403, 'el chat es de la oficina que entra en el ERP');
}));

test('las menciones y los no leídos; leer los baja; los hilos son de un nivel y no cuentan como no leídos', () => conBase(async h => {
  const p = await oficina(h);
  const m = (await chat.enviar(p.a, p.general, { texto: `Hola <@${p.b}>, y a todos <!canal>` })).mensaje;
  assert.deepEqual(m.menciones, { usuarios: [p.b], todos: true });

  let b = de(await chat.canales(p.b), p.general);
  assert.deepEqual([b.sinLeer, b.menciones], [1, 1]);
  assert.equal(de(await chat.canales(p.c), p.general).menciones, 1, '@canal le cuenta a todos los del canal');
  assert.equal(de(await chat.canales(p.a), p.general).sinLeer, 0, 'lo suyo, leído');
  const n = await contadores.recuentos({ id: p.b });
  assert.deepEqual([n['chat.menu'].n, n['chat.menu'].tono], [1, 'aviso'], 'la mención, en rojo en el menú');

  await chat.leido(p.b, p.general, { hasta: m.id });
  b = de(await chat.canales(p.b), p.general);
  assert.deepEqual([b.sinLeer, b.menciones], [0, 0], 'leído, baja');

  const r1 = (await chat.enviar(p.b, p.general, { texto: 'Visto', padreId: m.id })).mensaje;
  const r2 = (await chat.enviar(p.c, p.general, { texto: `De acuerdo, <@${p.a}>`, padreId: r1.id })).mensaje;
  assert.equal(r2.padreId, m.id, 'responder a una respuesta es responder al de arriba');
  const hilo = await chat.hilo(p.a, r2.id);
  assert.deepEqual([hilo.raiz.id, hilo.raiz.respuestas, hilo.respuestas.map(x => x.id)], [m.id, 2, [r1.id, r2.id]]);
  const a = de(await chat.canales(p.a), p.general);
  assert.deepEqual([a.sinLeer, a.menciones], [0, 1], 'las respuestas no son no leídos del canal; la mención en el hilo, sí');
  const arriba = await chat.mensajes(p.a, p.general);
  assert.deepEqual(arriba.mensajes.map(x => x.id), [m.id], 'en el canal, solo los de arriba');

  const d = await chat.directo(p.c, { usuarios: [p.b] });
  await chat.enviar(p.c, d.id, { texto: 'Un momento' });
  assert.equal((await contadores.recuentos({ id: p.b }))['chat.menu'].n, 1, 'un directo sin leer, también en rojo');
}));

test('en un privado solo cuenta la mención a quien está dentro', () => conBase(async h => {
  const p = await oficina(h);
  const priv = await chat.crearCanal(p.a, { nombre: 'direccion', tipo: 'privado' });
  const m = (await chat.enviar(p.a, priv.id, { texto: `<@${p.b}> mira esto` })).mensaje;
  assert.deepEqual(m.menciones.usuarios, [], 'Karen no está: no lo podría leer');
  assert.equal(chat.nombreDeCanal('#Bajas Médicas  2026'), 'bajas-medicas-2026');
}));
