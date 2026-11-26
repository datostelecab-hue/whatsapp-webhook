// ============================================================
// LOS DATOS DE SALUD Y DE NÓMINA EN LA TICKETERA (db/301, 26/11/2026)
// ============================================================
// Sin la llave de salud no se ven los casos de baja médica; sin la de nómina,
// los de nómina y los cambios de cuenta. Ni en la lista, ni en la ficha, ni en
// los números de la barra; y no se puede actuar sobre ellos.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const controller = require('../modules/Ticketera/ticketera.controller');
const repo = require('../modules/Ticketera/ticketera.repo');

test('qué esconde cada llave', () => {
  const o = controller._ocultosDe;
  assert.deepEqual([...o(null)], [], 'quien lo ve todo');
  assert.deepEqual([...o(['/ticketera'])].sort(), ['BAJA_AUSENCIA', 'CAMBIO_CUENTA', 'INCIDENCIA_NOMINA']);
  assert.deepEqual([...o(['/ticketera', '/ticketera/salud'])].sort(), ['CAMBIO_CUENTA', 'INCIDENCIA_NOMINA']);
  assert.deepEqual([...o(['/ticketera', '/ticketera/salud', '/ticketera/nomina'])], []);
});

test('la bandeja, la ficha, las acciones y la barra, según las llaves', () => conBase(async () => {
  const baja = await repo.alta({ area: 'RRHH', subtipo: 'BAJA_AUSENCIA', nombre: 'Prueba baja', descripcion: 'Parte de baja' });
  const nomina = await repo.alta({ area: 'RRHH', subtipo: 'CAMBIO_CUENTA', nombre: 'Prueba IBAN', descripcion: 'Nuevo IBAN' });
  const vac = await repo.alta({ area: 'RRHH', subtipo: 'VACACIONES', nombre: 'Prueba vacaciones' });

  let permisos = ['/ticketera'];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.usuario = { id: 7, nombre: 'Prueba', rol: 'oficina' }; res.locals.permisos = permisos; next(); });
  app.use('/bandejas', controller.resumen());
  app.use('/ticketera', controller.para('RRHH', { titulo: 'Ticketera RRHH', recientes: false }));
  const srv = app.listen(0);
  const url = `http://127.0.0.1:${srv.address().port}`;
  const get = async p => (await fetch(url + p)).json();
  const post = async (p, b) => { const r = await fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    // Sin llaves: solo las vacaciones.
    let ids = (await get('/ticketera/api/datos')).tickets.map(t => String(t.id));
    assert.ok(ids.includes(String(vac.id)));
    assert.ok(!ids.includes(String(baja.id)) && !ids.includes(String(nomina.id)), 'ni la baja ni el IBAN');
    assert.equal((await get(`/ticketera/api/ticket/${baja.id}`)).status, 'error');
    const o = await post('/ticketera/observaciones', { id: baja.id, texto: 'hola' });
    assert.equal(o.status, 403, 'tampoco se actúa sobre él');
    let barra = (await get('/bandejas/api/pendientes')).bandejas.find(b => b.area === 'RRHH');
    assert.deepEqual(barra.partes.map(p => p.clave).sort(), ['otros', 'permisos', 'vacaciones'], 'sin los cuadros de baja y nómina');

    // Con la de salud: la baja sí, el IBAN no.
    permisos = ['/ticketera', '/ticketera/salud'];
    ids = (await get('/ticketera/api/datos')).tickets.map(t => String(t.id));
    assert.ok(ids.includes(String(baja.id)) && !ids.includes(String(nomina.id)));
    assert.equal((await get(`/ticketera/api/ticket/${baja.id}`)).status, 'ok');
    barra = (await get('/bandejas/api/pendientes')).bandejas.find(b => b.area === 'RRHH');
    assert.ok(barra.partes.some(p => p.clave === 'baja') && !barra.partes.some(p => p.clave === 'nomina'));

    // Quien lo ve todo (permisos null), todo.
    permisos = null;
    ids = (await get('/ticketera/api/datos')).tickets.map(t => String(t.id));
    assert.ok([baja.id, nomina.id, vac.id].every(i => ids.includes(String(i))));
  } finally { srv.close(); }
}));
