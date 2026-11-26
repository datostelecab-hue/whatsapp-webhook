// ============================================================
// LA PROFORMA DE A3, REVISADA CONTRA EL ERP (módulo 4, db/296, 25/11/2026)
// ============================================================
// Camilo: en Gestoría; cada caso se marca (corregir en A3, en el ERP o está
// bien); con los de A3, el correo a la gestoría; avisa, no frena. La proforma
// de la prueba se hace aquí, con la forma de la de A3 y sin datos de nadie.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const listado = require('../modules/Gestoria/listado');
const proforma = require('../modules/Gestoria/proforma');
const servicio = require('../modules/Gestoria/proforma.service');

/** Una proforma como la de A3: un trabajador por columna (desde la D), un concepto por fila. */
async function hacerProforma(trabajadores) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('1');
  ws.getCell('A2').value = 'Moneda: Euro';
  ws.getCell('A3').value = 'PAGA        TOTAL';
  ws.getCell('A4').value = 'DEL 01/11/26 AL 30/11/26';
  ws.getCell('A5').value = 'Empresa:  9999-EMPRESA DE PRUEBA SLU NIF: B00000000';
  ws.getCell('A9').value = 'CONCEPTO';
  ws.getCell('B11').value = 1; ws.getCell('C11').value = 'Salario Base';
  ws.getCell('B12').value = 451; ws.getCell('C12').value = 'Enfermedad';
  ws.getCell('A14').value = 'TOTAL BRUTO';
  ws.getCell('A16').value = 'TOTAL LIQUIDO';
  ws.getCell('A18').value = 'DIAS COTIZADOS';
  trabajadores.forEach((t, i) => {
    const c = 4 + i;
    if (t.nota) ws.getCell(3, c).value = t.nota;
    ws.getCell(4, c).value = t.legajo;
    const [a, b, n] = t.nombre.split(' ');
    ws.getCell(5, c).value = a; ws.getCell(6, c).value = b; ws.getCell(7, c).value = n;
    ws.getCell(11, c).value = 1000;
    if (t.it) ws.getCell(12, c).value = t.it;
    ws.getCell(14, c).value = 1000 + (t.it || 0);
    ws.getCell(16, c).value = 900;
    ws.getCell(18, c).value = t.dias;
  });
  return wb.xlsx.writeBuffer().then(b => Buffer.from(b));
}

test('leer: el mes, la empresa, cada trabajador y los totales', async () => {
  const b = await hacerProforma([{ legajo: '000101', nombre: 'UNO DOS TRES', dias: 30, nota: 'BAJA MEDICA', it: 50 }, { legajo: '000102', nombre: 'A B C', dias: 12 }]);
  const p = proforma.leer(await listado.hojasDe(b));
  assert.deepEqual([p.periodo, p.desde, p.hasta, p.empresa.codigo], ['2026-11', '2026-11-01', '2026-11-30', '9999']);
  assert.deepEqual(p.trabajadores.map(t => [t.legajo, t.nombre, t.dias, t.it, t.nota]),
    [['000101', 'UNO DOS TRES', 30, 50, 'BAJA MEDICA'], ['000102', 'A B C', 12, 0, '']]);
  assert.deepEqual(p.totales, { bruto: 2050, liquido: 1800, costeEmpresa: 0 });
  await assert.rejects(async () => proforma.leer([{ nombre: 'x', filas: [['nada']] }]), /No parece una proforma/);
});

test('a quién se parece un código: palabras distintas, la cortada por A3 vale, y gana la que más comparte', () => {
  // 26/11/2026: «MEDINA MEDINA MÓNICA» casaba con «MEDINA ROMERO CRISTIAN JEF» (contaba MEDINA dos veces).
  assert.equal(listado.mismoNombre('MEDINA ROMERO CRISTIAN JEF', 'MEDINA MEDINA MÓNICA'), false);
  assert.equal(listado.mismoNombre('MEDINA ROMERO CRISTIAN JEF', 'JEFFERSON, CRISTIAN'), true, 'JEF es el principio de JEFFERSON');
  const personas = [
    { id: '1', nombre: 'MEDINA MEDINA MÓNICA', legajo: '002619', empleos: [], situaciones: [] },
    { id: '2', nombre: 'JEFFERSON, CRISTIAN', legajo: null, empleos: [{ tipo: 'propia', alta: '2026-07-21', baja: null }], situaciones: [] },
    { id: '3', nombre: 'MEDINA ROMERO, CRISTIAN JEFFERSON', legajo: null, empleos: [], situaciones: [] },
  ];
  const casos = proforma.cruzar({ trabajadores: [{ legajo: '002648', nombre: 'MEDINA ROMERO CRISTIAN JEF', dias: 30, it: 0, nota: '' }],
    personas: personas.slice(0, 2), desde: '2026-11-01', hasta: '2026-11-30', hoy: '2026-11-26' });
  assert.equal(casos.find(c => c.tipo === 'legajo').detalle.propuesta.id, '2');
  assert.ok(!casos.some(c => c.tipo === 'sin_contrato'), 'ya no le achaca el mes a otra persona');
  const conTres = proforma.cruzar({ trabajadores: [{ legajo: '002648', nombre: 'MEDINA ROMERO CRISTIAN JEF', dias: 30, it: 0, nota: '' }],
    personas, desde: '2026-11-01', hasta: '2026-11-30', hoy: '2026-11-26' });
  assert.equal(conTres.find(c => c.tipo === 'legajo').detalle.propuesta.id, '3', 'entre dos parecidas, la que comparte más palabras');
});

