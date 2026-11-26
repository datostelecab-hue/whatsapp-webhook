// ============================================================
// EL LIENZO DE A3 EN .XLS (módulo 4, 26/11/2026)
// ============================================================
// Escribir las variables en el .xls de la gestoría sin rehacerlo. Los dos
// lienzos de prueba (test/fixtures) los hizo Excel con nombres inventados: uno
// en claro y otro cifrado con RC4 CryptoAPI (contraseña «prueba»), como va el
// de A3 con la clave por defecto de Excel. Con el lienzo real de noviembre se
// comprobó a mano en Excel, celda a celda: solo cambian las escritas, y siguen
// la protección, la fila 1 oculta y los 11 nombres definidos.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lz = require('../modules/Gestoria/lienzoXls');
const EN_CLARO = fs.readFileSync(path.join(__dirname, 'fixtures', 'lienzo-a3-prueba.xls'));
const CIFRADO = fs.readFileSync(path.join(__dirname, 'fixtures', 'lienzo-a3-prueba-cifrado.xls'));

test('leído y montado sin cambios sale idéntico, en claro y cifrado', () => {
  assert.equal(lz.identico(EN_CLARO), true);
  assert.equal(lz.identico(CIFRADO, { clave: 'prueba' }), true);
  assert.throws(() => lz.leerLienzo(CIFRADO), /contraseña/, 'sin su clave no se abre');
  const l = lz.leerLienzo(CIFRADO, { clave: 'prueba' });
  assert.equal(l.filaCab, 7, 'la cabecera, en la fila 8');
  assert.deepEqual([...l.filas.keys()], ['101', '102', '103', '104', '105']);
  assert.deepEqual([...l.columnas.keys()], ['066', '753', '519', '053', '145', '758']);
  assert.equal(l.filas.get('103').nombre, 'PRUEBA TRES, CARLOS');
});

test('rellenar: huecos, cifras que ya estaban, sumas y lo que no cabe; lo demás no se toca', () => {
  for (const [buf, op] of [[EN_CLARO, {}], [CIFRADO, { clave: 'prueba' }]]) {
    const antes = lz.leerLienzo(buf, op);
    const r = lz.rellenarLienzo(buf, [
      { codigo: '000101', concepto: '066', importe: 50 },          // D9 tenía 375,21
      { codigo: '102', concepto: '519', importe: 4 },              // F10 tenía 12: 4 + 6
      { codigo: '102', concepto: '519', importe: 6 },
      { codigo: '104', concepto: '145', importe: -3.5 },           // regularización en negativo
      { codigo: '105', concepto: '758', importe: 9.99 },
      { codigo: '999', concepto: '066', importe: 1 },              // no está en el lienzo
      { codigo: '101', concepto: '376', importe: 1 },              // concepto que no trae
    ], op);
    assert.equal(r.escritas, 4);
    assert.deepEqual(r.ocupadas.map(o => [o.codigo, o.concepto, o.antes, o.ahora]), [['101', '066', 375.21, 50], ['102', '519', 12, 10]]);
    assert.deepEqual([r.sinFila, r.sinColumna, r.faltan], [['999'], ['376'], []]);
    assert.equal(r.cifrado, !!op.clave);
    const despues = lz.leerLienzo(r.buffer, op);
    const distintas = [...new Set([...antes.valores.keys(), ...despues.valores.keys()])]
      .filter(k => antes.valores.get(k) !== despues.valores.get(k)).sort();
    assert.deepEqual(distintas, ['11,7', '12,8', '8,3', '9,5'], 'solo cambian las escritas');
    assert.deepEqual(['8,3', '9,5', '11,7', '12,8'].map(k => despues.valores.get(k)), [50, 10, -3.5, 9.99]);
    assert.equal(lz.identico(r.buffer, op), true, 'y el escrito también se relee y monta idéntico');
  }
});

test('desde la pestaña Variables: las líneas del mes, por legajo; sin código, aparte', () => conBase(async ({ consulta, fabrica }) => {
  const variables = require('../modules/Gestoria/variables.service');
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Gestor' });
  for (const c of ['/gestoria', '/gestoria/gestionar']) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
  const g = { usuarioId: u.id, rol: 'oficina' };
  const ana = await fabrica.conductor({ nombre: 'ANA' });
  const sin = await fabrica.conductor({ nombre: 'SINCODIGO' });
  await consulta(`UPDATE conductor SET legajo = '000103' WHERE id = $1`, [ana.id]);
  const P = '2026-11';
  await variables.apuntar({ periodo: P, conductorId: ana.id, concepto: '066', importe: '120,50', motivo: 'Prueba del lienzo' }, g);
  await variables.apuntar({ periodo: P, conductorId: sin.id, concepto: '066', importe: '10', motivo: 'Prueba sin código' }, g);
  await assert.rejects(variables.lienzo({ periodo: '2026-12', base64: EN_CLARO.toString('base64') }, g), /prepáralas/);
  const r = await variables.lienzo({ periodo: P, base64: EN_CLARO.toString('base64'), nombre: 'nom_nov.xls' }, g);
  assert.equal(r.escritas, 1);
  assert.equal(r.nombre, 'nom_nov (variables noviembre de 2026).xls');
  assert.equal(r.sinCodigo.length, 1);
  const l = lz.leerLienzo(Buffer.from(r.base64, 'base64'));
  assert.equal(l.valores.get('10,3'), 120.5, 'la fila del 103, la columna del 066');
}));
