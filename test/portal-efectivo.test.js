// ============================================================
// PORTAL DE CONDUCTORES — SU EFECTIVO EN DOS COLUMNAS (20/11/2026)
// ============================================================
// «En una columna lo que ha recibido durante los meses y en otra las veces que
// ha venido a dejar dinero». Del extracto de Recaudación: lo recibido, por mes
// (lo cobrado en BOLT y el dinero que se le dio); lo entregado, vez a vez. Y que
// recibido − entregado cuadre con el pendiente.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const portal = require('../modules/Portal/portal.service');

test('lo recibido, mes a mes; lo entregado, vez a vez, de lo más nuevo a lo más viejo', () => {
  const r = portal._enDosColumnas({
    pendiente: 120, saldoInicial: 0, cobrado: 500, entregado: 400, dado: 20,
    quincenas: [
      { anio: 2026, mes: 11, enCurso: true, cobrado: 200,
        movimientos: [{ fecha: '2026-11-18', que: 'Entregado en mano', importe: 150, baja: true, referencia: '' }] },
      { anio: 2026, mes: 11, cobrado: 100, movimientos: [
        { fecha: '2026-11-05', que: 'Cambio que te dimos', importe: 20, baja: false },
        { fecha: '2026-11-10', que: 'Transferencia', importe: 50, baja: true, referencia: 'ABC' }] },
      { anio: 2026, mes: 10, cobrado: 200, movimientos: [{ fecha: '2026-10-20', que: 'Descontado de tu nómina', importe: 200, baja: true }] },
      { anio: 2026, mes: 9, cobrado: 0, movimientos: [] },
    ],
  });
  assert.deepEqual(r.porMes.map(m => [m.nombre, m.cobrado, m.dado, m.enCurso]),
    [['noviembre 2026', 300, 20, true], ['octubre 2026', 200, 0, false]], 'las dos quincenas de noviembre juntas; un mes vacío no sale');
  assert.deepEqual(r.entregas.map(x => [x.fecha, x.importe, x.referencia || '']),
    [['2026-11-18', 150, ''], ['2026-11-10', 50, 'ABC'], ['2026-10-20', 200, '']], 'solo lo que baja lo que debe; el cambio que se le dio, no');
  assert.equal(r.recibido, 520);
  assert.equal(Math.round((r.recibido - r.entregado) * 100) / 100, r.pendiente, 'recibido − entregado = pendiente');
});
