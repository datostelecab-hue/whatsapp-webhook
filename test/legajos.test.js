// ============================================================
// LOS LEGAJOS Y LOS FICHEROS IMPORTADOS (db/284, 25/11/2026)
// ============================================================
// Fase 0 del plan de RR. HH. y nóminas. Camilo: «Sí, reutiliza Legajo, solo
// plantilla propia». El legajo es el código de la gestoría: seis cifras con
// ceros delante; se cruza por el DNI, nunca por el nombre; lo que no cuadra es
// una incidencia y no se toca; el mismo fichero no se carga dos veces.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const legajo = require('../modules/Conductores/legajo');
const legajos = require('../modules/Conductores/legajos.service');
const repo = require('../modules/Conductores/conductores.repo');
const tareas = require('../services/tareasProgramadas');

test('el legajo en limpio: seis cifras con ceros delante; lo demás no vale', () => {
  assert.equal(legajo.normalizar('57'), '000057');
  assert.equal(legajo.normalizar(' 0057 '), '000057');
  assert.equal(legajo.normalizar(2630), '002630');
  assert.equal(legajo.normalizar('2630.0'), '002630', 'un número que Excel guardó con decimales');
  assert.equal(legajo.normalizar(''), null);
  assert.throws(() => legajo.normalizar('1234567'), /de 1 a 6 cifras/);
  assert.throws(() => legajo.normalizar('A12'), /de 1 a 6 cifras/);
  assert.equal(legajo.claveDni(' 01234567-x '), '1234567X', 'DNI sin ceros delante, en mayúsculas');
  assert.equal(legajo.claveDni('x-1234567-l'), 'X1234567L', 'un NIE no pierde nada');
});

test('el cruce: pone al que no tiene; lo que no cuadra es una incidencia y no se toca', () => {
  const personas = [
    { id: 1, nombre: 'Uno', dni_nie: '11111111H', legajo: null, empleo_vigente: true, empleo_tipo: 'propia' },
    { id: 2, nombre: 'Dos', dni_nie: '22222222J', legajo: '000002', empleo_vigente: true, empleo_tipo: 'propia' },
    { id: 3, nombre: 'Tres', dni_nie: '33333333P', legajo: '000003', empleo_vigente: true, empleo_tipo: 'propia' },
    { id: 4, nombre: 'Cuatro', dni_nie: '44444444A', legajo: null, empleo_vigente: true, empleo_tipo: 'propia' },
    { id: 5, nombre: 'Cinco', dni_nie: 'X5555555L', legajo: null, empleo_vigente: true, empleo_tipo: 'ett' },
    { id: 6, nombre: 'Seis A', dni_nie: '66666666Q', legajo: null, empleo_vigente: true, empleo_tipo: 'propia' },
    { id: 7, nombre: 'Seis B', dni_nie: '66666666-Q', legajo: null, empleo_vigente: false, empleo_tipo: null },
  ];
  const r = legajos.cruzar([
    { fila: 2, dni: '11111111h', legajo: '11', nombre: 'UNO' },       // se pone: 000011
    { fila: 3, dni: '22222222J', legajo: '2' },                        // ya lo tiene igual
    { fila: 4, dni: '33333333P', legajo: '30' },                       // tiene otro
    { fila: 5, dni: '44444444A', legajo: '3' },                        // de otra persona
    { fila: 6, dni: 'X5555555L', legajo: '55' },                       // ETT: se pone, y se dice
    { fila: 7, dni: '99999999R', legajo: '99' },                       // DNI que no está
    { fila: 8, dni: '66666666Q', legajo: '66' },                       // dos fichas con ese DNI
    { fila: 9, dni: '', legajo: '77' },                                // sin DNI
    { fila: 10, dni: '12345678Z', legajo: 'ABC' },                     // legajo raro
    { fila: 11, dni: '88888888Y', legajo: '88' }, { fila: 12, dni: '87878787X', legajo: '88' },   // repetido en el fichero
  ], personas);
  assert.deepEqual(r.poner.map(p => [p.id, p.legajo]), [['1', '000011'], ['5', '000055']]);
  assert.equal(r.poner.find(p => p.id === '5').ett, true);
  assert.deepEqual(r.igual.map(p => p.id), ['2']);
  assert.deepEqual(r.incidencias.map(i => [i.fila, i.motivo]), [
    [4, 'distinto'], [5, 'ocupado'], [7, 'desconocido'], [8, 'dni_repetido_erp'],
    [9, 'dni_vacio'], [10, 'legajo_invalido'], [11, 'repetido_fichero'], [12, 'repetido_fichero']]);
  assert.equal(r.incidencias.find(i => i.motivo === 'distinto').legajoErp, '000003');
  assert.equal(r.incidencias.find(i => i.motivo === 'ocupado').de.nombre, 'Tres');
});

