// ============================================================
// EL LISTADO DE TRABAJADORES DE A3: FECHAS Y JORNADA (módulo 8, db/309, 27/11/2026)
// ============================================================
// El listado de trabajadores de A3 trae a todos, también a los que se fueron,
// con su fecha de ingreso, su fecha de baja («00/00/0000» si no la tienen) y su
// coeficiente de parcialidad. Quien tiene baja no está de alta para la gestoría,
// y salen cuatro diferencias más que decide Diana: corregir el ERP o pedírselo
// a la gestoría. Todo con datos de mentira.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const listado = require('../modules/Gestoria/listado');
const gestoria = require('../modules/Gestoria/gestoria.service');
const calendario = require('../services/calendario');

test('las celdas de A3: fechas en cualquier forma y la parcialidad en horas', () => {
  assert.equal(listado.fechaCelda('00/00/0000'), null, 'la «sin fecha» de A3');
  assert.equal(listado.fechaCelda('26/07/2026'), '2026-07-26');
  assert.equal(listado.fechaCelda('2026-07-05'), '2026-07-05');
  assert.equal(listado.fechaCelda(46238), '2026-08-04', 'número de serie de Excel (un .xls)');
  assert.equal(listado.fechaCelda(null), null);
  assert.equal(listado.horasDe('000'), 40);
  assert.equal(listado.horasDe('800'), 32);
  assert.equal(listado.horasDe('750'), 30);
  assert.equal(listado.horasDe(null, 'INDEFINIDO A TIEMPO COMPLETO'), 40);
  assert.equal(listado.horasDe(null, 'INDEFINIDO A TIEMPO PARCIAL'), null, 'parcial sin coeficiente: no se sabe');
});

test('el cruce con fechas: la baja de la gestoría cuenta, una fila por legajo y las cuatro diferencias nuevas', () => {
  const P = (id, legajo, vigente, alta, baja = null, jornada = 40) =>
    ({ id: String(id), nombre: `PERSONA ${id}, PRUEBA`, nombre_ss: null, legajo, vigente, tipo: 'propia', alta, baja, jornada_horas: jornada });
  const T = (fila, legajo, ingreso, baja = null, jornada = 40) =>
    ({ fila, legajo, nombre: `PERSONA ${Number(legajo)}, PRUEBA`, ingreso, baja, jornada });
  const personas = [
    P(1, '000001', true, '2026-01-10'),                        // todo igual
    P(2, '000002', true, '2026-03-01'),                        // la gestoría le dio de baja
    P(3, '000003', false, '2026-02-01', '2026-09-30'),          // baja en fechas distintas
    P(4, '000004', true, '2026-05-04'),                        // alta distinta
    P(5, '000005', true, '2026-06-01', null, 40),              // jornada distinta
    P(6, '000006', false, '2026-01-01', '2026-08-31'),          // se fue y la gestoría lo sigue teniendo
    P(7, '000007', true, '2026-10-01'),                        // recontratado: dos filas en A3
  ];
  const trabajadores = [
    T(4, '000001', '2026-01-10'),
    T(5, '000002', '2026-03-01', '2026-11-02'),
    T(6, '000003', '2026-02-01', '2026-10-15'),
    T(7, '000004', '2026-05-11'),
    T(8, '000005', '2026-06-01', null, 32),
    T(9, '000006', '2026-01-01'),
    T(10, '000007', '2025-03-01', '2025-09-30'),               // el contrato viejo
    T(11, '000007', '2026-10-01'),                             // el de ahora
    T(12, '000099', '2024-01-01', '2024-06-30'),               // alguien que se fue y el ERP no conoce
  ];
  const d = listado.cruzar({ trabajadores, personas, fecha: '2026-11-27', tipo: 'listado', conFechas: true, conJornada: true });
  const por = t => d.filter(x => x.tipo === t).map(x => x.conductorId);
  assert.deepEqual(por('baja_gestoria_alta_nuestra'), ['2']);
  assert.deepEqual(d.find(x => x.tipo === 'baja_gestoria_alta_nuestra').detalle.bajaGestoria, '2026-11-02');
  const fb = d.find(x => x.tipo === 'fecha_baja_distinta');
  assert.deepEqual([fb.conductorId, fb.detalle.erp, fb.detalle.gestoria, fb.detalle.dias], ['3', '2026-09-30', '2026-10-15', 15],
    '15 días de más en la gestoría');
  const fa = d.find(x => x.tipo === 'fecha_alta_distinta');
  assert.deepEqual([fa.conductorId, fa.detalle.erp, fa.detalle.gestoria, fa.detalle.abierto], ['4', '2026-05-04', '2026-05-11', true]);
  const j = d.find(x => x.tipo === 'jornada_distinta');
  assert.deepEqual([j.conductorId, j.detalle.erp, j.detalle.gestoria], ['5', 40, 32]);
  assert.deepEqual(por('alta_gestoria_baja_nuestra'), ['6'], 'el de siempre sigue saliendo');
  assert.equal(d.filter(x => x.conductorId === '7').length, 0, 'del recontratado cuenta su contrato de ahora');
  assert.equal(d.filter(x => x.legajo === '000099').length, 0, 'quien se fue y no conocemos no es una diferencia');
  assert.equal(d.filter(x => x.conductorId === '1').length, 0);
  assert.equal(por('alta_nuestra_no_gestoria').length, 0, 'el de baja en la gestoría no cuenta como «no sale»');
});

