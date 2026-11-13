// ============================================================
// TAREAS PROGRAMADAS DE NEGOCIO (pieza A10 de la hoja de ruta, db/246)
// ============================================================
// Cada vez, una sola vez: aunque haya dos procesos (o el servidor de pruebas
// y el de producción) mirando la misma base, aunque el proceso muera a medias
// y aunque el servidor estuviera caído a la hora. Y el criterio del ítem 7 que
// es de calendario: «si el 20 no es hábil, se genera el día hábil anterior».
'use strict';

const { conBase, URL_PRUEBAS } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const tareas = require('../services/tareasProgramadas');

const intentos = async (consulta, tarea) =>
  (await consulta(`SELECT periodo, estado, error, resultado FROM tarea_programada_vez WHERE tarea = $1 ORDER BY id`, [tarea])).rows;

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

test('lo que escribe la tarea y su «hecha» entran juntos: si falla a medias, no queda nada a medias', () => conBase(async ({ consulta }) => {
  await consulta(`CREATE TABLE prueba_tarea_efecto (n int)`);
  const r = await tareas.una('prueba.medias', '2026-11', async ({ cli }) => {
    await cli.query(`INSERT INTO prueba_tarea_efecto VALUES (1)`);
    throw new Error('se cayó a mitad');
  });
  assert.equal(r.fallida, true);
  assert.equal((await consulta(`SELECT count(*)::int n FROM prueba_tarea_efecto`)).rows[0].n, 0, 'lo escrito se deshizo');
  assert.deepEqual((await intentos(consulta, 'prueba.medias')).map(x => x.estado), ['fallida']);
}));

test('si otro proceso la está haciendo (tiene su cerrojo), no se empieza otra vez', () => conBase(async () => {
  const otro = new Client({ connectionString: URL_PRUEBAS });
  await otro.connect();
  try {
    await otro.query(`SELECT pg_advisory_lock(hashtext('prueba.otro'), hashtext('2026-11'))`);
    let hecha = false;
    assert.deepEqual(await tareas.una('prueba.otro', '2026-11', async () => { hecha = true; }), { saltada: 'en curso en otro proceso' });
    assert.equal(hecha, false);
  } finally {
    await otro.end();   // al cerrarse la conexión, la base suelta el cerrojo: como un proceso que muere
  }
}));

test('si falla, queda el error y se reintenta más tarde, con pausas y con tope', () => conBase(async ({ consulta }) => {
  const mal = async () => { throw new Error('la gestoría no contesta'); };
  assert.deepEqual(await tareas.una('prueba.falla', '2026-11', mal), { fallida: true, error: 'la gestoría no contesta' });
  // Recién fallada: espera antes de reintentar.
  assert.deepEqual(await tareas.una('prueba.falla', '2026-11', mal), { saltada: 'esperando para reintentar' });
  // Pasado el rato, se reintenta (la tabla no deja borrar, pero sí mover la hora en el test).
  await consulta(`UPDATE tarea_programada_vez SET acabada_at = acabada_at - interval '3 hours' WHERE tarea = 'prueba.falla'`);
  const r = await tareas.una('prueba.falla', '2026-11', async () => ({ ok: 1 }));
  assert.equal(r.hecha, true);
  // Con el tope de fallos alcanzado, se deja.
  for (let i = 0; i < tareas.MAX_FALLOS; i++) {
    await consulta(`INSERT INTO tarea_programada_vez (tarea, periodo, estado, acabada_at, error) VALUES ('prueba.tope', '2026-11', 'fallida', clock_timestamp() - interval '1 day', 'x')`);
  }
  assert.deepEqual(await tareas.una('prueba.tope', '2026-11', async () => 1), { saltada: 'demasiados fallos' });
}));

test('el resultado guarda recuentos, nunca listas de personas, y un número raro no la hace fallar', () => conBase(async ({ consulta }) => {
  const r = await tareas.una('prueba.resultado', '2026-11', async () => ({
    tareas: 3, grande: 10n, ok: true, nota: 'bien', personas: [{ dni: '00000000T' }], texto_largo: 'x'.repeat(500),
  }));
  assert.equal(r.hecha, true);
  const guardado = (await intentos(consulta, 'prueba.resultado'))[0].resultado;
  assert.deepEqual(guardado, { tareas: 3, grande: 10, ok: true, nota: 'bien', _sin_guardar: 2 });
}));

test('convención 5: los intentos no se borran', () => conBase(async ({ consulta }) => {
  await tareas.una('prueba.borrar', '2026-11', async () => null);
  await consulta('SAVEPOINT intento');
  await assert.rejects(consulta(`DELETE FROM tarea_programada_vez WHERE tarea = 'prueba.borrar'`), /no se borran/);
  await consulta('ROLLBACK TO SAVEPOINT intento');
  await assert.rejects(consulta(`TRUNCATE tarea_programada_vez`), /no se borran/);
}));

