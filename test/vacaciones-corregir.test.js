// ============================================================
// VACACIONES — CORREGIR LAS QUE YA PASARON, AUDITADO (24/11/2026)
// ============================================================
// «Necesitamos poder modificar a Tarik las vacaciones, ya que no fueron
// vacaciones las solicitadas por William sino que era descanso excepcional» y
// «Laura puede modificar vacaciones ya disfrutadas o editarlas, pero siempre
// auditado en base de datos». Y: «déjalos como libranza excepcional, son 6 días».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const contexto = require('../services/contexto');
const vacaciones = require('../modules/Vacaciones/vacaciones.service');

// Quien tiene la llave de aprobar vacaciones (una sola persona, db/189) y un
// conductor con unas vacaciones que ya pasaron: del 30/10 al 04/11, 6 días.
async function montar({ consulta, fabrica }) {
  const laura = await fabrica.usuario({ nombre: 'Aprueba' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/vacaciones'), ($1, '/vacaciones/aprobar')`, [laura.id]);
  const otro = await fabrica.usuario({ nombre: 'SinLlave' });
  const c = await fabrica.conductor({ alta: '2026-01-01' });
  const [v] = (await consulta(
    `INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta, hasta_previsto, motivo, libra_dias)
     VALUES ($1, 'vacaciones', '2026-10-30', '2026-11-04', '2026-11-04', 'VACACIONES SOLICITADAS', ARRAY[6,7]::smallint[])
     RETURNING id`, [c.id])).rows;
  return { laura, otro, c, fila: v.id };
}
// Como lo hace la petición: el contexto con quién y desde dónde (app.js).
const comoPeticion = (usuarioId, fn) => contexto.correr({ usuarioId, origen: 'POST /vacaciones/api/…/corregir' }, fn);
const quien = u => ({ usuarioId: u.id, nombre: u.nombre });

test('pasarlas a libranza excepcional: la misma fila, otro tipo, y en el libro con quién y por qué', () => conBase(async ({ consulta, fabrica }) => {
  const { laura, c, fila } = await montar({ consulta, fabrica });
  const r = await comoPeticion(laura.id, () => vacaciones.corregirVacaciones(c.id, fila,
    { estado: 'libranza_excepcional', motivoCorreccion: 'Tráfico le dio esos días por las libranzas que trabajó' }, quien(laura)));
  assert.equal(r.corregida, true);
  const [h] = (await consulta(`SELECT estado, to_char(desde, 'YYYY-MM-DD') d, to_char(hasta, 'YYYY-MM-DD') h, libra_dias, motivo
                                 FROM conductor_estado_hist WHERE id = $1`, [fila])).rows;
  assert.deepEqual([h.estado, h.d, h.h, h.libra_dias, h.motivo],
    ['libranza_excepcional', '2026-10-30', '2026-11-04', null, 'VACACIONES SOLICITADAS'],
    'las fechas y el motivo de siempre se quedan; los dos días que libra eran cosa de vacaciones');

  const libro = (await consulta(`SELECT accion, usuario_id, origen, motivo, cambios FROM auditoria
                                  WHERE tabla = 'conductor_estado_hist' AND registro = $1::text ORDER BY id DESC LIMIT 1`, [fila])).rows[0];
  assert.ok(libro, 'queda en el libro de auditoría');
  assert.equal(Number(libro.usuario_id), Number(laura.id), 'con quién lo hizo');
  assert.match(libro.motivo, /^Corrección de vacaciones \(2026-10-30 → 2026-11-04\): Tráfico le dio esos días/, 'y por qué');
  assert.deepEqual(libro.cambios.estado, ['vacaciones', 'libranza_excepcional'], 'con el antes y el después');

  // En Vacaciones ya no restan: salen como libranza excepcional.
  const f = await vacaciones.ficha(c.id, { hoy: '2026-11-24' });
  assert.equal(f.detalle.vacaciones.length, 0);
  assert.deepEqual(f.detalle.libranzasExc.map(x => [x.desde, x.hasta, x.dentro]), [['2026-10-30', '2026-11-04', 6]]);
}));

test('cambiar las fechas de unas que ya pasaron, y borrarlas: también en el libro', () => conBase(async ({ consulta, fabrica }) => {
  const { laura, c, fila } = await montar({ consulta, fabrica });
  await comoPeticion(laura.id, () => vacaciones.corregirVacaciones(c.id, fila,
    { estado: 'vacaciones', desde: '2026-10-31', hasta: '2026-11-03', motivoCorreccion: 'Volvió dos días antes' }, quien(laura)));
  const [h] = (await consulta(`SELECT to_char(desde, 'YYYY-MM-DD') d, to_char(hasta, 'YYYY-MM-DD') h FROM conductor_estado_hist WHERE id = $1`, [fila])).rows;
  assert.deepEqual([h.d, h.h], ['2026-10-31', '2026-11-03']);

  const r = await comoPeticion(laura.id, () => vacaciones.corregirVacaciones(c.id, fila,
    { borrar: true, motivoCorreccion: 'Nunca se las cogió' }, quien(laura)));
  assert.equal(r.borrada, true);
  assert.equal((await consulta('SELECT 1 FROM conductor_estado_hist WHERE id = $1', [fila])).rows.length, 0);
  const borrado = (await consulta(`SELECT accion, usuario_id, motivo, antes FROM auditoria
                                    WHERE tabla = 'conductor_estado_hist' AND registro = $1::text ORDER BY id DESC LIMIT 1`, [fila])).rows[0];

  assert.equal(borrado.accion, "borrado");
  assert.equal(Number(borrado.usuario_id), Number(laura.id));
  assert.match(borrado.motivo, /Nunca se las cogió/);
  assert.equal(borrado.antes.estado, 'vacaciones', 'la fila de antes queda guardada');
}));

test('sin la llave, sin motivo, o a un tipo que no toca: no se cambia nada', () => conBase(async ({ consulta, fabrica }) => {
  const { laura, otro, c, fila } = await montar({ consulta, fabrica });
  await assert.rejects(comoPeticion(otro.id, () => vacaciones.corregirVacaciones(c.id, fila,
    { estado: 'libranza_excepcional', motivoCorreccion: 'Porque sí, sin llave' }, quien(otro))));
  await assert.rejects(comoPeticion(laura.id, () => vacaciones.corregirVacaciones(c.id, fila,
    { estado: 'libranza_excepcional', motivoCorreccion: '  ' }, quien(laura))), /por qué/);
  await assert.rejects(comoPeticion(laura.id, () => vacaciones.corregirVacaciones(c.id, fila,
    { estado: 'baja_medica', motivoCorreccion: 'No era vacaciones' }, quien(laura))), /No se pueden pasar/);
  const [h] = (await consulta('SELECT estado FROM conductor_estado_hist WHERE id = $1', [fila])).rows;
  assert.equal(h.estado, 'vacaciones');
}));
