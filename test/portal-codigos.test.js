// ============================================================
// PORTAL — LOS CÓDIGOS, A UN SOLO BUZÓN MIENTRAS SE PRUEBA (20/11/2026)
// ============================================================
// «Quema mi correo para que todos los códigos de inicio de sesión me lleguen a
// mí en datostelecab@gmail.com para probar en producción» y «con copia a
// Ignacio por cada correo». Sin PORTAL_CODIGOS_A, todo código va al buzón de
// pruebas, con copia al usuario 1, y el asunto dice de qué ficha es; también el
// de quien no tiene email en su ficha.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../services/db');
const correo = require('../services/correo');
const repo = require('../modules/Portal/portal.repo');

const guardado = {};
let enviados = [];
let svc;

before(() => {
  delete process.env.PORTAL_CODIGOS_A;
  delete require.cache[require.resolve('../modules/Portal/portal.service')];
  svc = require('../modules/Portal/portal.service');
  for (const k of ['porDni', 'codigosRecientes', 'nuevoCodigo', 'marcarEnviado']) guardado[k] = repo[k];
  guardado.consulta = db.consulta;
  guardado.enviar = correo.enviarCorreo;
  repo.porDni = async dni => (dni === '12345678Z'
    ? { id: '7', nombre: 'JUAN CARLOS', nombre_completo: 'JUAN CARLOS PÉREZ', email: 'juan@ejemplo.com' }
    : dni === 'X1234567L' ? { id: '8', nombre: 'Ana', nombre_completo: 'Ana Ruiz', email: null } : null);
  repo.codigosRecientes = async () => ({ persona: 0, ip: 0 });
  repo.nuevoCodigo = async () => 1;
  repo.marcarEnviado = async () => {};
  db.consulta = async (sql, vals) => (/FROM usuario WHERE id/.test(sql) && vals[0] === 1
    ? { rows: [{ email: 'ignacio@ejemplo.com' }] } : { rows: [] });
  correo.enviarCorreo = async m => { enviados.push(m); return { enviado: true }; };
});
after(() => {
  Object.assign(repo, { porDni: guardado.porDni, codigosRecientes: guardado.codigosRecientes, nuevoCodigo: guardado.nuevoCodigo, marcarEnviado: guardado.marcarEnviado });
  db.consulta = guardado.consulta;
  correo.enviarCorreo = guardado.enviar;
  delete require.cache[require.resolve('../modules/Portal/portal.service')];
});

test('todo código va a datostelecab@gmail.com, con copia a Ignacio, y el asunto dice de qué ficha es', async () => {
  enviados = [];
  const r = await svc.pedirCodigo({ dni: '12345678Z', ip: '1.1.1.1' });
  assert.deepEqual([r.ok, r.email], [true, 'da•••@gmail.com'], 'en la pantalla, el buzón al que ha ido de verdad');
  assert.equal(enviados[0].to, 'datostelecab@gmail.com');
  assert.equal(enviados[0].cc, 'ignacio@ejemplo.com');
  assert.match(enviados[0].subject, /^\[Portal en pruebas\] Código de Juan Carlos Pérez \(ficha 7\): \d{6}$/);
  // Quien no tiene email en su ficha también: el código va al buzón de pruebas.
  const ana = await svc.pedirCodigo({ dni: 'X1234567L', ip: '1.1.1.1' });
  assert.equal(ana.ok, true);
  assert.equal(enviados[1].to, 'datostelecab@gmail.com');
  // Con PORTAL_CODIGOS_CC puesta en Render, esa dirección manda.
  process.env.PORTAL_CODIGOS_CC = 'copia@ejemplo.com';
  await svc.pedirCodigo({ dni: '12345678Z', ip: '1.1.1.1' });
  assert.equal(enviados[2].cc, 'copia@ejemplo.com');
  delete process.env.PORTAL_CODIGOS_CC;
  // Un DNI que no es de nadie, igual que siempre.
  assert.deepEqual(await svc.pedirCodigo({ dni: '99999999R', ip: '1.1.1.1' }), { ok: false, motivo: 'no-podemos' });
});
