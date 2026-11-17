// ============================================================
// LA MIGRACIÓN DE SLACK (ítem 2, entrega 2d, db/259-260)
// ============================================================
// Lo que decidió Camilo el 17/11/2026: el ERP NO habla con Slack. Slack se lee
// fuera, mensaje a mensaje, y aquí se sube una exportación (los mensajes) y
// luego sus ficheros. Los 19 canales, el privado #efectivo (que se crea, con su
// gente de Slack) y los directos de Ignacio. Y que NO avise de nada: ni
// notificaciones, ni no leídos, ni menciones pendientes. Se puede repetir sin
// duplicar. Aquí, la exportación es de mentira.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

process.env.ALMACEN = 'disco';
process.env.ALMACEN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'telecab-slack-test-'));

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const chat = require('../modules/Chat/chat.service');
const slack = require('../modules/Chat/slack.service');
const contadores = require('../services/contadores');
const push = require('../services/notificacionesPush');

const enviarPush = push.enviar;
let avisos = 0;
beforeEach(() => { chat.olvidar(); slack.olvidar(); avisos = 0; push.enviar = async () => { avisos++; return {}; }; });
afterEach(() => { contadores.olvidar(); push.enviar = enviarPush; });

// ── Una exportación de mentira (como la deja reconstruir.js) ────────────────
const TS = n => `${1788500000 + n}.000${String(n).padStart(3, '0')}`;   // septiembre de 2026
const msj = (ts, user, nombre, texto, extra = {}) => ({ ts, user, nombre, texto, hilo: null, borrado: false, sistema: false, reacciones: [], ficheros: [], ...extra });
function exportacion({ ignaciaEmail }) {
  return {
    generado: '2026-11-17T13:00:00.000Z', fuente: 'pruebas', yo: 'UIGN',
    personas: [
      { id: 'UIGN', nombre: 'Ignacia Slackera', email: ignaciaEmail.toUpperCase() },
      { id: 'UKAR', nombre: 'Karen Slackera', email: 'karen.personal@gmail.invalid' },
      { id: 'UPEP', nombre: 'Pepe Externo', email: null },
      { id: 'BBOT', nombre: 'Avisador', email: null },
    ],
    conversaciones: [
      { id: 'CGEN', tipo: 'publico', nombre: '1-general-telecab', con: null, miembros: [], mensajes: [
        msj(TS(0), 'UKAR', 'Karen Slackera', '<@UKAR|Karen Slackera> se ha unido al canal', { sistema: true }),
        msj(TS(1), 'UIGN', 'Ignacia Slackera', 'Hola <!channel>, mirad <https://telecab.es|telecab.es> y avisad a <@UKAR|Karen Slackera> :+1:', {
          reacciones: [{ nombre: '+1', usuarios: ['UKAR'] }, { nombre: 'tada', usuarios: ['UKAR'] }] }),
        msj(TS(2), 'UKAR', 'Karen Slackera', 'Visto', { hilo: TS(1) }),
        msj(TS(3), 'UPEP', 'Pepe Externo', 'Soy de fuera &amp; escribo', { ficheros: [{ id: 'F1', nombre: 'parte.pdf', mime: 'application/pdf' }] }),
        msj(TS(4), 'USLACKBOT', 'Slackbot', 'This message was deleted.', { borrado: true }),
        msj(TS(5), 'BBOT', 'Avisador', 'Forwarded message from Avisador: Parte diario listo'),
      ] },
      { id: 'COTR', tipo: 'publico', nombre: 'random', con: null, miembros: [], mensajes: [msj(TS(6), 'UKAR', 'Karen Slackera', 'Hola')] },
      { id: 'GEFE', tipo: 'privado', nombre: 'efectivo', con: null, miembros: ['UIGN', 'UKAR', 'UPEP'], mensajes: [
        msj(TS(7), 'UKAR', 'Karen Slackera', 'Caja cuadrada'),
      ] },
      { id: 'DKAR', tipo: 'directo', nombre: null, con: 'UKAR', miembros: [], mensajes: [msj(TS(9), 'UIGN', 'Ignacia Slackera', '¿Vienes mañana?')] },
      { id: 'DPEP', tipo: 'directo', nombre: null, con: 'UPEP', miembros: [], mensajes: [msj(TS(11), 'UPEP', 'Pepe Externo', 'Hola')] },
    ],
  };
}

