// ============================================================
// BARCELONA — LOS COCHES QUE EL PLANIFICADOR DA HOY A UNA CUENTA
// ============================================================
// Del 23/11/2026 el bot solo dejaba vincular ese coche; el 24/11 se quitó
// («quita todos los bloqueos de coche en Barcelona»). La consulta se queda:
// qué coches da el planificador a cada cuenta (con el de noche de ayer hasta
// las 12:00). Y que el bot ya no la usa para decir que no.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../modules/Barcelona/barcelona.repo');
const bcn = require('../modules/Barcelona/barcelona.service');

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

test('el bot ya no pregunta al planificador antes de vincular en Barcelona (24/11/2026)', () => {
  const fs = require('fs');
  const fichaje = fs.readFileSync(require.resolve('../services/fichaje'), 'utf8');
  assert.doesNotMatch(fichaje, /cochesPlanificados|no-es-su-coche/);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../services/fichajeBot'), 'utf8'), /no-es-su-coche/);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../modules/Portal/portal.coche'), 'utf8'), /no-es-su-coche/);
});
