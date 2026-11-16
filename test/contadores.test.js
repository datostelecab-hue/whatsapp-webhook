// ============================================================
// LOS CONTADORES (pieza A9 de la hoja de ruta)
// ============================================================
// Todas las fuentes en una petición: lo que devuelve cada una, limpio; una que
// falla o tarda no tapa a las demás; lo contado se recuerda unos segundos y un
// cambio lo olvida y avisa por el tiempo real. Y las tres fuentes de verdad:
// la campana, los cuadros de tickets (con sus partes y «Otros») y las
// correcciones de fichaje, cada una solo para quien puede verla.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const contadores = require('../services/contadores');
const tiempoReal = require('../services/tiempoReal');
// Las fuentes de verdad se registran al cargarse cada módulo, como en app.js.
require('../routes/notificaciones');
require('../modules/Ticketera/ticketera.controller');
require('../modules/Fichaje/fichaje.service');
const ticketera = require('../modules/Ticketera/ticketera.service');

test('las tres fuentes de hoy están registradas', () => {
  for (const f of ['pendientes', 'tickets', 'fichaje']) assert.ok(contadores.fuentes().includes(f), f);
  assert.throws(() => contadores.registrarFuente('Mal Nombre', { contar: () => ({}) }), /no válido/);
  assert.throws(() => contadores.registrarFuente('sin_contar', {}), /cómo cuenta/);
});

test('lo que da una fuente se limpia: claves raras, negativos y tonos que no existen fuera', () => {
  const r = contadores.normalizar('x', {
    'bien': 3, 'con.punto-y_guion': { n: 2.7, tono: 'info', titulo: 't'.repeat(300) },
    'mal clave': 1, 'negativo': -1, 'texto': 'abc', 'tono.raro': { n: 1, tono: 'rojo' },
  });
  assert.deepEqual(Object.keys(r).sort(), ['bien', 'con.punto-y_guion', 'tono.raro']);
  assert.deepEqual(r['con.punto-y_guion'], { n: 2, tono: 'info', titulo: 't'.repeat(200) });
  assert.deepEqual(r['tono.raro'], { n: 1 });
});

test('una fuente que falla o tarda no tapa a las demás; lo contado se recuerda y un cambio lo olvida', async () => {
  const antes = { ...contadores.AJUSTES };
  contadores.AJUSTES.esperaMs = 50;
  let veces = 0;
  contadores.registrarFuente('test_bien', { contar: async () => { veces++; return { 'test.bien': veces }; } });
  contadores.registrarFuente('test_falla', { contar: async () => { throw new Error('se rompe'); } });
  contadores.registrarFuente('test_lenta', { contar: () => new Promise(ok => setTimeout(() => ok({ 'test.lenta': 1 }), 200)) });
  const errores = console.error;
  console.error = () => {};
  try {
    contadores.olvidar();
    const quien = { id: 900001, rol: 'conductor', permisos: [] };
    const r = await contadores.recuentos(quien);
    assert.deepEqual(r['test.bien'], { n: 1 });
    assert.equal('test.lenta' in r, false, 'la lenta no retiene: se queda fuera');
    assert.deepEqual((await contadores.recuentos(quien))['test.bien'], { n: 1 }, 'recordado: no se vuelve a contar');
    contadores.cambio('test_bien', { para: [quien.id] });
    assert.deepEqual((await contadores.recuentos(quien))['test.bien'], { n: 2 }, 'tras un cambio, se cuenta otra vez');
    assert.deepEqual(await contadores.recuentos({ id: null }), {}, 'sin persona, nada');
  } finally {
    console.error = errores;
    Object.assign(contadores.AJUSTES, antes);
    ['test_bien', 'test_falla', 'test_lenta'].forEach(contadores.quitarFuente);
    contadores.olvidar();
  }
});