test('subir, decidir y el correo: cada caso del cruce, y lo que ya no sale se cierra solo', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/gestoria'), ($1, '/gestoria/gestionar')`, [diana.id]);
  const D = { usuarioId: diana.id, rol: 'oficina' };
  const ficha = async (legajo, datos = {}) => {
    const c = await fabrica.conductor({ nombre: `N${legajo}`, ...datos });
    await consulta(`UPDATE conductor SET legajo = $2 WHERE id = $1`, [c.id, legajo]);
    return c;
  };
  await ficha('000101');                                              // cuadra
  const baja = await ficha('000102');                                 // baja médica sin IT
  await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta, motivo) VALUES ($1, 'baja_medica', '2026-11-10', '2026-11-15', 'prueba')`, [baja.id]);
  const susp = await ficha('000103');                                 // suspendida 5 días y cotiza 30
  await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta, motivo) VALUES ($1, 'suspendido', '2026-11-05', '2026-11-09', 'prueba')`, [susp.id]);
  await ficha('000104', { baja: '2026-11-20' });                     // se fue el 20 y cotiza 30
  await ficha('000105', { tipo: 'ett' });                            // para nosotros es de ETT
  await ficha('000107');                                              // de alta y no está en la nómina
  const gente = [
    { legajo: '000101', nombre: 'X Y N000101', dias: 30 },
    { legajo: '000102', nombre: 'X Y N000102', dias: 30 },
    { legajo: '000103', nombre: 'X Y N000103', dias: 30 },
    { legajo: '000104', nombre: 'X Y N000104', dias: 30 },
    { legajo: '000105', nombre: 'X Y N000105', dias: 30 },
    { legajo: '000199', nombre: 'QWERTY ASDFGH ZXCV', dias: 30 },  // ninguna ficha tiene el código
  ];
  const b1 = await hacerProforma(gente);
  const subir = (b, confirmar) => servicio.subir({ base64: b.toString('base64'), nombre: 'proforma.xlsx', confirmar }, D);

  const previa = await subir(b1, false);
  assert.deepEqual(previa.resumen.porTipo, { baja_medica: 1, suspension: 1, dias: 1, sin_contrato: 1, legajo: 1, fuera: 1 });
  const r = await subir(b1, true);
  assert.deepEqual([r.nuevos, r.quedan], [6, 6]);
  await assert.rejects(subir(b1, true), /ya se cargó|ya se subió|dos veces/i, 'la misma proforma no entra dos veces');
  assert.ok((await consulta(`SELECT 1 FROM tarea WHERE tipo = 'gestoria_proforma' AND origen_id = '2026-11' AND estado <> 'cerrada'`)).rows.length);

  const casos = (await servicio.lista(D)).filas;
  const de = t => casos.find(c => c.tipo === t);
  assert.match(de('suspension').frase, /Suspendido en el ERP del 05\/11\/2026 al 09\/11\/2026 \(5 días\) y la nómina cotiza 30 días/);
  assert.match(de('dias').frase, /Cotiza 30 días y por su contrato son 20/);
  assert.match(de('sin_contrato').frase, /ETT desde el 01\/01\/2026/);

  // Decidir: dos para la gestoría, el resto «está bien» salvo la baja médica.
  await servicio.decidir({ ids: [de('suspension').id, de('dias').id], decision: 'a3', nota: 'Revisad sus días' }, D);
  await servicio.decidir({ ids: ['sin_contrato', 'legajo', 'fuera'].map(t => de(t).id), decision: 'bien' }, D);
  const c = await servicio.correo(D);
  assert.equal(c.ids.length, 2);
  assert.match(c.cuerpo, /En la proforma de noviembre de 2026/);
  assert.match(c.cuerpo, /000103 X Y N000103: Suspendido en el ERP.*Revisad sus días/);
  await servicio.marcarEnviadas({ ids: c.ids }, D);
  assert.equal((await servicio.correo(D)).ids.length, 0, 'lo mandado no se repite');

  // Una proforma nueva del mismo mes, ya con la IT: la baja médica ya no sale y se cierra sola; la tarjeta, también.
  const b2 = await hacerProforma(gente.map(g => (g.legajo === '000102' ? { ...g, it: 120 } : g)));
  const r2 = await subir(b2, true);
  assert.deepEqual([r2.nuevos, r2.cerrados, r2.quedan], [0, 1, 0]);
  const tras = (await servicio.lista(D)).filas;
  assert.equal(tras.find(x => x.tipo === 'baja_medica').decision, 'ya_no_sale');
  assert.equal(tras.find(x => x.tipo === 'suspension').decision, 'a3', 'lo decidido se conserva');
  assert.equal((await consulta(`SELECT estado FROM tarea WHERE tipo = 'gestoria_proforma' AND origen_id = '2026-11'`)).rows[0].estado, 'cerrada');
}));
