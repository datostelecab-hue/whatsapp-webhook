// ============================================================
// LAS NOTIFICACIONES AL DISPOSITIVO (pieza A8, db/250)
// ============================================================
// Solo direcciones de los servicios de los navegadores (nada de llamar a la
// propia red), activar y confirmar con la sesión, solo a quien tiene la sesión
// abierta, la baja cuando el servicio dice que ya no existe, y el aviso de
// verdad cifrado: se descifra aquí con las claves del «navegador».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const webpush = require('web-push');
const ece = require('http_ece');
const push = require('../services/notificacionesPush');

const VAPID = webpush.generateVAPIDKeys();
const conClaves = async fn => {
  const antes = { p: process.env.VAPID_PUBLICA, s: process.env.VAPID_PRIVADA };
  process.env.VAPID_PUBLICA = VAPID.publicKey;
  process.env.VAPID_PRIVADA = VAPID.privateKey;
  try { return await fn(); } finally {
    if (antes.p === undefined) delete process.env.VAPID_PUBLICA; else process.env.VAPID_PUBLICA = antes.p;
    if (antes.s === undefined) delete process.env.VAPID_PRIVADA; else process.env.VAPID_PRIVADA = antes.s;
  }
};

/** Un «navegador»: sus claves (para descifrar) y su suscripción. */
function navegador(host = 'fcm.googleapis.com') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh, auth,
    suscripcion: {
      endpoint: `https://${host}/fcm/send/${crypto.randomBytes(12).toString('hex')}`,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    },
  };
}

/** Una sesión abierta (o cerrada) para un usuario. → sid */
async function sesion(consulta, usuarioId, { cerrada = false } = {}) {
  const sid = crypto.randomBytes(16).toString('hex');
  await consulta(
    `INSERT INTO usuario_sesion (sid, usuario_id, expira_at, cerrada_at, cerrada_motivo)
     VALUES ($1, $2, now() + interval '1 day', ${cerrada ? 'now()' : 'NULL'}, ${cerrada ? "'propia'" : 'NULL'})`, [sid, usuarioId]);
  return sid;
}

test('solo direcciones de los servicios de avisos de los navegadores: nada de llamar a la propia red', () => {
  for (const bien of [
    'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/QFh', 'https://api.push.apple.com/x', 'https://db5p.notify.windows.com/w/?token=x',
  ]) assert.equal(push.servicioValido(bien), true, bien);
  for (const mal of [
    'http://fcm.googleapis.com/fcm/send/abc',          // sin cifrar
    'https://fcm.googleapis.com:8443/x',               // otro puerto
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com.ataque.com/x',
    'https://169.254.169.254/latest/meta-data',       // la red de Render
    'https://localhost/x', 'https://127.0.0.1/x', 'https://erptelecab.es/push',
    'javascript:alert(1)', '', null,
  ]) assert.equal(push.servicioValido(mal), false, String(mal));
});

test('la suscripción se comprueba: claves de su tamaño y de un servicio conocido', () => {
  const n = navegador();
  assert.deepEqual(Object.keys(push.suscripcionDe(n.suscripcion)).sort(), ['auth', 'endpoint', 'p256dh']);
  assert.throws(() => push.suscripcionDe({ ...n.suscripcion, endpoint: 'https://127.0.0.1/x' }), e => e.status === 400);
  assert.throws(() => push.suscripcionDe({ ...n.suscripcion, keys: { p256dh: 'abc', auth: n.suscripcion.keys.auth } }), e => e.status === 400);
  assert.throws(() => push.suscripcionDe({ ...n.suscripcion, keys: { p256dh: n.suscripcion.keys.p256dh, auth: 'a"b' } }), e => e.status === 400);
  assert.throws(() => push.suscripcionDe(null), e => e.status === 400);
});

test('el aviso: con título, y que lleve a una página del ERP y no de fuera', () => {
  const a = push.avisoDe({ titulo: '  Nueva   tarea ', cuerpo: 'x'.repeat(300), url: '/tareas/42', etiqueta: 'tarea-42' });
  assert.deepEqual([a.titulo, a.cuerpo.length, a.url, a.etiqueta, a.urgente], ['Nueva tarea', 200, '/tareas/42', 'tarea-42', false]);
  assert.equal(push.avisoDe({ titulo: 'Hola' }).url, '/inicio');
  assert.throws(() => push.avisoDe({ cuerpo: 'sin título' }), /título/);
  for (const url of ['https://otro.com', '//otro.com/x', 'javascript:alert(1)', '/\\otro.com']) {
    assert.throws(() => push.avisoDe({ titulo: 'x', url }), /página del ERP/, url);
  }
  assert.throws(() => push.avisoDe({ titulo: 'x', etiqueta: 'con espacios' }), /etiqueta/);
});

