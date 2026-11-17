// ============================================================
// CÓMO VA CADA ZONA — el resumen de abajo de Inicio (17/11/2026)
// ============================================================
// Camilo: «Canillejas 450 h de 500 que debía hacer… si el coche no tiene CT,
// esos días no suman horas que debía hacer… si hoy el coche pasa de Alcobendas
// a Canillejas, en el lapso de esa fecha debían hacer tantas horas hasta que se
// cambió. Lo mismo cuando se pone en taller».
//
//   · la cuenta (rendimiento.service, zonasDiaADia), pura: cada día de cada
//     coche va a la zona que tenía ese día; el taller no cuenta;
//   · la base (db/264): mover un coche de cuadrante, o un cuadrante de zona,
//     apunta la zona nueva desde hoy y cierra la vieja la víspera.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rend = require('../modules/Control/rendimiento.service');

// Un coche con sus días: [día, turnos que le tocan, horas, parado?, turnos sin nadie]
const coche = (id, filas) => ({
  coche: { vehiculoId: id, matricula: `${id}PRB` },
  dias: filas.map(([d, turnos, h, parado = null, sin = 0]) => ({ d, turnos, obj: turnos * 8, h, antes: false, despues: false, parado, sin })),
});

test('cada día de un coche va a la zona que tenía ese día; el taller no cuenta ni lo que debía ni lo que hizo', () => {
  const per = { hoy: '2026-11-05' };
  const r = {
    zonas: [{ zona: 'Alcobendas' }, { zona: 'Canillejas' }],
    grupos: [
      // Hoy está en Canillejas, pero hasta el 2 estuvo en Alcobendas.
      { zona: 'Canillejas', coches: [coche(1, [
        ['2026-11-01', 2, 15], ['2026-11-02', 2, 16],
        ['2026-11-03', 2, 12], ['2026-11-04', 0, null, 'Taller'],
        ['2026-11-05', 2, null], ['2026-11-06', 2, null],
      ])] },
      // Sin correturnos: el día que libra un fijo solo toca un turno (8 h); y un turno sin nadie.
      { zona: 'Alcobendas', coches: [coche(2, [
        ['2026-11-01', 1, 7], ['2026-11-02', 2, 8, null, 1],
        ['2026-11-03', 2, 14], ['2026-11-04', 2, 16],
        ['2026-11-05', 2, null], ['2026-11-06', 2, null],
      ])] },
    ],
  };
  const hist = new Map([['1', [{ d: '2026-09-01', h: '2026-11-02', zona: 'Alcobendas' }, { d: '2026-11-03', h: null, zona: 'Canillejas' }]]]);
  const { zonas, total } = rend.zonasDiaADia(r, per, hist);
  const de = n => zonas.find(z => z.zona === n);
  // Alcobendas: coche 1 los días 1 y 2 (32 debía, 31 hizo) + coche 2 los cuatro cerrados (56 debía, 45 hizo).
  assert.deepEqual([de('Alcobendas').debian, de('Alcobendas').llevan, de('Alcobendas').coches], [88, 76, 2]);
  assert.equal(de('Alcobendas').perdidas, 8, 'un turno sin nadie: 8 h perdidas');
  // De dónde sale el déficit: Alcobendas debía 88 e hizo 76 (faltan 12): 8 por el
  // turno sin nadie y 4 de conductores que no llegan. Canillejas: 4, todo de conductores.
  assert.deepEqual([de('Alcobendas').deficit, de('Alcobendas').hPersonal, de('Alcobendas').hConductores, de('Alcobendas').causa], [12, 8, 4, 'personal']);
  assert.deepEqual([de('Canillejas').deficit, de('Canillejas').hPersonal, de('Canillejas').hConductores, de('Canillejas').causa], [4, 0, 4, 'conductores']);
  assert.equal(de('Canillejas').porTurno, 12 / 2, 'el día 3, dos turnos cubiertos con 12 h: 6 h por turno');
  // Turnos vacíos que pesan más que lo que falta: los que salen hacen de más y compensan.
  const z = rend.zonasDiaADia({ zonas: [{ zona: 'Aravaca' }], grupos: [{ zona: 'Aravaca', coches: [coche(3, [['2026-11-01', 2, 12, null, 1], ['2026-11-02', 2, 18]])] }] }, per, null).zonas[0];
  assert.deepEqual([z.deficit, z.hPersonal, z.hConductores, z.compensan, z.causa], [2, 8, 0, 6, 'personal']);
  // Canillejas: coche 1 el día 3 (16, 12); el 4 en taller no cuenta; del 5 en adelante, solo lo del mes.
  assert.deepEqual([de('Canillejas').debian, de('Canillejas').llevan, de('Canillejas').diasParado, de('Canillejas').mes], [16, 12, 1, 48]);
  assert.deepEqual(zonas.map(z => z.zona), ['Alcobendas', 'Canillejas'], 'en el orden del planificador');
  assert.deepEqual([total.debian, total.llevan, total.coches], [104, 88, 2]);
  assert.equal(Math.round(total.pct * 1000) / 1000, 0.846);
  // Sin historial (db/264 sin aplicar): todo a la zona de hoy.
  const sinHist = rend.zonasDiaADia(r, per, null);
  assert.deepEqual(sinHist.zonas.map(z => [z.zona, z.debian]), [['Alcobendas', 56], ['Canillejas', 48]]);
});

