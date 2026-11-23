// ============================================================
// BARCELONA — SOLO SE VINCULA EL COCHE PLANIFICADO DE ESE DÍA (23/11/2026)
// ============================================================
// «Los conductores en Barcelona solo puedan fichar en el coche que tiene
// planificado para ese día, entonces el BOT le dejará vincular el vehículo,
// pero si no, entonces le dirá que ese no es el coche que tiene asignado para
// ese día». Aquí: qué coches da el planificador a cada cuenta (con el de noche
// de ayer hasta las 12:00) y el mensaje del bot y del portal.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../modules/Barcelona/barcelona.repo');
const bcn = require('../modules/Barcelona/barcelona.service');
const { textoNoEsSuCoche } = require('../services/fichajeBot');
const fichaje = require('../services/fichaje');
const coche = require('../modules/Portal/portal.coche');

const fijo = (uuid, matricula, turno) => ({ id: uuid + turno, uuid, matricula, turno, rol: 'fijo', dias: null, desde: '2026-11-01', hasta: null });
let real;
before(() => {
  real = repo.planEntre;
  repo.planEntre = async () => ({
    asignaciones: [fijo('U-DIA', '1111BCN', 'dia'), fijo('U-NOCHE', '2222BCN', 'noche')],
    casillas: [], descansos: [], cochesCuadrante: [], cts: [],
  });
});
after(() => { repo.planEntre = real; });

// 23/11/2026 a las 08:00 y a las 14:00 en Madrid (UTC+1 en noviembre).
const OCHO = new Date('2026-11-23T07:00:00Z');
const DOS = new Date('2026-11-23T13:00:00Z');

test('el de día: su coche de hoy', async () => {
  assert.deepEqual((await bcn.cochesPlanificados('U-DIA', OCHO)).map(c => [c.matricula, c.turno]), [['1111BCN', 'dia']]);
});

test('el de noche: hasta las 12 vale su turno de ayer; el mismo coche sale una vez', async () => {
  const manana = await bcn.cochesPlanificados('U-NOCHE', OCHO);
  assert.deepEqual(manana.map(c => [c.matricula, c.turno, c.dia]), [['2222BCN', 'noche', '2026-11-22']]);
  const tarde = await bcn.cochesPlanificados('U-NOCHE', DOS);
  assert.deepEqual(tarde.map(c => [c.matricula, c.turno, c.dia]), [['2222BCN', 'noche', '2026-11-23']]);
});

test('quien no está en el planificador: ninguno', async () => {
  assert.deepEqual(await bcn.cochesPlanificados('OTRA', OCHO), []);
  assert.deepEqual(await bcn.cochesPlanificados('', OCHO), []);
});

test('el mensaje del bot dice cuál es su coche de hoy', () => {
  const t = textoNoEsSuCoche({ matricula: '9999BCN', asignados: [{ matricula: '1111BCN', turno: 'dia' }] }, '*');
  assert.equal(t, '❌ El *9999BCN* no es el coche que tienes asignado para hoy. Tu coche de hoy es el *1111BCN* (turno de día). ' +
    'Si tienes que llevar otro, comunícate con Tráfico.');
  assert.match(textoNoEsSuCoche({ matricula: '9999BCN', asignados: [] }), /Hoy no tienes ningún coche asignado en el planificador\./);
});

test('en el portal, el mismo «no»', async () => {
  const reales = { participa: fichaje.participa, iniciar: fichaje.iniciar };
  try {
    fichaje.participa = async () => ({ tipo: 'turno', sede: 'barcelona' });
    fichaje.iniciar = async () => ({ ok: false, motivo: 'no-es-su-coche', matricula: '9999BCN', asignados: [{ matricula: '2222BCN', turno: 'noche' }] });
    const r = await coche.vincular({ id: '1', telefono: '612345678' }, '9999BCN');
    assert.equal(r.titulo, 'El 9999BCN no es tu coche de hoy');
    assert.match(r.texto[0], /^El 9999BCN no es el coche que tienes asignado para hoy\. Tu coche de hoy es el 2222BCN \(turno de noche\)/);
  } finally { Object.assign(fichaje, reales); }
});