async function oficina({ fabrica }) {
  const ignacia = await fabrica.usuario({ nombre: 'Ignacia', apellidos: 'Slackera', email: `ignacia${Date.now()}@telecab.invalid` });
  const karen = await fabrica.usuario({ nombre: 'Karen', apellidos: 'Slackera' });
  for (const u of [ignacia, karen]) await chat.canales(u.id);   // entran en los públicos
  const datos = exportacion({ ignaciaEmail: ignacia.email });
  return { a: ignacia.id, k: karen.id, datos };
}
const pdf = () => Readable.from([Buffer.from('%PDF-1.4 parte de prueba')]);

test('el texto de Slack, al del chat', () => {
  const personas = new Map([['U1', { usuarioId: 9, nombre: 'Karen' }], ['U2', { usuarioId: null, nombre: 'Pepe Externo' }]]);
  const t = (x, extra) => slack.textoDeSlack(x, { personas, canales: new Map([['C1', '9-rrhh']]), ...extra });
  assert.equal(t('Hola <@U1|Karen> y <@U2>'), 'Hola <@9> y @Pepe Externo');
  assert.equal(t('<!here> <!channel> <!everyone|everyone>'), '<!canal> <!canal> <!canal>');
  assert.equal(t('Mira <#C1> y <#C2|nominas>'), 'Mira #9-rrhh y #nominas');
  assert.equal(t('<https://telecab.es|telecab.es> y <https://x.es/a|el parte>'), 'https://telecab.es y el parte (https://x.es/a)');
  assert.equal(t('<mailto:a@b.es|a@b.es> <tel:+34600|600>'), 'a@b.es 600');
  assert.equal(t('1 &lt; 2 &amp;&amp; 3 &gt; 2'), '1 < 2 && 3 > 2');
  assert.equal(t('Hecho :white_check_mark: :thumbsup::skin-tone-3: :inventado:'), 'Hecho ✅ 👍 :inventado:');
  assert.equal(t('*negrita* _cursiva_ ~tachado~ `código`'), '*negrita* _cursiva_ ~tachado~ `código`', 'el formato es el mismo');
  assert.equal(t('Ojo\nForwarded message from Mary: 8026LTT no entregó'), 'Ojo\nReenviado de Mary: 8026LTT no entregó');
  assert.equal(slack.reaccionDeSlack('+1::skin-tone-2'), 'ok');
  assert.equal(slack.reaccionDeSlack('heart_eyes'), 'corazon');
  assert.equal(slack.reaccionDeSlack('tada'), null, 'las que no son de las seis no se traen');
});

test('la exportación: se comprueba al subirla, y sin ella no se simula', () => conBase(async () => {
  assert.throws(() => slack.lanzar('simular', 1), e => e.status === 409 && /exportación/.test(e.message));
  assert.throws(() => slack.cargar({ conversaciones: 'x' }), e => e.status === 400);
  assert.throws(() => slack.cargar({ yo: 'UIGN', personas: [], conversaciones: [{ id: 'CGEN', tipo: 'publico', mensajes: [{ ts: 'ayer', texto: '' }] }] }),
    e => e.status === 400 && /mensaje/.test(e.message));
  const r = slack.cargar(exportacion({ ignaciaEmail: 'x@y.invalid' }));
  assert.deepEqual([r.conversaciones, r.mensajes, r.ficheros, r.personas], [5, 9, 1, 4], 'sin contar «se ha unido»');
  assert.throws(() => slack.lanzar('borrar', 1), e => e.status === 400);
}));

