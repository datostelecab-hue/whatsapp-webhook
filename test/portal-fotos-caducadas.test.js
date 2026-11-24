// ============================================================
// LAS FOTOS DEL PORTAL: 20 DÍAS Y FUERA (24/11/2026)
// ============================================================
// «Las fotos tomadas por los conductores los últimos 20 días, después del día
// 20, el lote de 10 fotos de hace 21 días se borra definitivamente de R2» y
// «que en el ERP, al entrar a la ficha del vehículo, se puedan ver las fotos
// por fecha, con límite de 20 días hacia atrás».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const almacen = require('../services/almacen');
const fotos = require('../modules/Portal/portal.fotos');

const HOY = '2026-12-20';
// Un instante de un día de Madrid, a las 12:00 (UTC+1 en invierno).
const a = dia => `${dia}T11:00:00Z`;

async function montar({ consulta, fabrica }) {
  const v = await fabrica.vehiculo({ matricula: '1234PRB' });
  const turno = async (dia, nombre) => (await consulta(
    `INSERT INTO fichaje_turno (referencia, telefono, nombre, matricula, vehiculo_id, inicio, fin, estado, tipo)
     VALUES ($1, '600000000', $2, '1234PRB', $3, $4::timestamptz - interval '8 hours', $4::timestamptz, 'cerrado', 'turno')
     RETURNING id`, [`prueba-${dia}-${nombre}`, nombre, v.id, a(dia)])).rows[0].id;
  const fotoDe = async (turnoId, dia, n) => (await consulta(
    `INSERT INTO adjunto (dueno_tipo, dueno_id, almacen, ruta, nombre, mime, bytes, sha256, creado_at)
     VALUES ('turno_fotos', $1, 'disco', $2, $3, 'image/jpeg', 1000, repeat('a', 64), $4)
     RETURNING id`, [String(turnoId), `pruebas/fotos/${turnoId}-${n}`, `${n}-foto.jpg`, a(dia)])).rows[0].id;
  const t21 = await turno('2026-11-29', 'Hace21');   // hace 21 días: se borra
  const t20 = await turno('2026-11-30', 'Hace20');   // hace 20 días: se queda
  const tHoy = await turno(HOY, 'DeHoy');
  const ids = {};
  for (const [t, dia] of [[t21, '2026-11-29'], [t20, '2026-11-30'], [tHoy, HOY]]) {
    ids[dia] = [];
    for (let n = 1; n <= 5; n++) ids[dia].push(await fotoDe(t, dia, n));
  }
  return { v, ids };
}

test('se guardan 20 días: lo de hace 21 se borra del almacén y de la base; lo demás se queda', () => conBase(async ({ consulta, fabrica }) => {
  const { ids } = await montar({ consulta, fabrica });
  const borradas = [];
  const real = almacen.de;
  almacen.de = nombre => ({ ...real(nombre), borrar: async ruta => { borradas.push(ruta); } });
  try {
    const r = await fotos.purgar({ query: (s, p) => consulta(s, p) }, { hoy: HOY });
    assert.deepEqual([r.borradas, r.fallos, r.antesDe], [5, 0, '2026-11-30']);
  } finally { almacen.de = real; }
  assert.equal(borradas.length, 5, 'los cinco ficheros, del almacén');
  const quedan = (await consulta(`SELECT id FROM adjunto WHERE dueno_tipo = 'turno_fotos' AND id = ANY($1::bigint[])`,
    [[...ids['2026-11-29'], ...ids['2026-11-30'], ...ids[HOY]]])).rows.map(x => Number(x.id));
  assert.deepEqual(quedan.sort((x, y) => x - y), [...ids['2026-11-30'], ...ids[HOY]].map(Number).sort((x, y) => x - y));
  // Queda en el libro que se borraron, con su porqué.
  const libro = (await consulta(`SELECT accion, motivo FROM auditoria WHERE tabla = 'adjunto' AND registro = $1::text ORDER BY id DESC LIMIT 1`,
    [ids['2026-11-29'][0]])).rows[0];
  assert.equal(libro.accion, 'borrado');
  assert.match(libro.motivo, /más de 20 días/);
}));

test('si el almacén falla con una, su fila se queda para el día siguiente', () => conBase(async ({ consulta, fabrica }) => {
  const { ids } = await montar({ consulta, fabrica });
  const real = almacen.de;
  let n = 0;
  almacen.de = nombre => ({ ...real(nombre), borrar: async () => { if (++n === 2) throw new Error('R2 no contesta'); } });
  try {
    const r = await fotos.purgar({ query: (s, p) => consulta(s, p) }, { hoy: HOY });
    assert.deepEqual([r.borradas, r.fallos], [4, 1]);
  } finally { almacen.de = real; }
  const quedan = (await consulta(`SELECT count(*)::int n FROM adjunto WHERE id = ANY($1::bigint[])`, [ids['2026-11-29']])).rows[0].n;
  assert.equal(quedan, 1);
}));

test('la ficha del vehículo: por día, de la más nueva, con sus cinco fotos y su nombre; nada de antes de 20 días', () => conBase(async ({ consulta, fabrica }) => {
  const { v } = await montar({ consulta, fabrica });
  const r = await fotos.deVehiculo(v.id, { hoy: HOY });
  assert.equal(r.desde, '2026-11-30');
  assert.deepEqual(r.porDia.map(d => d.dia), [HOY, '2026-11-30'], 'sin el de hace 21 días');
  const vez = r.porDia[0].veces[0];
  assert.equal(vez.quien, 'DeHoy');
  assert.deepEqual(vez.fotos.map(f => f.etiqueta), ['Lateral conductor', 'Frontal', 'Lateral copiloto', 'Parte trasera', 'Asientos pasajeros']);
  assert.match(vez.fotos[0].url, /^\/adjuntos\/\d+\/fichero$/);
}));
