// ============================================================
// LA MIGRACIÓN DE SLACK (ítem 2, entrega 2d, db/259)
// ============================================================
// Lo que decidió Camilo el 17/11/2026: con un token de solo lectura y un
// proceso del servidor; los 19 canales y #efectivo (privado, que se crea); los
// directos de quien da el token. Y que NO avise de nada: ni notificaciones, ni
// no leídos, ni menciones pendientes. Se puede repetir sin duplicar.
//
// Slack, aquí, es de mentira: slack.usarSlack({ pedir, descargar }).
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
beforeEach(() => { chat.olvidar(); avisos = 0; push.enviar = async () => { avisos++; return {}; }; });
afterEach(() => { contadores.olvidar(); push.enviar = enviarPush; slack.usarSlack(); });

// ── Un Slack de mentira ─────────────────────────────────────────────────────
const TS = n => `${1788500000 + n}.000${String(n).padStart(3, '0')}`;   // septiembre de 2026
function slackDeMentira({ ignaciaEmail }) {
  const usuarios = [
    { id: 'UIGN', name: 'ignacia', profile: { real_name: 'Ignacia Slackera', email: ignaciaEmail.toUpperCase() } },
    { id: 'UKAR', name: 'karen', profile: { real_name: 'Karen Slackera', email: 'karen.personal@gmail.invalid' } },
    { id: 'UPEP', name: 'pepe', profile: { real_name: 'Pepe Externo' } },
    { id: 'BBOT', name: 'avisador', is_bot: true, profile: { real_name: 'Avisador' } },
    { id: 'USLACKBOT', name: 'slackbot', profile: { real_name: 'Slackbot' } },
  ];
  const canales = [
    { id: 'CGEN', name: '1-general-telecab', is_channel: true, topic: { value: 'Lo de todos' }, purpose: { value: '' } },
    { id: 'CRAN', name: 'random', is_channel: true },
    { id: 'GEFE', name: 'efectivo', is_private: true, is_channel: true, created: 1788400000, creator: 'UIGN' },
    { id: 'DKAR', is_im: true, user: 'UKAR' },
    { id: 'DPEP', is_im: true, user: 'UPEP' },
  ];
  const historia = {
    CGEN: [
      // Slack da lo más nuevo primero.
      { type: 'message', ts: TS(5), user: 'BBOT', bot_id: 'B1', text: '', attachments: [{ fallback: 'Parte diario listo' }] },
      { type: 'message', ts: TS(3), user: 'UPEP', text: 'Soy de fuera &amp; escribo',
        files: [{ id: 'F1', name: 'parte.pdf', mimetype: 'application/pdf', url_private_download: 'https://files.slack.com/files-pri/T1-F1/parte.pdf' }] },
      { type: 'message', ts: TS(1), user: 'UIGN', thread_ts: TS(1), reply_count: 1,
        text: 'Hola <!channel>, mirad <https://telecab.es|telecab.es> y avisad a <@UKAR> :+1:',
        reactions: [{ name: '+1', users: ['UKAR'], count: 1 }, { name: 'tada', users: ['UKAR'], count: 1 }] },
      { type: 'message', subtype: 'channel_join', ts: TS(0), user: 'UKAR', text: '<@UKAR> se ha unido' },
    ],
    GEFE: [{ type: 'message', ts: TS(7), user: 'UKAR', text: 'Caja cuadrada' }],
    DKAR: [{ type: 'message', ts: TS(9), user: 'UIGN', text: '¿Vienes mañana?' }],
    DPEP: [{ type: 'message', ts: TS(11), user: 'UPEP', text: 'Hola' }],
  };
  const hilos = { [TS(1)]: [historia.CGEN[2], { type: 'message', ts: TS(2), thread_ts: TS(1), user: 'UKAR', text: 'Visto' }] };
  const pedidas = [];
  const fin = { response_metadata: { next_cursor: '' } };
  return {
    pedidas,
    pedir: async (metodo, p = {}) => {
      pedidas.push(metodo);
      switch (metodo) {
        case 'auth.test': return { ok: true, user_id: 'UIGN', user: 'ignacia', team: 'Telecab' };
        case 'users.list': return { ok: true, members: usuarios, ...fin };
        case 'conversations.list': return { ok: true, channels: canales, ...fin };
        case 'conversations.history': return { ok: true, messages: historia[p.channel] || [], ...fin };
        case 'conversations.replies': return { ok: true, messages: hilos[p.ts] || [], ...fin };
        case 'conversations.members': return { ok: true, members: p.channel === 'GEFE' ? ['UIGN', 'UKAR'] : ['UIGN', 'UKAR'], ...fin };
        default: throw new Error(`Slack de mentira: no sé ${metodo}`);
      }
    },
    descargar: async url => {
      assert.match(url, /^https:\/\/files\.slack\.com\//);
      return Readable.from([Buffer.from('%PDF-1.4 parte de prueba')]);
    },
  };
}

async function oficina({ fabrica }) {
  const ignacia = await fabrica.usuario({ nombre: 'Ignacia', apellidos: 'Slackera', email: `ignacia${Date.now()}@telecab.invalid` });
  const karen = await fabrica.usuario({ nombre: 'Karen', apellidos: 'Slackera' });
  for (const u of [ignacia, karen]) await chat.canales(u.id);   // entran en los públicos
  const s = slackDeMentira({ ignaciaEmail: ignacia.email });
  slack.usarSlack({ pedir: s.pedir, descargar: s.descargar, pausa: 0 });
  return { a: ignacia.id, k: karen.id, s };
}

test('el texto de Slack, al del chat', () => {
  const personas = new Map([['U1', { usuarioId: 9, nombre: 'Karen' }], ['U2', { usuarioId: null, nombre: 'Pepe Externo' }]]);
  const t = (x, extra) => slack.textoDeSlack(x, { personas, canales: new Map([['C1', '9-rrhh']]), ...extra });
  assert.equal(t('Hola <@U1> y <@U2>'), 'Hola <@9> y @Pepe Externo');
  assert.equal(t('<!here> <!channel> <!everyone|everyone>'), '<!canal> <!canal> <!canal>');
  assert.equal(t('Mira <#C1> y <#C2|nominas>'), 'Mira #9-rrhh y #nominas');
  assert.equal(t('<https://telecab.es|telecab.es> y <https://x.es/a|el parte>'), 'https://telecab.es y el parte (https://x.es/a)');
  assert.equal(t('<mailto:a@b.es|a@b.es> <tel:+34600|600>'), 'a@b.es 600');
  assert.equal(t('1 &lt; 2 &amp;&amp; 3 &gt; 2'), '1 < 2 && 3 > 2');
  assert.equal(t('Hecho :white_check_mark: :thumbsup::skin-tone-3: :inventado:'), 'Hecho ✅ 👍 :inventado:');
  assert.equal(t('*negrita* _cursiva_ ~tachado~ `código`'), '*negrita* _cursiva_ ~tachado~ `código`', 'el formato es el mismo');
  assert.equal(slack.reaccionDeSlack('+1::skin-tone-2'), 'ok');
  assert.equal(slack.reaccionDeSlack('heart_eyes'), 'corazon');
  assert.equal(slack.reaccionDeSlack('tada'), null, 'las que no son de las seis no se traen');
});

test('simular: dice qué traería y quién es quién, sin escribir ningún mensaje', () => conBase(async h => {
  const p = await oficina(h);
  const antes = Number((await h.consulta('SELECT count(*) FROM chat_mensaje')).rows[0].count);
  const inf = await slack.ejecutar('simular', p.a);
  assert.equal(Number((await h.consulta('SELECT count(*) FROM chat_mensaje')).rows[0].count), antes, 'ni un mensaje');
  assert.equal(Number((await h.consulta(`SELECT count(*) FROM chat_canal WHERE nombre = 'efectivo'`)).rows[0].count), 0, 'ni un canal');

  const quien = new Map((await h.consulta('SELECT slack_id, usuario_id, como FROM chat_slack_usuario')).rows.map(x => [x.slack_id, x]));
  assert.deepEqual([Number(quien.get('UIGN').usuario_id), quien.get('UIGN').como], [p.a, 'email'], 'por el correo, sin mirar mayúsculas');
  assert.deepEqual([Number(quien.get('UKAR').usuario_id), quien.get('UKAR').como], [p.k, 'nombre'], 'el correo no casa: por el nombre');
  assert.equal(quien.get('UPEP').usuario_id, null, 'Pepe no está en el ERP');
  assert.equal(quien.has('USLACKBOT'), false);

  const por = id => inf.canales.find(c => c.id === id);
  assert.deepEqual(
    (({ destino, mensajes, respuestas, ficheros, nuevos, reaccionesFuera }) => ({ destino, mensajes, respuestas, ficheros, nuevos, reaccionesFuera }))(por('CGEN')),
    { destino: '#1-general-telecab', mensajes: 3, respuestas: 1, ficheros: 1, nuevos: 4, reaccionesFuera: 1 },
    'sin «se ha unido»; el hilo, con su respuesta');
  assert.equal(por('CRAN').destino, 'no se trae');
  assert.equal(por('GEFE').destino, '#efectivo (nuevo, privado)');
  assert.deepEqual([por('DKAR').destino, por('DKAR').slack], ['directo nuevo', 'Directo con Karen Slackera']);
  assert.equal(por('DPEP').destino, 'no se trae');
  assert.match(por('DPEP').motivo, /Pepe Externo no tiene usuario del ERP/);
  assert.deepEqual(inf.totales, { mensajes: 5, respuestas: 1, ficheros: 1, nuevos: 6, ficherosSubidos: 0, reaccionesFuera: 1 });
}));

test('migrar: lo trae en su sitio, con su autor, hilos, reacciones y ficheros, sin avisar a nadie; y repetir no duplica', () => conBase(async h => {
  const p = await oficina(h);
  const general = Number((await h.consulta(`SELECT id FROM chat_canal WHERE nombre = '1-general-telecab'`)).rows[0].id);
  // Algo escrito en el chat antes de migrar: lo de Slack es de antes y sale encima.
  await chat.enviar(p.a, general, { texto: 'Ya estamos en el chat' });
  await slack.ejecutar('simular', p.a);
  const inf = await slack.ejecutar('migrar', p.a);
  assert.equal(inf.totales.nuevos, 6);
  assert.equal(inf.totales.ficherosSubidos, 1);
  assert.deepEqual(inf.avisos, []);

  const { mensajes } = await chat.mensajes(p.k, general);
  assert.deepEqual(mensajes.map(m => m.texto), [
    'Hola <!canal>, mirad https://telecab.es y avisad a <@' + p.k + '> 👍',
    'Soy de fuera & escribo',
    'Parte diario listo',
    'Ya estamos en el chat',
  ], 'por fecha, no por número');
  const [hola, pepe, bot, nativo] = mensajes;
  assert.deepEqual([hola.autorId, hola.importado, nativo.importado], [p.a, true, false]);
  assert.equal(new Date(hola.creadoAt).getTime(), 1788500001000, 'con la hora de Slack');
  assert.deepEqual([pepe.autorId, pepe.autor], [null, 'Pepe Externo'], 'sin usuario: con su nombre de Slack');
  assert.equal(bot.autor, 'Avisador');
  assert.deepEqual(hola.reacciones.map(r => [r.emoji, r.nombres]), [['ok', ['Karen Slackera']]], 'la de :tada: no se trae');
  assert.equal(hola.respuestas, 1);
  assert.deepEqual(hola.menciones, { usuarios: [p.k], todos: true });
  assert.deepEqual(pepe.adjuntos.map(a => [a.nombre, a.mime]), [['parte.pdf', 'application/pdf']]);
  const { respuestas } = await chat.hilo(p.k, hola.id);
  assert.deepEqual(respuestas.map(r => [r.texto, r.autorId]), [['Visto', p.k]]);
  const tema = (await h.consulta('SELECT tema, slack_id FROM chat_canal WHERE id = $1', [general])).rows[0];
  assert.deepEqual(tema, { tema: 'Lo de todos', slack_id: 'CGEN' });

  // #efectivo, privado y con su gente; el directo de Ignacia con Karen.
  const deKaren = (await chat.canales(p.k)).canales;
  const efectivo = deKaren.find(c => c.nombre === 'efectivo');
  assert.equal(efectivo && efectivo.tipo, 'privado');
  const directo = deKaren.find(c => c.tipo === 'directo');
  assert.ok(directo, 'el directo, también para Karen');
  assert.deepEqual((await chat.mensajes(p.k, directo.id)).mensajes.map(m => [m.texto, m.autorId]), [['¿Vienes mañana?', p.a]]);

  // Nada avisa: ni push, ni no leídos, ni menciones pendientes.
  assert.equal(avisos, 0, 'ninguna notificación');
  for (const c of deKaren) assert.deepEqual([c.nombre || c.tipo, c.sinLeer, c.menciones], [c.nombre || c.tipo, c.nombre === '1-general-telecab' ? 1 : 0, 0]);

  // Repetir: nada nuevo, nada duplicado (ni el fichero).
  const otra = await slack.ejecutar('migrar', p.a);
  assert.equal(otra.totales.nuevos, 0);
  assert.equal(otra.totales.ficherosSubidos, 0);
  assert.equal(Number((await h.consulta('SELECT count(*) FROM chat_mensaje WHERE slack_ts IS NOT NULL')).rows[0].count), 6);
  assert.equal(Number((await h.consulta(`SELECT count(*) FROM adjunto WHERE dueno_tipo = 'chat_mensaje' AND dueno_id = $1`, [String(pepe.id)])).rows[0].count), 1);
}));

test('quién es quién: lo puesto a mano no lo cambia otra simulación; un fichero que falla se reintenta al repetir', () => conBase(async h => {
  const p = await oficina(h);
  await slack.ejecutar('simular', p.a);
  const yo = await h.fabrica.usuario({ nombre: 'Pepe', apellidos: 'De Verdad' });
  const r = await slack.ponerPersona(p.a, { slackId: 'UPEP', usuarioId: yo.id });
  const pepe = r.personas.find(x => x.slackId === 'UPEP');
  assert.deepEqual([pepe.usuarioId, pepe.como, pepe.usuario], [yo.id, 'a mano', 'Pepe De Verdad']);
  await assert.rejects(slack.ponerPersona(p.a, { slackId: 'UNADIE', usuarioId: yo.id }), e => e.status === 404);
  await slack.ejecutar('simular', p.a);
  const otra = (await h.consulta(`SELECT usuario_id, como FROM chat_slack_usuario WHERE slack_id = 'UPEP'`)).rows[0];
  assert.deepEqual([Number(otra.usuario_id), otra.como], [yo.id, 'a mano'], 'la simulación no lo pisa');

  // El fichero falla la primera vez: el mensaje entra igual y el fichero llega al repetir.
  const bien = p.s.descargar;
  slack.usarSlack({ pedir: p.s.pedir, descargar: async () => { throw new Error('Slack no da el fichero (500)'); }, pausa: 0 });
  const inf = await slack.ejecutar('migrar', p.a);
  assert.equal(inf.totales.ficherosSubidos, 0);
  assert.match(inf.avisos.join(' '), /parte\.pdf.*500/);
  const m = (await h.consulta(`SELECT id, autor_id FROM chat_mensaje WHERE slack_ts = $1`, [TS(3)])).rows[0];
  assert.equal(Number(m.autor_id), yo.id, 'Pepe, ya con su usuario');
  slack.usarSlack({ pedir: p.s.pedir, descargar: bien, pausa: 0 });
  const otraVez = await slack.ejecutar('migrar', p.a);
  assert.deepEqual([otraVez.totales.nuevos, otraVez.totales.ficherosSubidos], [0, 1]);
}));

test('sin token no se lanza, y uno a la vez', () => {
  const antes = process.env.SLACK_MIGRACION_TOKEN;
  delete process.env.SLACK_MIGRACION_TOKEN;
  try {
    assert.throws(() => slack.lanzar('simular', 1), e => e.status === 503 && /SLACK_MIGRACION_TOKEN/.test(e.message));
    assert.throws(() => slack.lanzar('borrar', 1), e => e.status === 400);
  } finally {
    if (antes != null) process.env.SLACK_MIGRACION_TOKEN = antes;
  }
});
