// ============================================================
// EL CATÁLOGO DE CONCEPTOS DE A3 Y LAS LÍNEAS DEL MES (módulo 4, db/300)
// ============================================================
// La variable del mes (MBO → 066, nocturnidad → 053, propinas → 519, peajes →
// 607; solo plantilla propia) y los descuentos aprobados, cada uno con su
// concepto, salen del ERP al preparar; lo demás, a mano con motivo. Con las
// variables marcadas enviadas en el cierre, el mes no cambia.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const variables = require('../modules/Gestoria/variables.service');
const cierre = require('../modules/Gestoria/cierre.service');
const descuentos = require('../modules/RRHH/descuentos.service');
const nominas = require('../modules/Nominas/nominas.service');

test('preparar desde el ERP, a mano, el Excel con la forma del lienzo y el mes cerrado', () => conBase(async ({ consulta, fabrica }) => {
  const usuario = async (nombre, claves) => {
    const u = await fabrica.usuario({ rol: 'oficina', nombre });
    for (const c of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
    return { usuarioId: u.id, rol: 'oficina' };
  };
  const mira = await usuario('Mira', ['/gestoria']);
  const gestor = await usuario('Gestor', ['/gestoria', '/gestoria/gestionar']);
  const jefeDesc = await usuario('Descuentos', ['/descuentos', '/descuentos/proponer', '/descuentos/aprobar']);
  const ana = await fabrica.conductor({ nombre: 'ANA' });
  const ben = await fabrica.conductor({ nombre: 'BEN' });
  const ett = await fabrica.conductor({ nombre: 'ETTX', tipo: 'ett' });
  await consulta(`UPDATE conductor SET legajo = '002650' WHERE id = $1`, [ana.id]);
  const P = '2026-11';

  // Un descuento de efectivo aprobado en noviembre (quien aprueba lo deja aprobado al apuntarlo).
  const d = await descuentos.crear({ conductorId: ana.id, origen: 'efectivo', importe: '45,5', fecha: '2026-11-20', motivo: 'Efectivo sin entregar' }, jefeDesc);
  assert.equal(d.estado, 'aprobado');

  const original = nominas.cargar;
  nominas.cargar = async (mes, ano) => {
    assert.deepEqual([mes, ano], [11, 2026], 'la variable de la nómina de noviembre');
    return { fuente: 'calculada', resultado: { filas: [
      { conductorId: ana.id, ett: false, mboFAS: 120, mboHsExt: 80.456, nocturnas: 12.3, propinas: 5, peajes: 0 },
      { conductorId: ben.id, ett: false, mboFAS: 0, mboHsExt: 33.333, nocturnas: 0, propinas: 0, peajes: 7.5 },
      { conductorId: ett.id, ett: true, mboFAS: 0, mboHsExt: 0, nocturnas: 50, propinas: 9, peajes: 0 },
    ] } };
  };
  try {
    await assert.rejects(variables.preparar({ periodo: P }, mira), e => e.status === 403);
    const r = await variables.preparar({ periodo: P }, gestor);
    assert.deepEqual([r.lineas, r.personas, r.variable, r.descuentos], [6, 2, 178.13, 45.5]);
    const l = (await variables.lista(mira)).filas.filter(f => f.periodo === P);
    const de = (cid, k) => l.find(f => f.conductor_id === String(cid) && f.concepto === k);
    assert.equal(de(ana.id, '066').importe, 120);
    assert.equal(de(ana.id, '066').detalle, 'MBO FAS');
    assert.equal(de(ben.id, '066').detalle, 'MBO por horas extra');
    assert.equal(de(ben.id, '066').importe, 33.33);
    assert.equal(de(ana.id, '753').importe, 45.5);
    assert.equal(de(ana.id, '753').origen, 'descuento');
    assert.ok(!l.some(f => f.conductor_id === String(ett.id)), 'la ETT va en el parte de la agencia');

    // A mano, con motivo; preparar otra vez no la toca.
    await assert.rejects(variables.apuntar({ periodo: P, conductorId: ben.id, concepto: '015', importe: '150', motivo: '' }, gestor), /Di por qué/);
    const m = await variables.apuntar({ periodo: P, conductorId: ben.id, concepto: '015', importe: '150,00', motivo: 'Plus de calidad de octubre' }, gestor);
    await assert.rejects(variables.anular(de(ana.id, '066').id, { motivo: 'no vale' }, gestor), /se rehacen/);
    assert.equal((await variables.preparar({ periodo: P }, gestor)).antes, 6);
    assert.equal((await variables.lista(mira)).filas.filter(f => f.periodo === P).length, 7);

    // El Excel: la cabecera del lienzo en la fila 8 y el código sin ceros; Ben, sin código, aparte.
    const x = await variables.excel(P, mira);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.buffer);
    const ws = wb.getWorksheet('Conceptos');
    assert.equal(ws.getCell('B8').value, 'Código');
    assert.equal(ws.getCell('D8').value, '066 - PACTO PR (I)');
    assert.equal(ws.getCell('B9').value, 2650);
    assert.equal(ws.getCell('D9').value, 120);
    assert.ok(wb.getWorksheet('Sin código'), 'Ben no tiene legajo');

    // Las variables enviadas en el cierre: el mes ya no cambia.
    await cierre.marcar({ periodo: P, etapa: 'variables', nota: 'Mandadas a la gestoría' }, gestor);
    await assert.rejects(variables.preparar({ periodo: P }, gestor), /deshaz esa etapa/);
    await assert.rejects(variables.anular(m.id, { motivo: 'Me equivoqué' }, gestor), /deshaz esa etapa/);
  } finally { nominas.cargar = original; }
}));

test('el catálogo: cada pieza de la variable va a un solo concepto', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Gestor' });
  for (const c of ['/gestoria', '/gestoria/gestionar']) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
  const g = { usuarioId: u.id, rol: 'oficina' };
  await assert.rejects(variables.guardarConcepto({ nuevo: true, codigo: '376', nombre: 'Plus productividad', origen: 'variable_mbo' }, g), /ya va al 066/);
  await variables.guardarConcepto({ nuevo: true, codigo: '376', nombre: 'Plus productividad', tipo: 'devengo' }, g);
  const c = (await variables.catalogo(g)).conceptos.find(x => x.codigo === '376');
  assert.deepEqual([c.cabecera, c.origen, c.activo], ['376 - PLUS PRO (I)', 'manual', true]);
  await assert.rejects(variables.guardarConcepto({ codigo: '999', nombre: 'No existe' }, g), /no existe/);
}));
