// ============================================================
// RECAUDACIÓN DE BARCELONA — EL EXCEL DE LO QUE DEBE CADA UNO (24/11/2026)
// ============================================================
// «Necesito un excel de recaudación con el monto que debe cada uno según los
// datos de BOLT y lo que nos han dado, pero solo en Barcelona» y «hazlo ya
// automático en el ERP, que sea un botón». Contra la base de pruebas: los
// cierres y las entregas se apuntan de verdad, y el Excel tiene que dar lo
// mismo que el cuadro de la pantalla.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const bcn = require('../modules/Barcelona/recaudacion.service');

const UUID = 'prueba-excel-bcn-0001';
const OTRA = 'prueba-excel-bcn-0002';

async function apuntar(consulta) {
  // Dos quincenas de BOLT para UUID (una con ajuste) y una para OTRA.
  await consulta(`INSERT INTO sede_recaudacion_cierre (bolt_uuid, anio, mes, quincena, importe, ajuste, ajuste_motivo, origen)
                  VALUES ($1, 2026, 11, 1, 500, 0, NULL, 'bolt'), ($1, 2026, 11, 2, 300, -20, 'viaje cobrado con tarjeta', 'bolt'),
                         ($2, 2026, 11, 1, 100, 0, NULL, 'bolt')`,
  [UUID, OTRA]);
  // Lo que nos ha dado: 200 en mano, 50 por nómina, 30 devueltos, 40 de cambio y una anulada.
  await consulta(`INSERT INTO sede_recaudacion_movimiento (bolt_uuid, fecha, tipo, importe, observacion)
                  VALUES ($1, '2026-11-05', 'presencial', 200, 'primera entrega'),
                         ($1, '2026-11-10', 'nomina', 50, NULL),
                         ($1, '2026-11-12', 'entrega', 30, 'se le devolvió'),
                         ($1, '2026-11-12', 'cambio', 40, NULL),
                         ($2, '2026-11-20', 'presencial', 150, NULL)`, [UUID, OTRA]);
  await consulta(`INSERT INTO sede_recaudacion_movimiento (bolt_uuid, fecha, tipo, importe, anulado_at, anulado_motivo)
                  VALUES ($1, '2026-11-06', 'presencial', 999, now(), 'mal apuntada')`, [UUID]);
}

const leer = async bytes => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes); return wb; };
const valor = v => (v && typeof v === 'object' && 'result' in v ? v.result : v);

test('las consultas nuevas: BOLT por quincena (con su ajuste) y las entregas sin anuladas', () => conBase(async ({ consulta }) => {
  await apuntar(consulta);
  const cierres = (await bcn.repo.cierresPorQuincena()).filter(c => c.quien === UUID);
  assert.deepEqual(cierres.map(c => [c.mes, c.quincena, c.bolt]), [[11, 1, 500], [11, 2, 280]]);
  const movs = (await bcn.repo.movimientosVigentes()).filter(m => /primera|devolvió/.test(m.observacion || '') || m.importe === 999);
  assert.deepEqual(movs.map(m => [m.fecha, m.tipo, m.importe]), [['2026-11-05', 'presencial', 200], ['2026-11-12', 'entrega', 30]],
    'la anulada no sale, y la fecha va tal cual (sin el día de antes)');
}));

test('el Excel da lo mismo que el cuadro de la pantalla, de más a menos, con fórmulas', () => conBase(async ({ consulta }) => {
  await apuntar(consulta);
  const { bytes, nombre } = await bcn.excelDeuda();
  assert.match(nombre, /^Recaudacion Barcelona - lo que debe cada uno - \d{2}-\d{2}-\d{4}\.xlsx$/);
  const wb = await leer(bytes);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Lo que debe cada uno', 'Entregas', 'Cómo se calcula']);
  const ws = wb.getWorksheet('Lo que debe cada uno');
  const cab = ws.getRow(4).values.slice(1);
  assert.ok(cab.includes('BOLT 1–15 nov') && cab.includes('BOLT 16–30 nov (hasta hoy)'), cab.join(' | '));
  const col = t => cab.indexOf(t) + 1;

  const { filas } = await bcn.repo.cuadro();
  const suya = filas.find(f => f.conductorId === UUID);
  // BOLT 780 (500 + 300 − 20) + cambio 40 − (en mano 200 − 30 devueltos + nómina 50) = 600.
  assert.equal(suya.aRecaudar, 600);

  const filasExcel = [];
  for (let r = 5; r <= ws.rowCount; r++) filasExcel.push(ws.getRow(r));
  const fila = filasExcel.find(r => String(r.getCell(1).value).includes(UUID.slice(0, 8)));
  assert.ok(fila, 'la cuenta sale (sin nombre en BOLT, con el principio de su uuid)');
  assert.equal(fila.getCell(col('BOLT 1–15 nov')).value, 500);
  assert.equal(fila.getCell(col('BOLT 16–30 nov (hasta hoy)')).value, 280);
  assert.equal(fila.getCell(col('Total cobrado en efectivo (BOLT)')).value, 780);
  assert.equal(fila.getCell(col('Entregado en mano')).value, 170);
  assert.equal(fila.getCell(col('Por nómina')).value, 50);
  assert.equal(fila.getCell(col('Cambio que le dimos')).value, 40);
  assert.equal(valor(fila.getCell(col('Total entregado')).value), 220);
  const debe = fila.getCell(col('DEBE')).value;
  assert.equal(debe.result, 600);
  assert.match(debe.formula, /^[A-Z]+\d+\+[A-Z]+\d+-[A-Z]+\d+$/, 'DEBE es una fórmula: cobrado + cambio − entregado');

  // De más a menos: la que debe 600 va antes que la que ha dado de más (100 − 150 = −50).
  const orden = filasExcel.map(r => valor(r.getCell(col('DEBE')).value)).filter(v => typeof v === 'number');
  assert.deepEqual(orden, [...orden].sort((a, b) => b - a));
  // La última fila, los totales con SUBTOTAL.
  const total = ws.getRow(ws.rowCount);
  assert.match(String(total.getCell(1).value), /^TOTAL/);
  assert.match(total.getCell(col('DEBE')).value.formula, /^SUBTOTAL\(9,/);

  const entregas = wb.getWorksheet('Entregas');
  const textos = [];
  for (let r = 5; r <= entregas.rowCount; r++) textos.push(entregas.getRow(r).values.slice(1).join(' | '));
  assert.ok(textos.some(t => t.includes('05/11/2026') && t.includes('En mano') && t.includes('200')));
  assert.ok(!textos.some(t => t.includes('999')), 'la anulada no sale');
}));

test('el botón está solo en la pantalla de Barcelona', async () => {
  const fs = require('fs');
  const vista = fs.readFileSync(require.resolve('../modules/Administracion/vistas/recaudacion.ejs'), 'utf8');
  assert.match(vista, /CON_EXCEL[\s\S]*href="<%= BASE %>\/excel"/);
  assert.match(fs.readFileSync(require.resolve('../modules/Barcelona/recaudacion.controller.js'), 'utf8'), /conExcel: true/);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../modules/Administracion/recaudacion.controller.js'), 'utf8'), /conExcel/);
});
