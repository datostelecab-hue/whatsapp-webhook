// ============================================================
// PUERTAS POR MAPON DIRECTO, SIN APPS SCRIPT (23/11/2026)
// ============================================================
// «Pásalo a Mapon directo, no usemos más AppScript». Con
// PUERTAS_MAPON_DIRECTO=1 la orden va del servidor a Mapon, con el comando del
// catálogo de esa unidad; sin el interruptor, como antes. Mapon es de mentira.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const mapon = require('../services/mapon');
const fichaje = require('../services/fichaje');
const otraSede = require('../services/otraSede');
const registro = require('../services/repo/puertas');
const puertas = require('../services/puertasBot');

const reales = {};
let ordenes, appsScript;
beforeEach(() => {
  ordenes = []; appsScript = 0;
  reales.unidad = mapon.unidadPorMatricula; reales.seguro = mapon.ejecutarComandoSeguro;
  reales.disponible = fichaje.maponDisponible; reales.sede = otraSede.sedeDe; reales.registrar = registro.registrar;
  reales.fetch = global.fetch;
  mapon.unidadPorMatricula = async m => (m === '1234ABC' ? { unitId: 893954 } : null);
  mapon.ejecutarComandoSeguro = async o => { ordenes.push(o); return o.command === 'open_trunk' ? { ok: false, motivo: 'comando-no-disponible', disponibles: ['open_doors'] } : { ok: true }; };
  fichaje.maponDisponible = () => true;
  otraSede.sedeDe = async () => 'madrid';
  registro.registrar = () => {};
  global.fetch = async () => { appsScript++; return { status: 200, text: async () => '{"status":"ok"}' }; };
});
afterEach(() => {
  mapon.unidadPorMatricula = reales.unidad; mapon.ejecutarComandoSeguro = reales.seguro;
  fichaje.maponDisponible = reales.disponible; otraSede.sedeDe = reales.sede; registro.registrar = reales.registrar;
  global.fetch = reales.fetch;
  delete process.env.PUERTAS_MAPON_DIRECTO;
});

test('con el interruptor: a Mapon directo, con la unidad del coche y el comando de su catálogo; sin Apps Script', async () => {
  process.env.PUERTAS_MAPON_DIRECTO = '1';
  const r = await puertas.ejecutar({ telefono: '612345678', matricula: '1234ABC', abrir: true });
  assert.equal(r.ok, true);
  assert.deepEqual(ordenes, [{ unitId: 893954, command: 'open_doors' }]);
  assert.equal(appsScript, 0, 'Google no se toca');
  await puertas.ejecutar({ telefono: '612345678', matricula: '1234ABC', unitId: '777', abrir: false });
  assert.deepEqual(ordenes[1], { unitId: '777', command: 'close_doors' }, 'con la unidad ya sabida, esa');
  const sin = await puertas.ejecutar({ telefono: '612345678', matricula: '0000ZZZ', abrir: true });
  assert.deepEqual([sin.ok, sin.msg], [false, 'No encuentro el 0000ZZZ en Mapon']);
});

test('sin el interruptor, como hasta ahora (Apps Script)', async () => {
  const r = await puertas.ejecutar({ telefono: '612345678', matricula: '1234ABC', abrir: true });
  assert.equal(r.ok, true);
  assert.equal(appsScript, 1);
  assert.equal(ordenes.length, 0);
});