test('activar pide sesión; la misma dirección en otra persona pasa a ella; confirmar no da de alta lo ajeno ni lo quitado', () => conBase(async ({ fabrica, consulta }) => {
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  const luis = await fabrica.usuario({ nombre: 'Luis' });
  const sidAna = await sesion(consulta, ana.id);
  const sidLuis = await sesion(consulta, luis.id);
  const n = navegador();

  await assert.rejects(push.activar({ id: ana.id }, n.suscripcion, 'Chrome en Windows'), e => e.status === 409, 'sin sid');
  const { id } = await push.activar({ id: ana.id, sid: sidAna }, n.suscripcion, 'Chrome‮ en <b>Windows</b>');
  const fila = (await consulta('SELECT usuario_id, sid, dispositivo FROM push_suscripcion WHERE id = $1', [id])).rows[0];
  assert.deepEqual([fila.usuario_id, fila.sid, fila.dispositivo], [ana.id, sidAna, 'Chrome en b Windows /b'], 'el nombre, sin caracteres raros');

  // Otra sesión de Ana: confirmar la apunta.
  const sid2 = await sesion(consulta, ana.id);
  assert.deepEqual(await push.confirmar({ id: ana.id, sid: sid2 }, n.suscripcion), { estado: 'ok', id });
  assert.equal((await consulta('SELECT sid FROM push_suscripcion WHERE id = $1', [id])).rows[0].sid, sid2);

  // Luis entra en ese navegador: confirmar no se la queda (no la activó él)…
  assert.deepEqual(await push.confirmar({ id: luis.id, sid: sidLuis }, n.suscripcion), { estado: 'no-esta' });
  // …pero si pulsa «Activar», pasa a él.
  await push.activar({ id: luis.id, sid: sidLuis }, n.suscripcion, 'Chrome en Windows');
  assert.equal((await consulta('SELECT usuario_id FROM push_suscripcion WHERE id = $1', [id])).rows[0].usuario_id, luis.id);
  assert.equal((await consulta('SELECT count(*)::int AS n FROM push_suscripcion')).rows[0].n, 1, 'una fila por navegador');

  // La quita: confirmar ya no la resucita; activar sí.
  assert.deepEqual(await push.quitar({ id: luis.id }, { id }), { quitadas: 1 });
  assert.deepEqual(await push.confirmar({ id: luis.id, sid: sidLuis }, n.suscripcion), { estado: 'no-esta' });
  assert.deepEqual(await push.quitar({ id: ana.id }, { id }), { quitadas: 0 }, 'la de otro no se quita');
  await push.activar({ id: luis.id, sid: sidLuis }, n.suscripcion, null);
  assert.equal((await consulta('SELECT baja_at FROM push_suscripcion WHERE id = $1', [id])).rows[0].baja_at, null);
}));

test('solo se avisa a los dispositivos con la sesión abierta; sin claves VAPID no se manda nada', () => conBase(async ({ fabrica, consulta }) => {
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  const abierta = navegador();
  const cerrada = navegador('updates.push.services.mozilla.com');
  await push.activar({ id: ana.id, sid: await sesion(consulta, ana.id) }, abierta.suscripcion, 'Chrome en Android');
  await push.activar({ id: ana.id, sid: await sesion(consulta, ana.id, { cerrada: true }) }, cerrada.suscripcion, 'Firefox en Windows');

  const mias = await push.mias({ id: ana.id });
  assert.deepEqual(mias.map(m => [m.dispositivo, m.sesionAbierta]).sort(), [['Chrome en Android', true], ['Firefox en Windows', false]]);

  const sinClaves = { p: process.env.VAPID_PUBLICA, s: process.env.VAPID_PRIVADA };
  delete process.env.VAPID_PUBLICA; delete process.env.VAPID_PRIVADA;
  try {
    assert.equal((await push.enviar([ana.id], { titulo: 'x' })).sinConfigurar, true);
  } finally {
    if (sinClaves.p !== undefined) process.env.VAPID_PUBLICA = sinClaves.p;
    if (sinClaves.s !== undefined) process.env.VAPID_PRIVADA = sinClaves.s;
  }

  const enviadas = [];
  const send = webpush.sendNotification;
  webpush.sendNotification = async (sub, cuerpo, op) => { enviadas.push({ sub, cuerpo, op }); return { statusCode: 201 }; };
  try {
    const r = await conClaves(() => push.enviar([ana.id, ana.id], { titulo: 'Nueva tarea', url: '/tareas/1', etiqueta: 'tarea-1', urgente: true }));
    assert.deepEqual(r, { dispositivos: 1, enviados: 1, fallidos: 0, bajas: 0 });
    assert.equal(enviadas[0].sub.endpoint, abierta.suscripcion.endpoint, 'solo la de la sesión abierta');
    assert.deepEqual([enviadas[0].op.urgency, enviadas[0].op.topic, enviadas[0].op.TTL], ['high', 'tarea-1', 3600]);
    assert.ok((await consulta('SELECT enviado_at FROM push_suscripcion WHERE endpoint = $1', [abierta.suscripcion.endpoint])).rows[0].enviado_at);
  } finally {
    webpush.sendNotification = send;
  }
}));