async function excel(filas, { titulo = true } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Portada').getCell('A1').value = 'Nada que ver';
  const ws = wb.addWorksheet('Plantilla en alta');
  if (titulo) ws.addRow(['Listado de trabajadores en alta a 23/11/2026']);
  ws.addRow(['Nº Empleado', 'Trabajador', 'NIF']);
  filas.forEach(f => ws.addRow(f));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('el Excel: busca la hoja y la fila de cabecera; si no las hay, dice qué ha visto', async () => {
  const r = await legajos.leerExcel(await excel([[57, 'PEREZ, ANA', '11111111H'], [null, null, null], ['000058', 'LOPEZ, LUIS', '22222222J']]));
  assert.equal(r.hoja, 'Plantilla en alta');
  assert.equal(r.filaCabecera, 2);
  assert.deepEqual(r.columnas, { dni: 'NIF', legajo: 'Nº Empleado', nombre: 'Trabajador' });
  assert.deepEqual(r.filas.map(f => [f.fila, f.legajo, f.dni]), [[3, '57', '11111111H'], [5, '000058', '22222222J']]);

  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Hoja1').addRow(['Nombre', 'Importe']);
  await assert.rejects(legajos.leerExcel(Buffer.from(await wb.xlsx.writeBuffer())), /No encuentro una columna de DNI.*«Nombre»/);
  await assert.rejects(legajos.leerExcel(Buffer.from('no soy un excel')), /tiene que ser un Excel/);
});

test('con la base: la previa no cambia nada; al confirmar pone, apunta la carga y no deja cargarlo dos veces', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'RRHH' });
  const a = await fabrica.conductor({ nombre: 'Ana' });
  const b = await fabrica.conductor({ nombre: 'Luis' });
  await consulta(`UPDATE conductor SET dni_nie = '11111111H' WHERE id = $1`, [a.id]);
  await consulta(`UPDATE conductor SET dni_nie = '22222222J', legajo = '000058' WHERE id = $1`, [b.id]);
  const quien = { usuarioId: u.id, rol: 'superadmin' };
  const base64 = (await excel([[57, 'ANA', '11111111H'], [58, 'LUIS', '22222222J'], [99, 'NADIE', '99999999R']])).toString('base64');

  const previa = await legajos.cargar({ base64, nombre: 'plantilla.xlsx' }, quien);
  assert.deepEqual([previa.previa, previa.resumen.poner, previa.resumen.igual, previa.resumen.incidencias], [true, 1, 1, 1]);
  assert.equal((await consulta('SELECT legajo FROM conductor WHERE id = $1', [a.id])).rows[0].legajo, null, 'la previa no toca nada');

  const hecho = await legajos.cargar({ base64, nombre: 'plantilla.xlsx', confirmar: true }, quien);
  assert.equal(hecho.previa, false);
  assert.equal((await consulta('SELECT legajo FROM conductor WHERE id = $1', [a.id])).rows[0].legajo, '000057');
  const carga = (await consulta(`SELECT tipo, nombre, incidencias, subido_por, resultado FROM fichero_importado WHERE id = $1`, [hecho.cargaId])).rows[0];
  assert.deepEqual([carga.tipo, carga.nombre, carga.incidencias, carga.subido_por, carga.resultado.puestos], ['legajos', 'plantilla.xlsx', 1, u.id, 1]);
  // Queda en el libro, con su motivo.
  const libro = (await consulta(`SELECT motivo FROM auditoria WHERE tabla = 'conductor' AND registro = $1::text ORDER BY id DESC LIMIT 1`, [a.id])).rows[0];
  assert.match(libro.motivo, /Legajos cargados del fichero «plantilla.xlsx»/);

  // El mismo fichero, otra vez: la previa lo dice y confirmar no lo deja.
  const otra = await legajos.cargar({ base64, nombre: 'otra-vez.xlsx' }, quien);
  assert.ok(otra.yaCargado, 'la previa avisa de que ya se cargó');
  await assert.rejects(legajos.cargar({ base64, nombre: 'otra-vez.xlsx', confirmar: true }, quien), /ya se cargó/);

  // Tráfico no carga legajos.
  await assert.rejects(legajos.cargar({ base64 }, { usuarioId: u.id, rol: 'trafico' }), /Seguridad Social/);
}));