test('a diario desde una hora de Madrid, y la de ayer para recuperarla', () => {
  assert.deepEqual(tareas.cuando.diaria(new Date('2026-11-13T07:59:00+01:00'), { hora: '08:00' }), ['2026-11-12']);
  assert.deepEqual(tareas.cuando.diaria(new Date('2026-11-13T08:00:00+01:00'), { hora: '08:00' }), ['2026-11-12', '2026-11-13']);
  // Las 00:30 del 14 en Madrid son las 23:30 del 13 en UTC: el día es el 14.
  assert.deepEqual(tareas.cuando.diaria(new Date('2026-11-13T23:30:00Z'), { hora: '00:00' }), ['2026-11-13', '2026-11-14']);
});

test('ítem 7: el día 20 a las 08:00; si el 20 no es hábil, el hábil anterior', () => conBase(async () => {
  const toca = ahora => tareas.cuando.mensualHabil(new Date(ahora), { dia: 20, hora: '08:00' });
  // Noviembre de 2026: el 20 es viernes, hábil. Octubre ya tocaba (se recupera si se perdió).
  assert.deepEqual(await toca('2026-11-20T07:59:00+01:00'), ['2026-10']);
  assert.deepEqual(await toca('2026-11-20T08:00:00+01:00'), ['2026-10', '2026-11']);
  // Diciembre de 2026: el 20 es domingo → el viernes 18.
  assert.deepEqual(await toca('2026-12-17T12:00:00+01:00'), ['2026-11']);
  assert.deepEqual(await toca('2026-12-18T08:30:00+01:00'), ['2026-11', '2026-12']);
  // Si el servidor estuvo caído del 18 a fin de mes, el 2 de enero aún recupera diciembre.
  assert.deepEqual(await toca('2027-01-02T10:00:00+01:00'), ['2026-12']);
}));

test('con el día 1, si no es hábil, toca el último hábil del mes anterior', () => conBase(async () => {
  const toca = ahora => tareas.cuando.mensualHabil(new Date(ahora), { dia: 1, hora: '08:00' });
  // El 1/8/2026 es sábado: la vez de agosto toca el viernes 31/7 a las 08:00.
  assert.deepEqual(await toca('2026-07-31T07:00:00+02:00'), ['2026-06', '2026-07']);
  assert.deepEqual(await toca('2026-07-31T08:30:00+02:00'), ['2026-06', '2026-07', '2026-08']);
}));

test('la vuelta hace lo que toca una vez, respeta «desde» y una tarea que falla no para a las demás', () => conBase(async () => {
  let buena = 0;
  const quitar = [
    tareas.registrar({ clave: 'prueba.vuelta_buena', desde: '2026-11', toca: () => ['2026-10', '2026-11'], hacer: async () => ({ n: ++buena }) }),
    tareas.registrar({ clave: 'prueba.vuelta_mala', toca: () => { throw new Error('sin calendario'); }, hacer: async () => {} }),
    tareas.registrar({ clave: 'prueba.vuelta_no_toca', toca: () => null, hacer: async () => { throw new Error('no debía'); } }),
  ];
  try {
    const r1 = await tareas.revisar(new Date('2026-11-20T09:00:00+01:00'));
    await tareas.revisar(new Date('2026-11-20T09:10:00+01:00'));
    assert.equal(buena, 1, 'una vez, y octubre no porque es anterior a «desde»');
    assert.equal(r1.find(x => x.clave === 'prueba.vuelta_mala').error, 'sin calendario');
    assert.equal(r1.some(x => x.clave === 'prueba.vuelta_no_toca'), false);
  } finally {
    quitar.forEach(q => q());
  }
}));

test('un nombre raro, una tarea repetida o un periodo que no es texto no pasan', () => conBase(async () => {
  assert.throws(() => tareas.registrar({ clave: 'Con Espacios', toca: () => null, hacer: async () => {} }), /no válido/);
  assert.throws(() => tareas.registrar({ clave: 'x'.repeat(65), toca: () => null, hacer: async () => {} }), /no válido/);
  const quitar = tareas.registrar({ clave: 'prueba.repetida', toca: () => null, hacer: async () => {} });
  try {
    assert.throws(() => tareas.registrar({ clave: 'prueba.repetida', toca: () => null, hacer: async () => {} }), /ya está registrada/);
  } finally { quitar(); }
  assert.equal((await tareas.una('prueba.periodo', new Date(), async () => 1)).fallida, true);
  assert.equal((await tareas.una('prueba.periodo', 'x'.repeat(41), async () => 1)).fallida, true);
}));