test('con la base (db/264): mover un coche de cuadrante apunta la zona nueva desde hoy y cierra la vieja la víspera', () => conBase(async ({ fabrica, consulta }) => {
  const zona = async nombre => Number((await consulta(
    'INSERT INTO base_zona (nombre, lat, lng) VALUES ($1, 40.4, -3.7) RETURNING id', [nombre])).rows[0].id);
  const a = await zona('Zona Prueba A'), b = await zona('Zona Prueba B');
  const cuadrante = async z => Number((await consulta('INSERT INTO cuadrante (nombre, base_zona_id) VALUES ($1, $2) RETURNING id', ['C prueba', z])).rows[0].id);
  const ca = await cuadrante(a), cb = await cuadrante(b);
  const v = await fabrica.vehiculo();
  const filas = async () => (await consulta(
    `SELECT base_zona_id AS z, to_char(desde, 'YYYY-MM-DD') AS d, to_char(hasta, 'YYYY-MM-DD') AS h
       FROM vehiculo_zona WHERE vehiculo_id = $1 ORDER BY desde, id`, [v.id])).rows.map(x => [x.z == null ? null : Number(x.z), x.d, x.h]);
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

  assert.deepEqual(await filas(), [[null, hoy, null]], 'al darlo de alta, sin zona desde hoy');
  await consulta('UPDATE vehiculo SET cuadrante_id = $2 WHERE id = $1', [v.id, ca]);
  assert.deepEqual(await filas(), [[a, hoy, null]], 'el mismo día manda el último cambio');
  // Como si llevara en A desde septiembre: el cambio de hoy cierra A la víspera.
  await consulta(`UPDATE vehiculo_zona SET desde = DATE '2026-09-01' WHERE vehiculo_id = $1`, [v.id]);
  await consulta('UPDATE vehiculo SET cuadrante_id = $2 WHERE id = $1', [v.id, cb]);
  const ayer = new Date(Date.parse(hoy + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  assert.deepEqual(await filas(), [[a, '2026-09-01', ayer], [b, hoy, null]]);
  // Pasar el cuadrante de zona mueve a sus coches; tocar otra cosa del coche, no.
  await consulta('UPDATE cuadrante SET base_zona_id = $2 WHERE id = $1', [cb, a]);
  assert.deepEqual((await filas()).pop(), [a, hoy, null]);
  await consulta(`UPDATE vehiculo SET marca_modelo = 'Otro' WHERE id = $1`, [v.id]);
  assert.equal((await filas()).length, 2);
  // Dar de baja el cuadrante lo deja sin zona.
  await consulta('UPDATE cuadrante SET baja_at = now() WHERE id = $1', [cb]);
  assert.deepEqual((await filas()).pop(), [null, hoy, null]);
}));
