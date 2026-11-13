// ============================================================
// RELOJ — fijar «ahora» en un test
// ============================================================
// Los plazos de la hoja de ruta (5 días hábiles, el día 20, 24 horas hábiles…)
// solo se pueden probar con una fecha fija. node:test trae su propio reloj
// falso: esto lo deja en una línea.
//
//   const { fijarAhora } = require('./apoyo/reloj');
//   test('vence el viernes', t => {
//     fijarAhora(t, '2026-11-13T09:00:00+01:00');   // un viernes a las 9, hora de Madrid
//     …
//   });
//
// Cambia lo que el código lee de JavaScript (new Date(), Date.now()) y se
// deshace solo al acabar el test. NO cambia el now() ni el CURRENT_DATE de
// PostgreSQL: el código nuevo recibe «hoy» como argumento o lo calcula en
// JavaScript, que es lo que se puede fijar.
'use strict';

/**
 * Pone el reloj de este test en `instante` (cadena ISO con su zona, o Date).
 * @param {import('node:test').TestContext} t
 * @param {string|Date} instante
 */
function fijarAhora(t, instante) {
  const ms = instante instanceof Date ? instante.getTime() : Date.parse(instante);
  if (!Number.isFinite(ms)) throw new Error(`fijarAhora: «${instante}» no es una fecha (usa ISO con zona: 2026-11-13T09:00:00+01:00)`);
  t.mock.timers.enable({ apis: ['Date'], now: ms });
}

module.exports = { fijarAhora };
