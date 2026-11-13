// ============================================================
// TAREAS PROGRAMADAS DE NEGOCIO (pieza A10 de la hoja de ruta, db/246)
// ============================================================
// Cada vez, una sola vez: aunque haya dos procesos durante un despliegue, y
// aunque el servidor estuviera caído a la hora (se recupera en la siguiente
// vuelta). Y el criterio del ítem 7 que es de calendario: «si el 20 no es
// hábil, se genera el día hábil anterior».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tareas = require('../services/tareasProgramadas');

const intentos = async (consulta, tarea) =>
  (await consulta(`SELECT periodo, estado, error FROM tarea_programada_vez WHERE tarea = $1 ORDER BY id`, [tarea])).rows;

test('una vez por periodo: la segunda vuelta no la repite y otro periodo sí se hace', () => conBase(async ({ consulta }) => {
  let n = 0;
  const hacer = async () => ({ hechas: ++n });
  assert.deepEqual(await tareas.una('prueba.una', '2026-11', hacer), { hecha: true, resultado: { hechas: 1 } });
  assert.deepEqual(await tareas.una('prueba.una', '2026-11', hacer), { saltada: 'ya hecha' });
  assert.equal(n, 1);
  await tareas.una('prueba.una', '2026-12', hacer);
  assert.equal(n, 2);
  assert.deepEqual((await intentos(consulta, 'prueba.una')).map(x => x.estado), ['hecha', 'hecha']);
}));

test('si otro proceso la tiene en curso, no se empieza otra vez', () => conBase(async ({ consulta }) => {
  await consulta(`INSERT INTO tarea_programada_vez (tarea, periodo, instancia) VALUES ('prueba.otro', '2026-11', 'el otro')`);
  let hecha = false;
  assert.deepEqual(await tareas.una('prueba.otro', '2026-11', async () => { hecha = true; }), { saltada: 'en curso en otro proceso' });
  assert.equal(hecha, false);
}));

test('una que se quedó a medias hace horas se da por abandonada y se reintenta', () => conBase(async ({ consulta }) => {
  await consulta(`INSERT INTO tarea_programada_vez (tarea, periodo, instancia, empezada_at)
                  VALUES ('prueba.colgada', '2026-11', 'el que murió', clock_timestamp() - interval '3 hours')`);
  const r = await tareas.una('prueba.colgada', '2026-11', async () => 'ok');
  assert.equal(r.hecha, true);
  assert.deepEqual((await intentos(consulta, 'prueba.colgada')).map(x => x.estado), ['abandonada', 'hecha']);
}));

test('si falla, queda el error y la siguiente vuelta la reintenta', () => conBase(async ({ consulta }) => {
  const r1 = await tareas.una('prueba.falla', '2026-11', async () => { throw new Error('la gestoría no contesta'); });
  assert.deepEqual(r1, { fallida: true, error: 'la gestoría no contesta' });
  const r2 = await tareas.una('prueba.falla', '2026-11', async () => 'a la segunda');
  assert.equal(r2.hecha, true);
  const h = await intentos(consulta, 'prueba.falla');
  assert.deepEqual(h.map(x => x.estado), ['fallida', 'hecha']);
  assert.equal(h[0].error, 'la gestoría no contesta');
}));

test('convención 5: los intentos no se borran', () => conBase(async ({ consulta }) => {
  await tareas.una('prueba.borrar', '2026-11', async () => null);
  await assert.rejects(consulta(`DELETE FROM tarea_programada_vez WHERE tarea = 'prueba.borrar'`), /no se borran/);
}));

test('a diario desde una hora de Madrid', () => {
  assert.equal(tareas.cuando.diaria(new Date('2026-11-13T07:59:00+01:00'), { hora: '08:00' }), null);
  assert.equal(tareas.cuando.diaria(new Date('2026-11-13T08:00:00+01:00'), { hora: '08:00' }), '2026-11-13');
  // Las 00:30 del 14 en Madrid son las 23:30 del 13 en UTC: el día es el 14.
  assert.equal(tareas.cuando.diaria(new Date('2026-11-13T23:30:00Z'), { hora: '00:00' }), '2026-11-14');
});

test('ítem 7: el día 20 a las 08:00; si el 20 no es hábil, el hábil anterior', () => conBase(async () => {
  const toca = ahora => tareas.cuando.mensualHabil(new Date(ahora), { dia: 20, hora: '08:00' });
  // Noviembre de 2026: el 20 es viernes, hábil.
  assert.equal(await toca('2026-11-19T12:00:00+01:00'), null);
  assert.equal(await toca('2026-11-20T07:59:00+01:00'), null);
  assert.equal(await toca('2026-11-20T08:00:00+01:00'), '2026-11');
  // Diciembre de 2026: el 20 es domingo → el viernes 18.
  assert.equal(await toca('2026-12-17T12:00:00+01:00'), null);
  assert.equal(await toca('2026-12-18T08:30:00+01:00'), '2026-12');
  // Si el servidor estaba caído el 18, el 21 sigue tocando: se recupera.
  assert.equal(await toca('2026-12-21T10:00:00+01:00'), '2026-12');
}));

test('la vuelta hace las tareas que tocan, una vez cada una, y una que falla no para a las demás', () => conBase(async () => {
  let buena = 0;
  const quitar1 = tareas.registrar({ clave: 'prueba.vuelta_buena', toca: () => '2026-11', hacer: async () => { buena++; } });
  const quitar2 = tareas.registrar({ clave: 'prueba.vuelta_mala', toca: () => { throw new Error('sin calendario'); }, hacer: async () => {} });
  const quitar3 = tareas.registrar({ clave: 'prueba.vuelta_no_toca', toca: () => null, hacer: async () => { throw new Error('no debía'); } });
  try {
    const r1 = await tareas.revisar(new Date('2026-11-20T09:00:00+01:00'));
    await tareas.revisar(new Date('2026-11-20T09:10:00+01:00'));
    assert.equal(buena, 1);
    assert.equal(r1.find(x => x.clave === 'prueba.vuelta_mala').error, 'sin calendario');
    assert.equal(r1.some(x => x.clave === 'prueba.vuelta_no_toca'), false);
    assert.deepEqual(tareas.registradas().map(x => x.clave).filter(c => c.startsWith('prueba.')).sort(),
      ['prueba.vuelta_buena', 'prueba.vuelta_mala', 'prueba.vuelta_no_toca']);
  } finally {
    quitar1(); quitar2(); quitar3();
  }
}));

test('un nombre de tarea raro o una tarea repetida no se registran', () => {
  assert.throws(() => tareas.registrar({ clave: 'Con Espacios', toca: () => null, hacer: async () => {} }), /no válido/);
  const quitar = tareas.registrar({ clave: 'prueba.repetida', toca: () => null, hacer: async () => {} });
  try {
    assert.throws(() => tareas.registrar({ clave: 'prueba.repetida', toca: () => null, hacer: async () => {} }), /ya está registrada/);
  } finally { quitar(); }
});