test('un cambio avisa por el tiempo real, a todos o solo a quien toca', () => {
  const salida = { 1: '', 2: '' };
  const conexiones = [1, 2].map(id => tiempoReal.conectar({
    quien: { id }, canales: ['contadores'], escribir: t => { salida[id] += t; }, pendiente: () => 0, cerrar: () => {},
  }));
  try {
    contadores.cambio('tickets');
    assert.match(salida[1], /"c":"contadores","d":\{"fuentes":\["tickets"\]\}/);
    assert.match(salida[2], /"fuentes":\["tickets"\]/);
    contadores.cambio(['fichaje'], { para: [2] });
    assert.doesNotMatch(salida[1], /fichaje/);
    assert.match(salida[2], /"fuentes":\["fichaje"\]/);
  } finally {
    conexiones.forEach(c => c.terminar('fin'));
  }
});

test('los cuadros de tickets: solo las bandejas que puede abrir, con sus partes y «Otros»', async () => {
  const pendientes = ticketera.pendientes;
  ticketera.pendientes = async areas => ({
    desde: '24/09/2026',
    pendientes: Object.fromEntries(areas.map(a => [a, a === 'RRHH' ? 7 : 1])),
    porSubtipo: { RRHH: { INCIDENCIA_NOMINA: 2, CAMBIO_CUENTA: 1, VACACIONES: 3 } },
  });
  try {
    contadores.olvidar();
    const todo = await contadores.recuentos({ id: 900002, rol: 'superadmin', permisos: null });
    assert.deepEqual(todo['tickets.RRHH'], { n: 7, titulo: 'RRHH: 7 tickets pendientes desde el 24/09/2026' });
    assert.equal(todo['tickets.RRHH.nomina'].n, 3);
    assert.equal(todo['tickets.RRHH.vacaciones'].n, 3);
    assert.equal(todo['tickets.RRHH.baja'].n, 0);
    assert.equal(todo['tickets.RRHH.otros'].n, 1, 'lo que no cae en ninguna parte');
    for (const a of ['ADMIN', 'TRAFICO', 'TALLER', 'OPERACIONES']) assert.equal(todo[`tickets.${a}`].n, 1, a);

    contadores.olvidar();
    const nada = await contadores.recuentos({ id: 900003, rol: 'oficina', permisos: [] });
    assert.equal(Object.keys(nada).some(k => k.startsWith('tickets.')), false, 'sin llaves, ni un número de tickets');
  } finally {
    ticketera.pendientes = pendientes;
    contadores.olvidar();
  }
});

test('la campana y las correcciones: cada una solo para quien le toca', () => conBase(async ({ fabrica }) => {
  const oficina = await fabrica.usuario({ rol: 'oficina' });
  contadores.olvidar();
  const suyo = await contadores.recuentos({ id: oficina.id, rol: 'oficina', permisos: [] });
  assert.ok(suyo.pendientes && Number.isInteger(suyo.pendientes.n), 'la oficina tiene su campana');
  assert.equal('fichaje.correcciones' in suyo, false, 'sin la llave de aprobar fichajes, no hay número');

  contadores.olvidar();
  const conductor = await contadores.recuentos({ id: oficina.id + 0, rol: 'sin-departamento', permisos: [] });
  assert.equal('pendientes' in conductor, false, 'un rol sin bandejas en la campana no tiene número');
  contadores.olvidar();
}));

test('por HTTP: todos los números de quien mira, en una petición y sin caché del navegador', async () => {
  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.usuario = { id: 900004, rol: 'sin-departamento' }; res.locals.permisos = []; next(); });
  app.use('/contadores', require('../modules/Contadores/contadores.controller'));
  contadores.registrarFuente('test_http', { contar: async q => ({ 'test.http': { n: q.id === 900004 ? 5 : 0, tono: 'info' } }) });
  const s = await new Promise(ok => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
  try {
    contadores.olvidar();
    const r = await fetch(`http://127.0.0.1:${s.address().port}/contadores/api`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.deepEqual(j.contadores['test.http'], { n: 5, tono: 'info' });
  } finally {
    contadores.quitarFuente('test_http');
    await new Promise(ok => { s.closeAllConnections(); s.close(ok); });
  }
});
