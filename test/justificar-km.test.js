// ============================================================
// LOS KM POR FUERA DE LA J (26/11/2026)
// ============================================================
// Camilo: «también habrá un número de KM por fuera que podremos justificarle
// para que su banco de KM no se vea afectado por tareas administrativas». La J
// de Control lleva unos km opcionales: nace con ella una justificación de KM,
// pendiente, que aprueba quien aprueba las J.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const control = require('../modules/Control/control.service');
const justificantes = require('../modules/Control/justificantes.service');
const kmj = require('../services/repo/kmJustificacion');

test('leer los km como los escribe una persona', () => {
  assert.equal(kmj.leerKm(''), null);
  assert.equal(kmj.leerKm(null), null);
  assert.equal(kmj.leerKm('12,25 km'), 12.3);
  assert.throws(() => kmj.leerKm('0'), /más que cero/);
  assert.throws(() => kmj.leerKm('abc'), /más que cero/);
  assert.throws(() => kmj.leerKm('1500'), /1\.000/);
});

test('la J con km: nace su justificación de KM pendiente, y la aprueba quien aprueba las J', () => conBase(async ({ consulta, fabrica }) => {
  const usuario = async (nombre, claves) => {
    const u = await fabrica.usuario({ rol: 'oficina', nombre });
    for (const c of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
    return { id: u.id, rol: 'oficina' };
  };
  const operador = await usuario('Operador', []);
  const apruebaJ = await usuario('Aprueba J', ['/justificantes']);
  const soloKm = await usuario('Solo KM', ['/justificantes/km']);
  const c = await fabrica.conductor({ nombre: 'KMJ' });

  // Unos km que no valen no dejan la J a medias.
  await assert.rejects(control.justificarEnDirecto({ conductorId: c.id, dia: '2026-11-25', horas: '2', observacion: 'Gestoría', km: '-3' }, null, operador.id), /más que cero/);
  assert.equal((await consulta(`SELECT count(*)::int n FROM justificante WHERE conductor_id = $1`, [c.id])).rows[0].n, 0);

  const r = await control.justificarEnDirecto({ conductorId: c.id, dia: '2026-11-25', horas: '2', observacion: 'Llevar papeles a la gestoría', km: '18,5', matricula: '1234-abc' }, null, operador.id);
  assert.equal(r.km, 18.5);
  const [k] = await kmj.listar({ estado: 'pendiente' });
  assert.deepEqual([k.id, k.conductorId, k.dia, k.km, k.matricula, k.motivo, k.estado],
    [r.kmJustificacionId, Number(c.id), '2026-11-25', 18.5, '1234ABC', 'Con la J: Llevar papeles a la gestoría', 'pendiente']);

  // Sin km, como siempre: solo la J.
  const c2 = await fabrica.conductor({ nombre: 'SINKM' });
  const r2 = await control.justificarEnDirecto({ conductorId: c2.id, dia: '2026-11-25', horas: '1', observacion: 'Taller' }, null, operador.id);
  assert.equal(r2.kmJustificacionId, null);

  // Aprueba quien aprueba las J, o quien tiene la llave de KM; el operador, no.
  assert.equal(await justificantes.apruebaKm(operador), false);
  assert.equal(await justificantes.apruebaKm(apruebaJ), true);
  assert.equal(await justificantes.apruebaKm(soloKm), true);
  await assert.rejects(justificantes.aprobarKm(k.id, operador), /llave/);
  await justificantes.aprobarKm(k.id, apruebaJ);
  assert.equal((await kmj.listar({ estado: 'aprobada' }))[0].id, k.id);
}));
