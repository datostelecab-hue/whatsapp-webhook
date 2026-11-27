// ============================================================
// LOS TRAMOS HUÉRFANOS (27/11/2026)
// ============================================================
// Un tramo abierto en un coche del que BOLT ya no va a decir nada (porque lo ha
// quitado o le ha cambiado el identificador) se quedaba abierto para siempre:
// el 26/11 dio 17,8 h a una persona que, según BOLT, hizo menos de 8. Ahora se
// cierra si el coche ya no sale en el padrón o si su conductor está en otro coche.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const motor = require('../services/flotaViva/motor');

const H = 3600000;
const hace = h => new Date(Date.now() - h * H).toISOString();

async function preparar(consulta, coches, conductores) {
  for (const [uuid, matricula, vistoH, logH] of coches) {
    await consulta(
      `INSERT INTO fv_vehiculo (uuid, matricula, visto_at, ultimo_log_at) VALUES ($1, $2, $3, $4)`,
      [uuid, matricula, hace(vistoH), logH == null ? null : hace(logH)]);
  }
  for (const c of conductores) await consulta(`INSERT INTO fv_conductor (uuid, nombre) VALUES ($1, $1)`, [c]);
}
const tramo = (consulta, veh, cond, situacion, desdeH, hastaH) => consulta(
  `INSERT INTO fv_tramo (vehiculo_uuid, conductor_uuid, situacion, desde, hasta, km_m)
   VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
  [veh, cond, situacion, hace(desdeH), hastaH == null ? null : hace(hastaH)]).then(r => r.rows[0].id);
const fila = async (consulta, id) => (await consulta(
  `SELECT hasta, extract(epoch FROM now() - hasta) / 3600 AS hace_h FROM fv_tramo WHERE id = $1`, [id])).rows[0];
const abiertoDe = async (consulta, veh) => (await consulta(
  `SELECT situacion FROM fv_tramo WHERE vehiculo_uuid = $1 AND hasta IS NULL`, [veh])).rows[0];

test('el coche que BOLT ya no da: se cierra en su último apunte y queda desconectado', () => conBase(async ({ consulta }) => {
  await preparar(consulta, [['veh-ido', '1111AAA', 5, 6], ['veh-vivo', '2222BBB', 0.2, 0.3]], ['cond-1']);
  const id = await tramo(consulta, 'veh-ido', 'cond-1', 'viaje', 7, null);
  const vivo = await tramo(consulta, 'veh-vivo', 'cond-1', 'espera', 1, null);

  assert.equal(await motor.cerrarHuerfanos(), 1);
  const t = await fila(consulta, id);
  assert.ok(t.hasta, 'cerrado');
  assert.ok(Math.abs(Number(t.hace_h) - 6) < 0.01, 'en su último apunte, no ahora');
  assert.equal((await abiertoDe(consulta, 'veh-ido')).situacion, 'desconectado');
  assert.equal((await fila(consulta, vivo)).hasta, null, 'el del coche que sí está no se toca');
  assert.equal(await motor.cerrarHuerfanos(), 0, 'la segunda vez ya no hay nada');
}));

test('si el padrón lleva horas sin pasar no se cierra nada: es BOLT callado', () => conBase(async ({ consulta }) => {
  await preparar(consulta, [['veh-a', '3333CCC', 8, 8], ['veh-b', '4444DDD', 4, 4]], ['cond-1']);
  const id = await tramo(consulta, 'veh-a', 'cond-1', 'viaje', 9, null);
  assert.equal(await motor.cerrarHuerfanos(), 0);
  assert.equal((await fila(consulta, id)).hasta, null);
}));

test('el conductor en otro coche: el viejo se cierra cuando empezó en el nuevo', () => conBase(async ({ consulta }) => {
  await preparar(consulta, [['veh-viejo', '5555EEE', 0.2, 4], ['veh-nuevo', '6666FFF', 0.2, 0.5]], ['cond-2']);
  const viejo = await tramo(consulta, 'veh-viejo', 'cond-2', 'espera', 4, null);
  await tramo(consulta, 'veh-nuevo', 'cond-2', 'viaje', 3, 2);
  await tramo(consulta, 'veh-nuevo', 'cond-2', 'espera', 2, null);

  assert.equal(await motor.cerrarHuerfanos(), 1);
  assert.ok(Math.abs(Number((await fila(consulta, viejo)).hace_h) - 3) < 0.01, 'a la hora del primer tramo en el otro coche');
  assert.equal((await abiertoDe(consulta, 'veh-viejo')).situacion, 'desconectado');
  assert.equal((await abiertoDe(consulta, 'veh-nuevo')).situacion, 'espera');
}));

test('no se cierra si el coche viejo habló después, ni por un desconectado en el otro', () => conBase(async ({ consulta }) => {
  await preparar(consulta, [['veh-x', '7777GGG', 0.2, 1], ['veh-y', '8888HHH', 0.2, 0.5], ['veh-z', '9999JJJ', 0.2, 6]],
    ['cond-3', 'cond-4']);
  // El viejo dijo algo hace 1 h, después de que empezara en el otro (hace 3 h).
  const x = await tramo(consulta, 'veh-x', 'cond-3', 'espera', 4, null);
  await tramo(consulta, 'veh-y', 'cond-3', 'viaje', 3, null);
  // El conductor heredado en un «desconectado» de otro coche no cuenta.
  const z = await tramo(consulta, 'veh-z', 'cond-4', 'espera', 6, null);
  await consulta(`UPDATE fv_vehiculo SET ultimo_log_at = $2 WHERE uuid = $1`, ['veh-y', hace(0.5)]);
  await consulta(`INSERT INTO fv_vehiculo (uuid, matricula, visto_at) VALUES ('veh-w', '1212KKK', now())`);
  await tramo(consulta, 'veh-w', 'cond-4', 'desconectado', 2, null);

  assert.equal(await motor.cerrarHuerfanos(), 0);
  assert.equal((await fila(consulta, x)).hasta, null);
  assert.equal((await fila(consulta, z)).hasta, null);
}));
