// ============================================================
// RECAUDACIÓN DE BARCELONA — «POR FECHAS», DE X A Y (23/11/2026)
// ============================================================
// «Que en Barcelona la recaudación se pueda elegir de fecha X a fecha Y, para
// elegir los montos correspondientes por rango de fechas». Por cada cuenta de
// BOLT: lo cobrado en efectivo, lo entregado, lo que se le dio y la diferencia.
// Es una consulta: no congela nada. Aquí la base es de mentira (db.consulta).
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../services/db');
const { repo } = require('../modules/Barcelona/recaudacion.service');

let guardada;
let consultas = [];
before(() => {
  guardada = db.consulta;
  db.consulta = async (sql, vals) => {
    consultas.push({ sql, vals });
    if (/FROM sede_bolt_order/.test(sql)) {
      return { rows: [
        { uuid: 'aaaa-1111', conductor_id: null, externo_nombre: 'Pedro Gil', viajes: 10, efectivo: '200.50' },
        { uuid: 'bbbb-2222', conductor_id: 5, externo_nombre: 'Luis Mora', viajes: 3, efectivo: '40.00' },
      ] };
    }
    if (/FROM sede_recaudacion_movimiento/.test(sql)) {
      return { rows: [
        { persona: 'aaaa-1111', entregado: '150.00', dado: '20.00', entregas: 2 },
        // Entregó sin haber cobrado nada esos días: también sale.
        { persona: 'cccc-3333', entregado: '30.00', dado: null, entregas: 1 },
      ] };
    }
    if (/externo_id AS id, externo_nombre AS nombre/.test(sql)) {
      return { rows: [{ id: 'aaaa-1111', nombre: 'Pedro Gil' }, { id: 'cccc-3333', nombre: 'Ana Sol' }] };
    }
    return { rows: [] };
  };
});
after(() => { db.consulta = guardada; });

test('suma por cuenta lo cobrado, lo entregado y lo dado, con la diferencia', async () => {
  consultas = [];
  const r = await repo.porFechas({ desde: '2026-11-03', hasta: '2026-11-09' });
  assert.equal(r.desde, '2026-11-03');
  assert.equal(r.hasta, '2026-11-09');
  assert.equal(r.recortado, false);
  const pedro = r.filas.find(f => f.id === 'aaaa-1111');
  assert.deepEqual(
    [pedro.viajes, pedro.cobrado, pedro.entregado, pedro.dado, pedro.entregas, pedro.diferencia],
    [10, 200.5, 150, 20, 2, 70.5], 'cobrado + dado − entregado');
  // Cada cuenta es su línea, aunque esté enlazada con una ficha (Barcelona no tiene fichas).
  assert.equal(r.filas.find(f => f.id === 'bbbb-2222').diferencia, 40);
  assert.equal(r.filas.find(f => f.id === 'cccc-3333').diferencia, -30);
  assert.deepEqual(r.filas.map(f => f.id), ['aaaa-1111', 'bbbb-2222', 'cccc-3333'], 'la que más debe, arriba');
  assert.deepEqual(r.total, { viajes: 13, cobrado: 240.5, entregado: 180, dado: 20, diferencia: 80.5 });
  // Las fechas van a las dos consultas, tal cual.
  assert.ok(consultas.filter(c => /BETWEEN \$1::date AND \$2::date/.test(c.sql))
    .every(c => c.vals[0] === '2026-11-03' && c.vals[1] === '2026-11-09'));
});

test('antes del corte no hay nada: se recorta al 1 de noviembre', async () => {
  const r = await repo.porFechas({ desde: '2026-10-20', hasta: '2026-11-05' });
  assert.equal(r.desde, '2026-11-01');
  assert.equal(r.recortado, true);
});

test('fechas que no valen', async () => {
  await assert.rejects(repo.porFechas({ desde: '2026-11-09', hasta: '2026-11-03' }), /anterior/);
  await assert.rejects(repo.porFechas({ desde: '', hasta: '2026-11-03' }), /dos fechas/);
  await assert.rejects(repo.porFechas({ desde: '2099-01-01', hasta: '2099-01-02' }), /futuras/);
  await assert.rejects(repo.porFechas({ desde: '2026-01-01', hasta: '2026-10-01' }), /antes del/);
});
