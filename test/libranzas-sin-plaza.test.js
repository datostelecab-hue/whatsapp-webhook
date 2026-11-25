// ============================================================
// LOS DÍAS QUE LIBRA: MANDA LA PLAZA; SIN PLAZA, LO APUNTADO (25/11/2026)
// ============================================================
// Camilo: «algunos a los cuales no les apuntamos el día de libranza salen
// vacíos [en la ficha de alta], así ya tengan días de libranza por el
// planificador, además de que si no está planificado pero ya contratado, al
// darle en editar datos, no me sale para editarle los días de libranza».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const conductores = require('../modules/Conductores/conductores.service');
const plantilla = require('../modules/Conductores/plantilla.service');
const cand = require('../modules/Seleccion/candidaturas.service');

test('sin plaza vale lo apuntado; con plaza, la del planificador; y la ficha de alta los imprime', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario();
  const c = await fabrica.conductor({ nombre: 'LUIS' });

  assert.deepEqual(await conductores.libranzasDe(c.id), [], 'sin plaza ni nada apuntado, vacío');

  // Contratado y sin plaza: lo que se apunta en Plantilla es lo que hay.
  await plantilla.guardarLibranza(c.id, { dias: [6, 7] }, { usuarioId: u.id });
  assert.deepEqual(await conductores.libranzasDe(c.id), [6, 7]);
  assert.equal((await cand.paraFichaDeConductor(c.id)).libranza, 'Sábado y domingo');

  // El planificador le da una plaza de un coche que descansa miércoles y jueves:
  // manda la plaza, aunque siga habiendo un patrón apuntado a mano.
  const v = await fabrica.vehiculo();
  const p = (await consulta('INSERT INTO plaza (vehiculo_id, slot) VALUES ($1, 0) RETURNING id', [v.id])).rows[0];
  await consulta(`INSERT INTO asignacion (plaza_id, conductor_id, desde) VALUES ($1, $2, '2026-01-01')`, [p.id, c.id]);
  const vd = (await consulta(`INSERT INTO vehiculo_descanso (vehiculo_id, desde) VALUES ($1, '2026-01-01') RETURNING id`, [v.id])).rows[0];
  await consulta('INSERT INTO vehiculo_descanso_dia (descanso_id, dia_semana) VALUES ($1, 3), ($1, 4)', [vd.id]);

  assert.deepEqual(await conductores.libranzasDe(c.id), [3, 4]);
  const [fila] = await require('../modules/Conductores/conductores.repo').listar({ id: c.id });
  assert.equal(fila.libranzas_del_cuadrante, true);
  assert.equal((await cand.paraFichaDeConductor(c.id)).libranza, 'Miércoles y jueves',
    'la ficha de alta sale con los del planificador, aunque no se apuntaran al darle de alta');
}));
