// ============================================================
// PARA DECIDIR UNAS VACACIONES (módulo 2 del plan de RR. HH., 25/11/2026)
// ============================================================
// «Cada solicitud le llega con: calificación del conductor, días disponibles,
// conductores ya fuera esas fechas y cobertura de planificación».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const vacaciones = require('../modules/Vacaciones/vacaciones.service');

test('los cuatro datos: letra, saldo, quién está fuera y la cobertura de su coche', () => conBase(async ({ consulta, fabrica }) => {
  const yo = await fabrica.conductor({ nombre: 'PIDE' });
  const otro = await fabrica.conductor({ nombre: 'FUERA' });
  const v = await fabrica.vehiculo();
  const p = (await consulta('INSERT INTO plaza (vehiculo_id, slot) VALUES ($1, 0) RETURNING id', [v.id])).rows[0];
  await consulta(`INSERT INTO asignacion (plaza_id, conductor_id, desde) VALUES ($1, $2, '2026-01-01')`, [p.id, yo.id]);
  await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta) VALUES ($1, 'vacaciones', '2026-12-05', '2026-12-12')`, [otro.id]);

  const d = await vacaciones.paraDecidir(yo.id, { desde: '2026-12-01', hasta: '2026-12-07' }, { hoy: '2026-11-25' });
  assert.equal(d.desde, '2026-12-01');
  assert.ok('saldo' in d.saldo || d.saldo.error, 'el saldo o por qué no lo hay');
  assert.equal(d.fuera.total, 1);
  assert.equal(d.fuera.lista[0].desde, '2026-12-05', 'recortado a las fechas pedidas');
  assert.equal(d.cobertura.coches.length, 1);
  assert.ok(d.cobertura.diasSinCubrir.length > 0, 'nadie más lleva su coche esos días');
  await assert.rejects(vacaciones.paraDecidir(yo.id, {}), /desde cuándo/);
}));
