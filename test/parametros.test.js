// ============================================================
// PARÁMETROS DE NEGOCIO (pieza A3 de la hoja de ruta, db/243)
// ============================================================
// Convención 4 de Ignacio: «Todo número de regla es un parámetro […] editable
// por un administrador, no en el código». Y la 5: nada se borra.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const parametros = require('../services/parametros');

test('sin cambios, cada parámetro vale lo que dice la hoja de ruta', () => conBase(async () => {
  assert.equal(await parametros.valor('sanciones.plazo_dias_habiles'), 5);
  assert.equal(await parametros.valor('reintegros.tope_daiane'), 100);
  assert.equal(await parametros.valor('nomina.dia_pendientes'), 20);
  assert.deepEqual(await parametros.valor('oficina.madrid.horario'), { dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' });
}));

test('un parámetro que no existe no se inventa', () => conBase(async () => {
  await assert.rejects(parametros.valor('no.existe'), /No existe el parámetro/);
}));

test('cambiar exige motivo y un valor de su tipo y en sus límites', () => conBase(async ({ fabrica }) => {
  const u = await fabrica.usuario();
  const k = 'sanciones.plazo_dias_habiles';
  await assert.rejects(parametros.cambiar(k, 7, { usuarioId: u.id }), /Di por qué/);
  await assert.rejects(parametros.cambiar(k, 'siete', { usuarioId: u.id, motivo: 'prueba' }), /números enteros/);
  await assert.rejects(parametros.cambiar(k, 0, { usuarioId: u.id, motivo: 'prueba' }), /menos de 1/);
  await assert.rejects(parametros.cambiar(k, 5, { usuarioId: u.id, motivo: 'prueba' }), /ya es el valor/);
  await assert.rejects(parametros.cambiar('oficina.madrid.horario',
    { dias: [1, 2, 3, 4, 5], desde: '18:00', hasta: '09:00' }, { usuarioId: u.id, motivo: 'prueba' }), /después de la de abrir/);
  await assert.rejects(parametros.cambiar('oficina.madrid.horario',
    { dias: [], desde: '09:00', hasta: '18:00' }, { usuarioId: u.id, motivo: 'prueba' }), /al menos un día/);
}));

test('un cambio vale desde ahora, queda en la historia con quién y por qué, y lo de antes sigue sabiéndose', () =>
  conBase(async ({ fabrica }) => {
    const u = await fabrica.usuario({ nombre: 'Ignacio', apellidos: 'De Prueba' });
    const k = 'sanciones.plazo_dias_habiles';
    const fila = await parametros.cambiar(k, '7', { usuarioId: u.id, motivo: 'Lo pide la asesoría' });

    assert.equal(fila.valor, 7);
    assert.equal(fila.texto, '7 días hábiles');
    assert.equal(fila.esDefecto, false);
    assert.equal(await parametros.valor(k), 7);
    assert.equal(await parametros.valor(k, { en: new Date(Date.now() - 24 * 3600 * 1000) }), 5, 'ayer valía 5');

    const h = await parametros.historial(k);
    assert.equal(h.length, 1);
    assert.equal(h[0].quien, 'Ignacio De Prueba');
    assert.equal(h[0].motivo, 'Lo pide la asesoría');
  }));

test('convención 5: el historial de parámetros no se cambia ni se borra', () => conBase(async ({ fabrica, consulta }) => {
  const u = await fabrica.usuario();
  await parametros.cambiar('polizas.aviso_dias', 45, { usuarioId: u.id, motivo: 'prueba' });
  await consulta('SAVEPOINT antes_de_borrar');
  await assert.rejects(consulta('DELETE FROM parametro_cambio'), /no se cambia ni se borra/);
  await consulta('ROLLBACK TO SAVEPOINT antes_de_borrar');
  await assert.rejects(consulta(`UPDATE parametro_cambio SET motivo = 'otro'`), /no se cambia ni se borra/);
}));

test('cada parámetro se escribe como lo diría una persona', () => {
  assert.equal(parametros.formatear('sanciones.plazo_dias_habiles', 1), '1 día hábil');
  assert.equal(parametros.formatear('siniestros.parte_horas_habiles', 5), '5 horas hábiles');
  assert.equal(parametros.formatear('nomina.dia_pendientes', 20), 'el día 20 de cada mes');
  assert.match(parametros.formatear('reintegros.tope_daiane', 100), /^100,00\s€$/);
  assert.equal(parametros.formatear('oficina.madrid.horario', { dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' }),
    'de lunes a viernes, de 09:00 a 18:00');
});

test('cada entrada del catálogo es coherente: su defecto pasa su propia validación', () => {
  const claves = new Set();
  for (const p of parametros.CATALOGO) {
    assert.ok(!claves.has(p.clave), `clave repetida: ${p.clave}`);
    claves.add(p.clave);
    assert.ok(p.etiqueta && p.modulo, `${p.clave} sin etiqueta o módulo`);
    assert.ok(p.usa || p.item, `${p.clave} no dice quién lo usa ni qué ítem lo usará`);
    assert.deepEqual(parametros.validar(p.clave, p.defecto), p.defecto, `${p.clave}: su valor por defecto no pasa su validación`);
  }
});