test('simular: dice qué traería, quién es quién y quién entra en cada privado, sin escribir ningún mensaje', () => conBase(async h => {
  const p = await oficina(h);
  const antes = Number((await h.consulta('SELECT count(*) FROM chat_mensaje')).rows[0].count);
  const inf = await slack.ejecutar('simular', p.a, () => {}, p.datos);
  assert.equal(Number((await h.consulta('SELECT count(*) FROM chat_mensaje')).rows[0].count), antes, 'ni un mensaje');
  assert.equal(Number((await h.consulta(`SELECT count(*) FROM chat_canal WHERE nombre = 'efectivo'`)).rows[0].count), 0, 'ni un canal');

  const quien = new Map((await h.consulta('SELECT slack_id, usuario_id, como, es_bot FROM chat_slack_usuario')).rows.map(x => [x.slack_id, x]));
  assert.deepEqual([Number(quien.get('UIGN').usuario_id), quien.get('UIGN').como], [p.a, 'email'], 'por el correo, sin mirar mayúsculas');
  assert.deepEqual([Number(quien.get('UKAR').usuario_id), quien.get('UKAR').como], [p.k, 'nombre'], 'el correo no casa: por el nombre');
  assert.equal(quien.get('UPEP').usuario_id, null, 'Pepe no está en el ERP');
  assert.equal(quien.get('BBOT').es_bot, true);

  const por = id => inf.canales.find(c => c.id === id);
  assert.deepEqual(
    (({ destino, mensajes, respuestas, ficheros, nuevos, reaccionesFuera }) => ({ destino, mensajes, respuestas, ficheros, nuevos, reaccionesFuera }))(por('CGEN')),
    { destino: '#1-general-telecab', mensajes: 4, respuestas: 1, ficheros: 1, nuevos: 5, reaccionesFuera: 1 },
    'sin «se ha unido»; el hilo, con su respuesta');
  assert.deepEqual([por('COTR').destino, por('COTR').motivo], ['no se trae', 'no existe en el chat']);
  const efe = por('GEFE');
  assert.equal(efe.destino, '#efectivo (nuevo, privado)');
  assert.deepEqual(efe.entran, ['Ignacia Slackera', 'Karen Slackera'], 'su gente de Slack que tiene usuario');
  assert.deepEqual(efe.sinUsuario, ['Pepe Externo'], 'y quien no lo tiene, dicho');
  assert.deepEqual([por('DKAR').destino, por('DKAR').slack], ['directo nuevo', 'Directo con Karen Slackera']);
  assert.equal(por('DPEP').destino, 'no se trae');
  assert.match(por('DPEP').motivo, /Pepe Externo no tiene usuario del ERP/);
}));

