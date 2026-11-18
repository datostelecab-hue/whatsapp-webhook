// ============================================================
// EL MAPA — el equipo muerto y el coche cambiado en BOLT (18/11/2026)
// ============================================================
// Camilo, con el 5886LBZ: «¿por qué me salen dos de esos en el mapa de
// Telecab, y en diferente posición? Además, en BOLT en estos momentos hay
// alguien con él, pero también está en otra posición muy diferente».
//
//   · el equipo muerto: un coche con dos equipos de Mapon pinta solo el que
//     habla si el otro lleva días callado; con uno solo, sale aunque calle;
//   · el coche cambiado: de viaje en BOLT con un coche que Mapon tiene parado,
//     mientras uno de SUS coches (bot o planificador) rueda sin nadie en BOLT.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const mapa = require('../modules/Mapa/mapa.service');
const repo = require('../modules/Mapa/mapa.repo');

const coche = (o = {}) => ({ matricula: null, rueda: false, situacion: null, tonoBase: 'parado', llevaAsi: 0,
  personaId: null, ftConductorId: null, conductor: null, ...o });

test('el coche cambiado: va de viaje en BOLT con uno parado y uno de sus coches rueda sin nadie en BOLT', () => {
  // El caso del 18/11: Israel (506) de viaje con el 5886LBZ, parado en Coslada
  // 50 min; el 9985LBC, uno de sus coches de correturnos, rodando sin nadie.
  const lista = [
    coche({ matricula: '5886LBZ', situacion: 'viaje', tonoBase: 'errorgps', llevaAsi: 3000, personaId: 506, conductor: 'Israel' }),
    coche({ matricula: '9985LBC', rueda: true, situacion: 'desconectado', tonoBase: 'suelto', llevaAsi: 900 }),
    coche({ matricula: '1111AAA', rueda: true, situacion: null, tonoBase: 'suelto', llevaAsi: 5000 }),   // rueda, pero no es suyo
    coche({ matricula: '0730MMZ', rueda: true, situacion: 'viaje', tonoBase: 'viaje', llevaAsi: 100 }),   // suyo, pero con otro en BOLT
  ];
  const cochesDe = new Map([[506, new Set(['0730MMZ', '9985LBC'])]]);
  const r = mapa.buscarCambiados(lista, cochesDe);
  assert.deepEqual([...r.keys()].sort(), [0, 1]);
  assert.deepEqual(r.get(0), { papel: 'puesto', otro: '9985LBC', persona: 'Israel', por: 'planificador', paradoS: 3000 });
  assert.deepEqual(r.get(1), { papel: 'real', otro: '5886LBZ', persona: 'Israel', por: 'planificador', paradoS: 3000 });

  // Con el otro coche fichado en el bot a su nombre, también (y lo dice).
  const conBot = lista.map((c, i) => (i === 2 ? { ...c, ftConductorId: 506 } : c));
  assert.equal(mapa.buscarCambiados(conBot, new Map()).get(0).otro, '1111AAA');
  assert.equal(mapa.buscarCambiados(conBot, new Map()).get(0).por, 'bot');

  // Sin el segundo coche no se acusa a nadie: sigue siendo «error de GPS».
  assert.equal(mapa.buscarCambiados(lista, new Map()).size, 0);
  // En espera, un coche parado es lo normal: tampoco.
  assert.equal(mapa.buscarCambiados([{ ...lista[0], situacion: 'espera', tonoBase: 'espera' }, lista[1]], cochesDe).size, 0);
  // Si su coche rueda con alguien conectado en BOLT, no es él quien lo lleva.
  assert.equal(mapa.buscarCambiados([lista[0], { ...lista[1], situacion: 'descanso' }], cochesDe).size, 0);
});

test('con la base: un coche con dos equipos pinta solo el que habla; con uno solo, sale aunque calle', () => conBase(async ({ fabrica, consulta }) => {
  const a = await fabrica.vehiculo();
  const b = await fabrica.vehiculo();
  const pos = (unit, mat, dias) => consulta(
    `INSERT INTO fv_posicion (mapon_unit, matricula, lat, lng, velocidad, rumbo, estado_mapon, visto_at, refrescado_at, estado_desde)
     VALUES ($1, $2, 40.4, -3.6, 0, 0, $3, now() - make_interval(days => $4::int), now(), now() - make_interval(days => $4::int))`,
    [unit, mat, dias > 2 ? 'nodata' : 'standing', dias]);
  await pos(990001, a.matricula, 50);   // el viejo, mudo desde hace 50 días
  await pos(990002, a.matricula, 0);    // el bueno
  await pos(990003, b.matricula, 50);   // el único de este coche: sale igual («Sin señal»)
  const filas = (await repo.coches(null, { diasMuerto: 7 })).filter(f => f.matricula === a.matricula || f.matricula === b.matricula);
  assert.deepEqual(filas.map(f => [f.matricula, Number(f.mapon_unit)]).sort(),
    [[a.matricula, 990002], [b.matricula, 990003]].sort());
  // Con un umbral más largo que su silencio, salen los dos equipos, como antes.
  const todos = (await repo.coches(null, { diasMuerto: 60 })).filter(f => f.matricula === a.matricula);
  assert.equal(todos.length, 2);
}));