test('si el servicio dice que ya no existe (410) o la rechaza (403), baja; si falla cinco veces seguidas, también', () => conBase(async ({ fabrica, consulta }) => {
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  const sid = await sesion(consulta, ana.id);
  const ida = navegador(), rechazada = navegador(), tonta = navegador();
  for (const n of [ida, rechazada, tonta]) await push.activar({ id: ana.id, sid }, n.suscripcion, null);

  const send = webpush.sendNotification;
  webpush.sendNotification = async sub => {
    const e = new Error('fallo');
    e.statusCode = sub.endpoint === ida.suscripcion.endpoint ? 410 : sub.endpoint === rechazada.suscripcion.endpoint ? 403 : 500;
    throw e;
  };
  const errores = console.error;
  console.error = () => {};
  try {
    const r1 = await conClaves(() => push.enviar([ana.id], { titulo: 'x' }));
    assert.deepEqual(r1, { dispositivos: 3, enviados: 0, fallidos: 3, bajas: 2 });
    const motivos = (await consulta('SELECT endpoint, baja_motivo, fallos FROM push_suscripcion ORDER BY id')).rows;
    assert.deepEqual(motivos.map(m => m.baja_motivo), ['caducada', 'rechazada (otras claves VAPID)', null]);
    for (let i = 0; i < 4; i++) await conClaves(() => push.enviar([ana.id], { titulo: 'x' }));
    const ultima = (await consulta('SELECT baja_motivo, fallos FROM push_suscripcion WHERE endpoint = $1', [tonta.suscripcion.endpoint])).rows[0];
    assert.deepEqual([ultima.baja_motivo, ultima.fallos], ['falla siempre', 5]);
  } finally {
    webpush.sendNotification = send;
    console.error = errores;
  }
}));

test('el aviso de verdad va cifrado para ese navegador y firmado con VAPID: el navegador lo descifra', () => {
  const n = navegador();
  const cuerpo = JSON.stringify({ titulo: 'Prueba de Telecab', cuerpo: 'Hola', url: '/configuracion' });
  const peticion = webpush.generateRequestDetails(n.suscripcion, cuerpo, {
    vapidDetails: { subject: 'https://erptelecab.es', publicKey: VAPID.publicKey, privateKey: VAPID.privateKey },
    TTL: 3600, urgency: 'high', topic: 'prueba',
  });
  assert.equal(peticion.endpoint, n.suscripcion.endpoint);
  assert.equal(peticion.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(peticion.headers.Urgency, 'high');
  assert.equal(peticion.headers.Topic, 'prueba');
  assert.match(peticion.headers.Authorization, new RegExp(`^vapid t=.+, k=${VAPID.publicKey}$`));
  const claro = ece.decrypt(peticion.body, { version: 'aes128gcm', privateKey: n.ecdh, authSecret: n.auth.toString('base64url') });
  assert.deepEqual(JSON.parse(claro.toString('utf8')), JSON.parse(cuerpo));
});

test('por HTTP: activar sin claves en el servidor da 503, y la de prueba no se puede mandar dos veces seguidas', () => conBase(async ({ fabrica, consulta }) => {
  const express = require('express');
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  const sid = await sesion(consulta, ana.id);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.usuario = { id: ana.id, rol: 'oficina', sid }; next(); });
  app.use('/push', require('../modules/NotificacionesPush/notificacionesPush.controller'));
  const s = await new Promise(ok => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
  const base = `http://127.0.0.1:${s.address().port}/push`;
  const post = (ruta, cuerpo) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) });
  const antes = { p: process.env.VAPID_PUBLICA, s: process.env.VAPID_PRIVADA };
  delete process.env.VAPID_PUBLICA; delete process.env.VAPID_PRIVADA;
  try {
    const n = navegador();
    assert.equal((await post('/api/activar', { suscripcion: n.suscripcion })).status, 503);
    const send = webpush.sendNotification;
    webpush.sendNotification = async () => ({ statusCode: 201 });
    try {
      await conClaves(async () => {
        const est = await (await fetch(`${base}/api/estado`)).json();
        assert.equal(est.clave, VAPID.publicKey);
        assert.equal((await post('/api/activar', { suscripcion: n.suscripcion, dispositivo: 'Chrome en Windows' })).status, 200);
        assert.equal((await post('/api/activar', { suscripcion: { ...n.suscripcion, endpoint: 'https://127.0.0.1/x' } })).status, 400);
        const p1 = await (await post('/api/probar')).json();
        assert.deepEqual([p1.status, p1.enviados], ['ok', 1]);
        assert.equal((await post('/api/probar')).status, 429);
      });
    } finally {
      webpush.sendNotification = send;
    }
  } finally {
    if (antes.p !== undefined) process.env.VAPID_PUBLICA = antes.p;
    if (antes.s !== undefined) process.env.VAPID_PRIVADA = antes.s;
    await new Promise(ok => { s.closeAllConnections(); s.close(ok); });
  }
}));
