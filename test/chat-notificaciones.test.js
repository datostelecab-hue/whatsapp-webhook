// ============================================================
// EL CHAT, COMO NOTIFICACIÓN AL DISPOSITIVO (17/11/2026)
// ============================================================
// Camilo: «además de menciones, todo lo que sea referente al usuario debe de
// llegarle como noti». Y decidió qué es eso en el chat: los directos, las
// menciones, @canal, las respuestas en sus hilos, que le añadan o le saquen de
// un privado, que le anulen un mensaje, y las reacciones y los fijados de los
// suyos. Una por mensaje y persona, nunca a quien lo escribe.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const chat = require('../modules/Chat/chat.service');
const contadores = require('../services/contadores');
const push = require('../services/notificacionesPush');

let llegadas = [];
const enviarDeVerdad = push.enviar;
beforeEach(() => {
  chat.olvidar(); chat.usarVistaPrevia(null); llegadas = [];
  push.enviar = async (ids, aviso) => { [].concat(ids).forEach(id => llegadas.push({ id: Number(id), ...aviso })); return {}; };
});
afterEach(() => { contadores.olvidar(); push.enviar = enviarDeVerdad; });

async function oficina({ fabrica, consulta }) {
  const a = (await fabrica.usuario({ nombre: 'Ignacio' })).id;   // lleva los canales
  const b = (await fabrica.usuario({ nombre: 'Karen' })).id;
  const c = (await fabrica.usuario({ nombre: 'Laura' })).id;
  await consulta(`INSERT INTO usuario_funcion (usuario_id, funcion, suplente, creado_por) VALUES ($1, 'chat_canales', FALSE, $1)`, [a]);
  const general = Number((await consulta(`SELECT id FROM chat_canal WHERE nombre = '1-general-telecab'`)).rows[0].id);
  for (const u of [a, b, c]) await chat.canales(u);
  return { a, b, c, general };
}
const enviar = (u, canal, texto, extra = {}) => chat.enviar(u, canal, { texto, ...extra }).then(r => r.mensaje);
/** Lo que ha llegado, como [id, título], y se vacía para lo siguiente. */
async function llegado() {
  await chat.esperarPendientes();
  const r = llegadas.map(x => [x.id, x.titulo]).sort((x, y) => x[0] - y[0] || x[1].localeCompare(y[1]));
  const todo = llegadas;
  llegadas = [];
  return Object.assign(r, { todo });
}

test('un mensaje normal no avisa a nadie; una mención, @canal y un directo, sí; nunca a quien escribe', () => conBase(async h => {
  const p = await oficina(h);
  await enviar(p.a, p.general, 'Buenos días a todos');
  assert.deepEqual([...await llegado()], [], 'un mensaje de canal, sin nombrar a nadie, no es una notificación');

  const m = await enviar(p.a, p.general, `<@${p.b}> mira el turno de mañana`);
  const r = await llegado();
  assert.deepEqual([...r], [[p.b, 'Ignacio P. te ha mencionado en #1-general-telecab']]);
  assert.equal(r.todo[0].cuerpo, '@Karen P. mira el turno de mañana', 'con el nombre, no con <@id>');
  assert.equal(r.todo[0].url, `/chat?canal=${p.general}&mensaje=${m.id}`);
  assert.equal(r.todo[0].etiqueta, `chat-${p.general}`, 'la de un canal sustituye a la anterior');

  await enviar(p.c, p.general, `<!canal> hoy cerramos a las 15:00, <@${p.b}> también`);
  assert.deepEqual([...await llegado()].filter(x => [p.a, p.b, p.c].includes(x[0])), [
    [p.a, 'Laura P. avisa a todo #1-general-telecab'],
    [p.b, 'Laura P. te ha mencionado en #1-general-telecab'],
  ], 'una sola por persona: a Karen, la mención; a quien escribe, nada');

  const d = await chat.directo(p.a, { usuarios: [p.b] });
  await enviar(p.a, d.id, '¿Puedes llamarme? Mi DNI es 12345678Z');
  const dr = await llegado();
  assert.deepEqual([...dr], [[p.b, 'Ignacio P.']], 'el directo, con el nombre de quien escribe');
  assert.equal(dr.todo[0].cuerpo, '¿Puedes llamarme? Mi DNI es •••', 'sin DNI en la pantalla bloqueada');
}));

test('las respuestas en un hilo avisan a quien lo empezó y a quien ha escrito en él', () => conBase(async h => {
  const p = await oficina(h);
  const raiz = await enviar(p.a, p.general, 'Propuesta de turnos para diciembre');
  await enviar(p.b, p.general, 'A mí me vale', { padreId: raiz.id });
  assert.deepEqual([...await llegado()], [[p.a, 'Karen P. ha respondido en un hilo de #1-general-telecab']]);
  await enviar(p.c, p.general, 'A mí también', { padreId: raiz.id });
  assert.deepEqual([...await llegado()], [
    [p.a, 'Laura P. ha respondido en un hilo de #1-general-telecab'],
    [p.b, 'Laura P. ha respondido en un hilo de #1-general-telecab'],
  ]);
}));

test('reacciones, fijados, añadir y sacar de un privado, y anular lo de otro', () => conBase(async h => {
  const p = await oficina(h);
  const m = await enviar(p.b, p.general, 'Subo el cuadrante nuevo');
  await chat.reaccionar(p.c, m.id, { emoji: 'ok' });
  assert.deepEqual([...await llegado()], [[p.b, 'Laura P. ha reaccionado 👍 a tu mensaje']]);
  await chat.reaccionar(p.c, m.id, { emoji: 'ok' });
  assert.deepEqual([...await llegado()], [], 'quitarla no avisa');
  await chat.reaccionar(p.b, m.id, { emoji: 'hecho' });
  assert.deepEqual([...await llegado()], [], 'a uno mismo, nada');
  await chat.fijar(p.a, m.id, { fijar: true });
  assert.deepEqual([...await llegado()], [[p.b, 'Ignacio P. ha fijado tu mensaje en #1-general-telecab']]);

  const priv = await chat.crearCanal(p.a, { nombre: 'direccion', tipo: 'privado' });
  await chat.anadir(p.a, priv.id, { usuarioId: p.b });
  assert.deepEqual([...await llegado()], [[p.b, 'Te han añadido a #direccion']]);
  await chat.quitar(p.a, priv.id, { usuarioId: p.b });
  assert.deepEqual([...await llegado()], [[p.b, 'Te han sacado de #direccion']]);

  await chat.anular(p.a, m.id, { motivo: 'Lleva datos personales' });
  const r = await llegado();
  assert.deepEqual([...r], [[p.b, 'Han anulado un mensaje tuyo en #1-general-telecab']]);
  assert.equal(r.todo[0].cuerpo, 'Ignacio P.: Lleva datos personales');
  const propio = await enviar(p.c, p.general, 'Me equivoqué');
  await chat.anular(p.c, propio.id, {});
  assert.deepEqual([...await llegado()], [], 'anular lo propio no avisa a nadie');
}));

test('al editar, solo avisa a quien nombra ahora y antes no', () => conBase(async h => {
  const p = await oficina(h);
  const m = await enviar(p.a, p.general, `<@${p.b}> revisa esto`);
  await llegado();
  await chat.editar(p.a, m.id, { texto: `<@${p.b}> revisa esto, y tú también <@${p.c}>` });
  assert.deepEqual([...await llegado()], [[p.c, 'Ignacio P. te ha mencionado en #1-general-telecab']]);
}));