test('con la base: en la ficha, «57» se guarda «000057» y el de otra persona dice de quién es', () => conBase(async ({ consulta, fabrica }) => {
  const a = await fabrica.conductor({ nombre: 'Ana', apellidos: 'Pérez' });
  const b = await fabrica.conductor({ nombre: 'Luis' });
  await repo.actualizar(a.id, { legajo: '57' }, { rol: 'superadmin' });
  assert.equal((await consulta('SELECT legajo FROM conductor WHERE id = $1', [a.id])).rows[0].legajo, '000057');
  await assert.rejects(repo.actualizar(b.id, { legajo: '0057' }, { rol: 'superadmin' }), /El legajo 000057 ya lo tiene Pérez, Ana/);
  await assert.rejects(repo.actualizar(b.id, { legajo: 'abc' }, { rol: 'superadmin' }), /de 1 a 6 cifras/);
  await repo.actualizar(a.id, { legajo: '' }, { rol: 'superadmin' });
  assert.equal((await consulta('SELECT legajo FROM conductor WHERE id = $1', [a.id])).rows[0].legajo, null, 'se puede quitar');

  // Sin legajo, la plantilla propia lo tiene como hueco; la ETT, no.
  const ett = await fabrica.conductor({ nombre: 'Eva', tipo: 'ett' });
  const fichas = await repo.listar({ soloVigentes: true });
  const faltan = id => fichas.find(f => Number(f.id) === Number(id)).faltan;
  assert.ok(faltan(a.id).includes('legajo de la gestoría'));
  assert.ok(!faltan(ett.id).includes('legajo de la gestoría'));
  assert.ok((await repo.propiaSinLegajo()).some(p => p.id === String(a.id)));
}));

test('una vez a la semana: el lunes a la hora, el de esta semana; antes, solo el de la pasada', () => {
  const s = (iso, o) => tareas.cuando.semanal(new Date(iso), o);
  assert.deepEqual(s('2026-11-30T07:59:00+01:00', { dia: 1, hora: '08:00' }), ['2026-11-23']);
  assert.deepEqual(s('2026-11-30T08:00:00+01:00', { dia: 1, hora: '08:00' }), ['2026-11-23', '2026-11-30']);
  assert.deepEqual(s('2026-12-03T10:00:00+01:00', { dia: 1, hora: '08:00' }), ['2026-11-23', '2026-11-30'], 'el jueves');
  assert.deepEqual(s('2026-11-29T23:00:00+01:00', { dia: 1, hora: '08:00' }), ['2026-11-16', '2026-11-23'], 'el domingo es de la semana del lunes 23');
  assert.throws(() => s('2026-11-30T08:00:00+01:00', { dia: 0 }), /de 1 \(lunes\) a 7/);
});
