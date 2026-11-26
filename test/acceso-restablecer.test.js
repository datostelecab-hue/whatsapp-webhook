// ============================================================
// RECUPERAR EL ACCESO CON UN ENLACE DE UN SOLO USO (26/11/2026)
// ============================================================
// «Olvidé mi contraseña» manda un enlace que caduca en una hora; hasta que se
// abre, la contraseña no cambia. Abierto, se entra y se pide la nueva; el mismo
// enlace no vale dos veces.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// El correo, de mentira, ANTES de cargar el controlador (lo coge al cargarse).
const correo = require('../services/correo');
const enviados = [];
correo.enviarCorreo = async m => { enviados.push(m); return { enviado: true }; };
const auth = require('../modules/Usuarios/auth.controller');
const usuarios = require('../modules/Usuarios/usuarios.service');

test('el enlace: nada cambia hasta abrirlo; abierto, se entra a poner la nueva; y no vale dos veces', () => conBase(async ({ fabrica }) => {
  const u = await fabrica.usuario({ nombre: 'Olvida', email: 'olvida@telecab.invalid' });
  await usuarios.fijarPassword('olvida@telecab.invalid', 'la-de-siempre-1', { origen: 'acceso' });
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.set('views', [require('path').join(__dirname, '..', 'views'), require('path').join(__dirname, '..', 'modules', 'Usuarios', 'vistas')]);
  app.set('view engine', 'ejs');
  app.use((req, res, next) => { res.render = (vista, datos) => res.json({ vista, ...datos }); next(); });
  app.use(auth);
  const srv = app.listen(0);
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r1 = await fetch(url + '/olvide-password', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=olvida%40telecab.invalid' });
    assert.match((await r1.json()).mensaje, /enlace/);
    assert.equal(enviados.length, 1);
    const enlace = enviados[0].text.match(/https?:\/\/\S+\/restablecer\?t=\S+/)[0];
    assert.ok(!/la-de-siempre/.test(enviados[0].text), 'el correo no lleva ninguna contraseña');
    // Hasta abrirlo, la de siempre sigue valiendo.
    assert.ok(usuarios.verificarHash('la-de-siempre-1', (await usuarios.buscarUsuario('olvida@telecab.invalid')).hash));

    const t = new URL(enlace).searchParams.get('t');
    const r2 = await fetch(`${url}/restablecer?t=${encodeURIComponent(t)}`, { redirect: 'manual' });
    assert.equal(r2.status, 302);
    assert.equal(r2.headers.get('location'), '/cambiar-password');
    assert.ok(r2.headers.get('set-cookie'), 'entra con sesión');
    const despues = await usuarios.buscarUsuario('olvida@telecab.invalid');
    assert.equal(despues.debe_cambiar, 'si');
    assert.ok(!usuarios.verificarHash('la-de-siempre-1', despues.hash), 'la vieja ya no vale');

    const r3 = await fetch(`${url}/restablecer?t=${encodeURIComponent(t)}`, { redirect: 'manual' });
    assert.equal(r3.status, 400, 'el mismo enlace no vale dos veces');
    const r4 = await fetch(`${url}/restablecer?t=inventado.xxx`, { redirect: 'manual' });
    assert.equal(r4.status, 400);
    // Un correo que no existe: la misma respuesta y ningún correo.
    await fetch(url + '/olvide-password', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=nadie%40telecab.invalid' });
    assert.equal(enviados.length, 1);
    void u;
  } finally { srv.close(); }
}));