/** Un listado de trabajadores como el de A3, de mentira: cabecera en la fila 3. */
async function listadoA3(filas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PLANTILLA');
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([null, 'Legajo', 'TRABAJADOR', 'DNI', 'Contrato', 'Fecha Ingreso', 'Fecha Baja', 'Coeficiente Tiempo Parcial']);
  filas.forEach(f => ws.addRow([null, ...f]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('con la base: subir el listado de A3, pedírselo a la gestoría y corregir el ERP', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  const quien = { usuarioId: u.id, rol: 'superadmin' };
  const alta = calendario.sumarDias(calendario.hoy(), -30);
  const antes = calendario.sumarDias(alta, -3);
  const es = iso => iso.split('-').reverse().join('/');
  const jor = await fabrica.conductor({ nombre: 'JORGE', apellidos: 'JORNADA PRUEBA', alta });
  const fec = await fabrica.conductor({ nombre: 'FELIPE', apellidos: 'FECHAS PRUEBA', alta });
  const baj = await fabrica.conductor({ nombre: 'BEATRIZ', apellidos: 'BAJA PRUEBA', alta });
  await consulta(`UPDATE conductor SET legajo = '000801' WHERE id = $1`, [jor.id]);
  await consulta(`UPDATE conductor SET legajo = '000802' WHERE id = $1`, [fec.id]);
  await consulta(`UPDATE conductor SET legajo = '000803' WHERE id = $1`, [baj.id]);

  const b = (await listadoA3([
    ['000801', 'JORNADA PRUEBA, JORGE', 'X0000001A', 'INDEFINIDO A TIEMPO PARCIAL', es(alta), '00/00/0000', '800'],
    ['000802', 'FECHAS PRUEBA, FELIPE', 'X0000002B', 'INDEFINIDO A TIEMPO COMPLETO', es(antes), '00/00/0000', '000'],
    ['000803', 'BAJA PRUEBA, BEATRIZ', 'X0000003C', 'INDEFINIDO A TIEMPO COMPLETO', es(alta), es(calendario.sumarDias(alta, 10)), '000'],
  ])).toString('base64');
  const previa = await gestoria.subir({ base64: b, nombre: 'PLANTILLA TRABAJADORES.xlsx' }, quien);
  assert.equal(previa.resumen.conFechas, true);
  assert.equal(previa.resumen.fecha, calendario.hoy(), 'sin fecha en el fichero: la de hoy');
  assert.deepEqual(previa.resumen.porTipo, { jornada_distinta: 1, fecha_alta_distinta: 1, baja_gestoria_alta_nuestra: 1 });
  await gestoria.subir({ base64: b, nombre: 'PLANTILLA TRABAJADORES.xlsx', confirmar: true }, quien);

  const { filas } = await gestoria.lista(quien);
  const de = t => filas.find(f => f.tipo === t);

  // Pedírselo a la gestoría: entra en el correo y sigue pendiente.
  await gestoria.decidir(de('baja_gestoria_alta_nuestra').id, { como: 'gestoria' }, quien);
  const c = await gestoria.correo(quien);
  assert.match(c.cuerpo, /Figuran de baja en vuestro listado y siguen trabajando con nosotros/);
  assert.match(c.cuerpo, /000803 BAJA PRUEBA, BEATRIZ/);
  assert.equal(c.ids.length, 1, 'lo no decidido no va en el correo');
  assert.equal((await gestoria.ficha(de('baja_gestoria_alta_nuestra').id, quien)).estado, 'pendiente');
  await assert.rejects(gestoria.decidir(de('baja_gestoria_alta_nuestra').id, { como: 'erp' }, quien), /ficha de la persona/,
    'una baja no se corrige desde aquí');

  // Corregir el ERP: la jornada y la fecha de alta, por el camino de Plantilla.
  await gestoria.decidir(de('jornada_distinta').id, { como: 'erp' }, quien);
  assert.equal((await consulta(`SELECT jornada_horas FROM conductor_periodo_empleo WHERE conductor_id = $1`, [jor.id])).rows[0].jornada_horas, 32);
  await gestoria.decidir(de('fecha_alta_distinta').id, { como: 'erp' }, quien);
  assert.equal((await consulta(`SELECT to_char(alta, 'YYYY-MM-DD') a FROM conductor_periodo_empleo WHERE conductor_id = $1`, [fec.id])).rows[0].a, antes);
  assert.equal((await gestoria.ficha(de('jornada_distinta').id, quien)).estado, 'resuelta');

  // El listado siguiente: lo pedido se conserva mientras siga saliendo.
  const b2 = (await listadoA3([
    ['000801', 'JORNADA PRUEBA, JORGE', 'X0000001A', 'INDEFINIDO A TIEMPO PARCIAL', es(alta), '00/00/0000', '800'],
    ['000802', 'FECHAS PRUEBA, FELIPE', 'X0000002B', 'INDEFINIDO A TIEMPO COMPLETO', es(antes), '00/00/0000', '000'],
    ['000803', 'BAJA PRUEBA, BEATRIZ', 'X0000003C', 'INDEFINIDO A TIEMPO COMPLETO', es(alta), es(calendario.sumarDias(alta, 10)), '000'],
    ['000804', 'OTRA MAS, PRUEBA', 'X0000004D', 'INDEFINIDO A TIEMPO COMPLETO', es(alta), es(calendario.sumarDias(alta, 2)), '000'],
  ])).toString('base64');
  const r2 = await gestoria.subir({ base64: b2, nombre: 'PLANTILLA TRABAJADORES (2).xlsx', confirmar: true }, quien);
  assert.deepEqual([r2.nuevas, r2.siguen], [0, 1]);
  assert.equal((await gestoria.ficha(de('baja_gestoria_alta_nuestra').id, quien)).detalle.pedir, true);
}));

test('sin fecha en el fichero: la de quien lo sube, y aviso si el fichero es viejo', () => conBase(async () => {
  const b = await listadoA3([
    ['000901', 'VIEJO LISTADO, UNO', 'X0000009Z', 'INDEFINIDO A TIEMPO COMPLETO', '01/09/2026', '00/00/0000', '000'],
    ['000902', 'VIEJO LISTADO, DOS', 'X0000008Y', 'INDEFINIDO A TIEMPO COMPLETO', '01/03/2026', '15/09/2026', '000'],
  ]);
  const hoy = calendario.hoy();
  const a = await gestoria.analizar(b, {});
  assert.equal(a.resumen.fecha, hoy);
  if (calendario.sumarDias('2026-09-15', 30) < hoy) assert.ok(a.resumen.avisos.some(x => /lo más reciente del fichero es del 15\/09\/2026/.test(x)));
  const c = await gestoria.analizar(b, { fecha: '2026-09-16' });
  assert.equal(c.resumen.fecha, '2026-09-16');
  assert.ok(!c.resumen.avisos.some(x => /Ojo/.test(x)), 'con su fecha, sin aviso');
  await assert.rejects(gestoria.analizar(b, { fecha: calendario.sumarDias(hoy, 3) }), /futura/);
}));
