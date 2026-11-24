// ============================================================
// PORTAL — MIS HORAS: EL CRONÓMETRO DESDE QUE VINCULA EL COCHE (24/11/2026)
// ============================================================
// «El cronómetro de horas en la app, pero desglosada, de viaje, en espera y la
// utilización total, además de sus KM, tanto por BOLT como por fuera (…) que
// empiece cuando se vincule el coche, que diga "Horas con el coche" y "Horas
// trabajando". Que le diga su estado actual en BOLT».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const horas = require('../modules/Portal/portal.horas');
const repo = require('../modules/Portal/portal.repo');
const coche = require('../modules/Portal/portal.coche');
const ahora = require('../services/flotaViva/ahora');

const H = 3600 * 1000;
const T0 = Date.parse('2026-11-24T06:00:00Z');   // vinculó a las 07:00 de Madrid

test('la cuenta: viaje y espera suyos (el descanso aparte), la utilización, y los km del coche con y sin BOLT', () => {
  const r = horas.resumir([
    // Antes de vincular: solo cuenta la media hora que cae dentro.
    { situacion: 'espera', efectivo: true, suyo: true, delCoche: true, desdeMs: T0 - 0.5 * H, hastaMs: T0 + 0.5 * H, odoIni: 0, odoFin: 10000 },
    { situacion: 'viaje', efectivo: true, suyo: true, delCoche: true, desdeMs: T0 + 0.5 * H, hastaMs: T0 + 2 * H, odoIni: 10000, odoFin: 40000 },
    { situacion: 'descanso', efectivo: false, suyo: true, delCoche: true, desdeMs: T0 + 2 * H, hastaMs: T0 + 2.5 * H, odoIni: 40000, odoFin: 43000 },
    // Desconectado con el coche: km fuera de BOLT, y no es tiempo trabajado.
    { situacion: 'desconectado', efectivo: false, suyo: false, delCoche: true, desdeMs: T0 + 2.5 * H, hastaMs: T0 + 3 * H, odoIni: 43000, odoFin: 45000 },
    // Con otro coche en BOLT: horas suyas, pero esos km no son de su coche.
    { situacion: 'viaje', efectivo: true, suyo: true, delCoche: false, desdeMs: T0 + 3 * H, hastaMs: T0 + 3.5 * H, odoIni: 0, odoFin: 99000 },
  ], T0, T0 + 4 * H);
  assert.equal(r.espera, 0.5 * 3600);
  assert.equal(r.viaje, 2 * 3600);
  assert.equal(r.descanso, 0.5 * 3600);
  assert.equal(r.trabajando, 2.5 * 3600);
  assert.equal(r.utilizacion, 80);
  assert.equal(r.kmBolt, 35, '5 de la espera (la mitad del tramo) + 30 del viaje');
  assert.equal(r.kmFuera, 5, '3 en descanso + 2 desconectado');
});

test('la consulta de tramos: los suyos y los de su coche, recortados a la ventana', () => conBase(async ({ consulta }) => {
  await consulta(`INSERT INTO fv_vehiculo (uuid, matricula) VALUES ('veh-prueba', '1234 PRB'), ('veh-otro', '9999ZZZ')`);
  await consulta(`INSERT INTO fv_conductor (uuid, nombre) VALUES ('cuenta-suya', 'Suya'), ('cuenta-otra', 'Otra')`);
  const iso = ms => new Date(ms).toISOString();
  await consulta(`INSERT INTO fv_tramo (vehiculo_uuid, conductor_uuid, situacion, desde, hasta, odometro_ini_m, odometro_fin_m) VALUES
    ('veh-prueba', 'cuenta-suya', 'viaje', $1, $2, 1000, 21000),
    ('veh-prueba', 'cuenta-otra', 'descanso', $2, $3, 21000, 23000),
    ('veh-otro', 'cuenta-suya', 'espera', $3, $4, 0, 500),
    ('veh-otro', 'cuenta-otra', 'viaje', $3, $4, 0, 500)`,
  [iso(T0 + 0.5 * H), iso(T0 + 1.5 * H), iso(T0 + 2 * H), iso(T0 + 2.5 * H)]);
  const t = await repo.tramosDelCronometro({ uuids: ['cuenta-suya'], matricula: '1234PRB', desdeMs: T0, hastaMs: T0 + 3 * H });
  assert.equal(t.length, 3, 'no entra el viaje de otra cuenta en otro coche');
  const r = horas.resumir(t, T0, T0 + 3 * H);
  assert.deepEqual([r.viaje, r.espera, r.kmBolt, r.kmFuera], [3600, 1800, 20, 2]);
}));

test('el cronómetro: sin coche, solo el estado de BOLT; con coche, desde que lo vinculó', async () => {
  const reales = { estado: coche.estado, cuentas: repo.cuentasBolt, tramos: repo.tramosDelCronometro, foto: ahora.foto };
  try {
    repo.cuentasBolt = async () => ['cuenta-suya'];
    ahora.foto = async () => ({ porConductor: new Map([['cuenta-suya', { situacion: 'espera', etiqueta: 'En espera', conectado: true, desde: new Date(T0 + 3.9 * H) }]]) });
    coche.estado = async () => ({ puede: true, vinculado: false });
    const sin = await horas.cronometro({ id: '1', telefono: '612345678' }, { ahoraMs: T0 + 4 * H });
    assert.deepEqual([sin.vinculado, sin.bolt.situacion, sin.bolt.etiqueta], [false, 'espera', 'En espera']);

    coche.estado = async () => ({ puede: true, vinculado: true, matricula: '1234PRB', inicioSeg: T0 / 1000, desde: 'desde las 07:00' });
    repo.tramosDelCronometro = async () => [
      { situacion: 'viaje', efectivo: true, suyo: true, delCoche: true, desdeMs: T0, hastaMs: T0 + H, odoIni: 0, odoFin: 30000 }];
    const con = await horas.cronometro({ id: '1', telefono: '612345678' }, { ahoraMs: T0 + 4 * H });
    assert.equal(con.vinculado, true);
    assert.equal(con.conCoche, 4 * 3600, 'horas con el coche: desde que lo vinculó');
    assert.deepEqual([con.trabajando, con.utilizacion, con.kmBolt], [3600, 100, 30]);
  } finally {
    coche.estado = reales.estado; repo.cuentasBolt = reales.cuentas; repo.tramosDelCronometro = reales.tramos; ahora.foto = reales.foto;
  }
});