test('migrar: en su sitio, con su autor, hilos, reacciones y menciones, sin avisar a nadie; los ficheros, después; repetir no duplica', () => conBase(async h => {
  const p = await oficina(h);
  const general = Number((await h.consulta(`SELECT id FROM chat_canal WHERE nombre = '1-general-telecab'`)).rows[0].id);
  // Algo escrito en el chat antes de migrar: lo de Slack es de antes y sale encima.
  await chat.enviar(p.a, general, { texto: 'Ya estamos en el chat' });
  const inf = await slack.ejecutar('migrar', p.a, () => {}, p.datos);
  assert.equal(inf.totales.nuevos, 7);
  assert.deepEqual(inf.avisos, []);

  const { mensajes } = await chat.mensajes(p.k, general);
  assert.deepEqual(mensajes.map(m => m.texto), [
    'Hola <!canal>, mirad https://telecab.es y avisad a <@' + p.k + '> 👍',
    'Soy de fuera & escribo',
    '(Mensaje borrado en Slack)',
    'Reenviado de Avisador: Parte diario listo',
    'Ya estamos en el chat',
  ], 'por fecha, no por número');
  const [hola, pepe, , bot, nativo] = mensajes;
  assert.deepEqual([hola.autorId, hola.importado, nativo.importado], [p.a, true, false]);
  assert.equal(new Date(hola.creadoAt).getTime(), 1788500001000, 'con la hora de Slack');
  assert.deepEqual([pepe.autorId, pepe.autor, pepe.conAdjuntos], [null, 'Pepe E.', true], 'sin usuario: con su nombre de Slack');
  assert.equal(bot.autor, 'Avisador');
  assert.deepEqual(hola.reacciones.map(r => [r.emoji, r.nombres]), [['ok', ['Karen S.']]], 'la de :tada: no se trae');
  assert.equal(hola.respuestas, 1);
  assert.deepEqual(hola.menciones, { usuarios: [p.k], todos: true });
  const { respuestas } = await chat.hilo(p.k, hola.id);
  assert.deepEqual(respuestas.map(r => [r.texto, r.autorId]), [['Visto', p.k]]);

  // #efectivo, privado y con su gente; el directo de Ignacia con Karen.
  const deKaren = (await chat.canales(p.k)).canales;
  const efectivo = deKaren.find(c => c.nombre === 'efectivo');
  assert.equal(efectivo && efectivo.tipo, 'privado');
  assert.deepEqual((await h.consulta('SELECT usuario_id FROM chat_miembro WHERE canal_id = $1 ORDER BY usuario_id', [efectivo.id])).rows.map(x => Number(x.usuario_id)),
    [p.a, p.k].sort((x, y) => x - y));
  const directo = deKaren.find(c => c.tipo === 'directo');
  assert.deepEqual((await chat.mensajes(p.k, directo.id)).mensajes.map(m => [m.texto, m.autorId]), [['¿Vienes mañana?', p.a]]);

  // Nada avisa: ni push, ni no leídos (el único, el escrito en el chat), ni menciones pendientes.
  assert.equal(avisos, 0, 'ninguna notificación');
  for (const c of deKaren) assert.deepEqual([c.nombre || c.tipo, c.sinLeer, c.menciones], [c.nombre || c.tipo, c.nombre === '1-general-telecab' ? 1 : 0, 0]);

  // Los ficheros: apuntados al migrar, subidos después; una vez.
  assert.deepEqual(await slack.ficherosPendientes(), [{ id: 'F1', nombre: 'parte.pdf' }]);
  assert.deepEqual((await slack.estado()).ficheros, { total: 1, pendientes: 1 });
  await assert.rejects(slack.subirFichero(p.a, 'FNADA', pdf()), e => e.status === 404);
  assert.deepEqual(await slack.subirFichero(p.a, 'F1', pdf()), { subido: true });
  assert.deepEqual(await slack.subirFichero(p.a, 'F1', pdf()), { ya: true });
  const conFichero = (await chat.mensajes(p.k, general)).mensajes.find(m => m.id === pepe.id);
  assert.deepEqual(conFichero.adjuntos.map(a => [a.nombre, a.mime]), [['parte.pdf', 'application/pdf']]);
  assert.deepEqual((await slack.estado()).ficheros, { total: 1, pendientes: 0 });

  // Repetir: nada nuevo, nada duplicado.
  const otra = await slack.ejecutar('migrar', p.a, () => {}, p.datos);
  assert.equal(otra.totales.nuevos, 0);
  assert.equal(Number((await h.consulta('SELECT count(*) FROM chat_mensaje WHERE slack_ts IS NOT NULL')).rows[0].count), 7);
  assert.deepEqual(await slack.ficherosPendientes(), []);
}));

test('quién es quién: lo puesto a mano no lo cambia otra simulación, y vale al migrar', () => conBase(async h => {
  const p = await oficina(h);
  await slack.ejecutar('simular', p.a, () => {}, p.datos);
  const yo = await h.fabrica.usuario({ nombre: 'Pepe', apellidos: 'De Verdad' });
  const r = await slack.ponerPersona(p.a, { slackId: 'UPEP', usuarioId: yo.id });
  const pepe = r.personas.find(x => x.slackId === 'UPEP');
  assert.deepEqual([pepe.usuarioId, pepe.como, pepe.usuario], [yo.id, 'a mano', 'Pepe De Verdad']);
  await assert.rejects(slack.ponerPersona(p.a, { slackId: 'UNADIE', usuarioId: yo.id }), e => e.status === 404);
  const inf = await slack.ejecutar('simular', p.a, () => {}, p.datos);
  const otra = (await h.consulta(`SELECT usuario_id, como FROM chat_slack_usuario WHERE slack_id = 'UPEP'`)).rows[0];
  assert.deepEqual([Number(otra.usuario_id), otra.como], [yo.id, 'a mano'], 'la simulación no lo pisa');
  const efe = inf.canales.find(c => c.id === 'GEFE');
  assert.deepEqual([efe.entran.length, efe.sinUsuario], [3, []], 'ya entra Pepe en #efectivo');
  await slack.ejecutar('migrar', p.a, () => {}, p.datos);
  const m = (await h.consulta(`SELECT autor_id FROM chat_mensaje WHERE slack_ts = $1`, [TS(3)])).rows[0];
  assert.equal(Number(m.autor_id), yo.id, 'Pepe, con su usuario');
}));
