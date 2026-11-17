// ============================================================
// LOS PUESTOS (db/255): la organización por roles, no por nombres
// ============================================================
// Camilo, 17/11/2026: «si mañana se va una Karen, puede que venga otra persona
// y tome su rol». De su puesto le vienen a cada persona su área, su superior y
// sus funciones; lo de a mano va encima.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const org = require('../services/organizacion');

async function oficina({ fabrica }) {
  const p = {};
  for (const n of ['Fernando', 'Ignacio', 'Angel', 'Lorenzo', 'Karen', 'Gabriel', 'Laura', 'Maria']) {
    p[n.toLowerCase()] = (await fabrica.usuario({ nombre: n })).id;
  }
  const puesto = { fernando: 'ceo', ignacio: 'direccion_operaciones', angel: 'jefe_control', lorenzo: 'jefe_control',
    karen: 'controlador', gabriel: 'controlador', laura: 'rrhh_laboral' };
  for (const [quien, cod] of Object.entries(puesto)) await org.ponerPuesto(p[quien], cod, { quien: p.ignacio });
  return p;
}
const ids = xs => xs.map(x => x.id).sort((a, b) => a - b);

test('el área, el superior y las funciones vienen del puesto; con dos jefes, los dos son superiores', () => conBase(async h => {
  const p = await oficina(h);
  const karen = await org.superioresDe(p.karen);
  assert.deepEqual(ids(karen), [p.angel, p.lorenzo].sort((a, b) => a - b), 'los dos jefes de control');
  assert.equal(karen[0].porque, 'su puesto');
  assert.equal((await org.superiorDe(p.angel)).id, p.ignacio, 'el jefe de control reporta a dirección de operaciones');
  assert.equal((await org.superiorDe(p.ignacio)).id, p.fernando, 'e Ignacio, al CEO');
  assert.equal(await org.superiorDe(p.fernando), null, 'el CEO no tiene a nadie encima');

  const o = await org.organigrama();
  const k = o.personas.find(x => x.id === p.karen);
  assert.deepEqual([k.puesto, k.area, k.superior], ['controlador', 'control', o.personas.find(x => x.id === p.angel).nombre + ' y ' + o.personas.find(x => x.id === p.lorenzo).nombre]);
  assert.ok(o.personas.find(x => x.id === p.angel).responsableDe.includes('Control'), 'su puesto dirige Control');

  assert.ok(ids(await org.quienes('supervisor')).includes(p.lorenzo), 'Lorenzo aprueba tarjetas por su puesto, como Ángel');
  assert.ok((await org.tiene(p.laura, 'expedientes')), 'y Laura lleva los expedientes por el suyo');
  const deControl = await org.deArea('control');
  for (const x of [p.karen, p.gabriel, p.angel, p.lorenzo]) assert.ok(deControl.includes(x), 'los avisos de Control, a su gente y sus jefes');
  assert.deepEqual(ids((await org.equipo(p.angel)).personas), [p.karen, p.gabriel, p.lorenzo].sort((a, b) => a - b),
    'el jefe ve el tablero de su área');
}));

test('si alguien se va, quien ocupa su puesto lo hereda; con el puesto vacío, se sube al de encima', () => conBase(async h => {
  const p = await oficina(h);
  await h.consulta(`UPDATE usuario SET estado = 'bloqueado' WHERE id = $1`, [p.laura]);
  assert.equal((await org.quienes('expedientes')).length, 0, 'Laura se fue: nadie lleva los expedientes');
  await org.ponerPuesto(p.maria, 'rrhh_laboral', { quien: p.ignacio });
  assert.deepEqual(ids(await org.quienes('expedientes')), [p.maria], 'quien ocupa su puesto los hereda, sin tocar nada más');
  assert.equal((await org.superiorDe(p.maria)).id, p.ignacio);

  await h.consulta(`UPDATE usuario SET estado = 'bloqueado' WHERE id = ANY($1::int[])`, [[p.angel, p.lorenzo]]);
  assert.deepEqual(ids(await org.superioresDe(p.karen)), [p.ignacio], 'sin jefes de control, sube al puesto de encima');
}));

test('lo de a mano va encima; una función del puesto no se le quita a la persona; un puesto no cierra un círculo', () => conBase(async h => {
  const p = await oficina(h);
  await assert.rejects(org.darFuncion(p.angel, 'supervisor', {}, { quien: p.ignacio }), /por su puesto/);
  const f = await org.darFuncion(p.karen, 'multas', {}, { quien: p.ignacio });
  const aMano = f.funciones.find(x => x.codigo === 'multas');
  assert.equal(aMano.dePuesto, false);
  await org.quitarFuncion(aMano.id, 'Lo vuelve a llevar Administración', { quien: p.ignacio });

  await org.ponerArea(p.gabriel, { area: 'taller', superiorId: p.fernando }, { quien: p.ignacio });
  const g = (await org.organigrama()).personas.find(x => x.id === p.gabriel);
  assert.deepEqual([g.area, g.areaAMano, g.superiorPorque], ['taller', true, 'a mano'], 'la excepción manda sobre el puesto');

  await assert.rejects(org.ponerArea(p.ignacio, { superiorId: p.karen }, { quien: p.ignacio }), /círculo/,
    'Ignacio no puede depender de una controladora que depende de él');
}));

test('el catálogo de puestos: sus funciones existen y nadie reporta en círculo', () => conBase(async h => {
  const r = await h.consulta(`SELECT p.codigo, p.reporta_a, COALESCE(array_agg(f.funcion) FILTER (WHERE f.id IS NOT NULL), '{}') AS funciones
    FROM puesto p LEFT JOIN puesto_funcion f ON f.puesto_codigo = p.codigo AND f.anulado_at IS NULL GROUP BY 1, 2`);
  assert.ok(r.rows.length >= 13);
  for (const x of r.rows) for (const f of x.funciones) assert.ok(org.FUNCIONES.some(c => c.codigo === f), `${x.codigo} lleva «${f}», que no está en el catálogo`);
  const arriba = new Map(r.rows.map(x => [x.codigo, x.reporta_a]));
  for (const x of r.rows) {
    const vistos = new Set([x.codigo]);
    for (let y = arriba.get(x.codigo); y; y = arriba.get(y)) {
      assert.ok(!vistos.has(y), `${x.codigo} reporta en círculo`);
      vistos.add(y);
    }
  }
  assert.equal(arriba.get('controlador'), 'jefe_control');
  assert.equal(arriba.get('ceo'), null);
}));
