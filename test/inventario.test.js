// ============================================================
// INVENTARIO — los criterios del ítem 20 que ya se cumplen
// ============================================================
// Hoja de ruta de Ignacio, ítem 20 (Aprovisionamiento y recambios), criterio de
// aceptación: «Dar salida a un recambio baja las existencias y suma su coste a
// la matrícula». El inventario del 12/11/2026 ya lo hace (db/241): una salida a
// un coche resta del stock y crea el mantenimiento con su coste.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inventario = require('../modules/Vehiculos/inventario.repo');

const stockDe = async (consulta, id) =>
  Number((await consulta('SELECT stock FROM v_inventario_stock WHERE articulo_id = $1', [id])).rows[0].stock);

test('ítem 20: dar salida a un recambio baja las existencias y suma su coste a la matrícula', () =>
  conBase(async ({ fabrica, consulta }) => {
    const coche = await fabrica.vehiculo();
    const { id } = await inventario.crearArticulo(
      { descripcion: 'Amortiguador delantero de prueba', categoria: 'suspension', precio: '45,50', cantidad: 5, fecha: '01/11/2026' });
    assert.equal(await stockDe(consulta, id), 5);

    const r = await inventario.mover(
      { articuloId: id, tipo: 'salida', cantidad: 2, vehiculoId: coche.id, fecha: '05/11/2026' });

    assert.equal(r.stock, 3);
    assert.equal(await stockDe(consulta, id), 3, 'las existencias bajan');
    const m = (await consulta(
      'SELECT vehiculo_id, coste_cent, origen, fecha FROM mantenimiento WHERE id = $1', [r.mantenimientoId])).rows[0];
    assert.equal(Number(m.vehiculo_id), coche.id, 'el coste va a esa matrícula');
    assert.equal(Number(m.coste_cent), 9100, '2 × 45,50 € = 91,00 €');
    assert.equal(m.origen, 'inventario');
  }));

test('ítem 20: no se puede sacar más de lo que hay', () => conBase(async ({ fabrica, consulta }) => {
  const coche = await fabrica.vehiculo();
  const { id } = await inventario.crearArticulo(
    { descripcion: 'Pastillas de freno de prueba', categoria: 'frenos', precio: 20, cantidad: 1, fecha: '01/11/2026' });
  await assert.rejects(
    inventario.mover({ articuloId: id, tipo: 'salida', cantidad: 3, vehiculoId: coche.id, fecha: '05/11/2026' }),
    /Solo hay 1/);
  assert.equal(await stockDe(consulta, id), 1, 'el stock no se mueve');
  const n = await consulta(`SELECT count(*)::int n FROM mantenimiento WHERE vehiculo_id = $1`, [coche.id]);
  assert.equal(n.rows[0].n, 0, 'y no queda un mantenimiento a medias');
}));
