// ============================================================
// LA PLANTILLA DE LA GESTORÍA (módulo 8, db/287, 25/11/2026)
// ============================================================
// «Sí, arranca el módulo 8 con la proforma». El listado de la gestoría (la
// proforma de A3NOM, en .xls y cifrada por Excel) se lee sin librerías, se
// cruza por legajo y cada diferencia vive hasta que se resuelve.
// Las muestras de test/apoyo/ficheros/ son de mentira (hechas con Excel), sin
// datos de nadie.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const xls = require('../services/xls');
const listado = require('../modules/Gestoria/listado');
const gestoria = require('../modules/Gestoria/gestoria.service');
const calendario = require('../services/calendario');

const muestra = n => fs.readFileSync(path.join(__dirname, 'apoyo', 'ficheros', n));

test('el .xls sin librerías: sin cifrar, con cada cifrado de Excel, y el que tiene contraseña lo dice', () => {
  for (const n of ['proforma.xls', 'proforma-cifrada.xls']) {
    const l = xls.leer(muestra(n));
    const h = l.hojas[0];
    assert.equal(h.nombre, 'Conceptos', n);
    assert.equal(l.cifrado, n.includes('cifrada'), n);
    assert.deepEqual(['B9', 'C11', 'D9', 'D11', 'E10', 'F9', 'D8'].map(r => xls.valor(h, r)),
      [57, 'NUEVO TRES, ÑOÑO', 187.5, 1000000.25, -12.34, 40, '066 - PACTO PR (I)'], n);
    assert.equal(xls.valor(h, 'H12'), 'texto de fórmula', 'el texto que da una fórmula');
    assert.equal(xls.valor(h, 'H13'), 375, 'el número que da una fórmula');
    assert.equal(String(xls.valor(h, 'H14')).length, 9000, 'un texto largo, partido en varios registros');
    assert.equal(xls.valor(h, 'A1'), '0480207735231120260CT', 'la fila oculta de A3 también se lee');
  }
  assert.throws(() => xls.leer(muestra('proforma-con-clave.xls')), /contraseña de apertura/);
  assert.throws(() => xls.leer(Buffer.from('no soy un excel')), /No es un Excel \.xls/);
  assert.equal(xls._rk(0x00000002 | (5 << 2)), 5);
  assert.equal(xls._rk(0x00000003 | (1234 << 2)), 12.34);
});

test('la proforma interpretada: empresa, fecha, conceptos y un trabajador por fila', async () => {
  const l = listado.interpretar(await listado.hojasDe(muestra('proforma-cifrada.xls')));
  assert.equal(l.tipo, 'proforma');
  assert.deepEqual(l.empresa, { codigo: '7735', nombre: 'EMPRESA DE PRUEBA SL' });
  assert.equal(l.fecha, '2026-11-23');
  assert.deepEqual(l.conceptos.map(c => c.codigo), ['066', '753', '053']);
  assert.deepEqual(l.trabajadores.map(t => [t.fila, t.legajo, t.nombre]),
    [[9, '000057', 'PRUEBA UNO, ANA'], [10, '002614', 'PRUEBA DOS, LUIS'], [11, '002700', 'NUEVO TRES, ÑOÑO']]);
  assert.equal(listado.fechaDe('5 de Enero de 2027'), '2027-01-05');
  assert.equal(listado.fechaDe('05/01/2027'), '2027-01-05');
});

test('el cruce: cada diferencia con lo suyo; quien se va a mitad del mes de la proforma no lo es', () => {
  const P = (id, nombre, legajo, vigente, tipo, alta, baja = null) => ({ id: String(id), nombre, nombre_ss: null, legajo, vigente, tipo, alta, baja });
  const personas = [
    P(1, 'PRUEBA UNO, ANA', '000057', true, 'propia', '2026-01-01'),
    P(2, 'PRUEBA DOS, LUIS', '002614', false, 'propia', '2026-01-01', '2026-09-04'),     // se fue antes de noviembre
    P(3, 'MEDIO MES, EVA', '000300', false, 'propia', '2026-01-01', '2026-11-10'),       // se fue en noviembre: cobra noviembre
    P(4, 'POLO TENA, DAVID', '002627', true, 'propia', '2026-08-28'),                     // la gestoría le da otro legajo
    P(5, 'CERRO PINILLA, AGUSTIN', '002074', true, 'propia', '2025-11-06'),               // no sale en el listado
    P(6, 'DANEL, ALEXANDRA', null, true, 'ett', '2026-10-01'),                            // para nosotros es de ETT
    P(7, 'SIN LEGAJO, ROSA', null, true, 'propia', '2026-10-14'),
    P(8, 'PRADO, RODRIGO FABRIZIO', null, true, 'propia', '2026-10-01'),                  // sin legajo, pero sale en el listado
    P(9, 'ENTRA LUEGO, PEPE', null, true, 'propia', '2026-12-01'),                        // entra después del listado
    P(10, 'OTRA PERSONA, JUAN', '000500', true, 'propia', '2026-01-01'),
  ];
  const trabajadores = [
    { fila: 9, legajo: '000057', nombre: 'PRUEBA UNO, ANA' },
    { fila: 10, legajo: '002614', nombre: 'PRUEBA DOS, LUIS' },
    { fila: 11, legajo: '000300', nombre: 'MEDIO MES, EVA' },
    { fila: 12, legajo: '002646', nombre: 'POLO TENA, DAVID' },
    { fila: 13, legajo: '002700', nombre: 'DANEL, ALEXANDRA CRISTINA' },
    { fila: 14, legajo: '002622', nombre: 'PRADO APAICO, RODRIGO FABRIZIO' },
    { fila: 15, legajo: '000500', nombre: 'GARCIA LOPEZ, MARIA' },
  ];
  const d = listado.cruzar({ trabajadores, personas, fecha: '2026-11-23', tipo: 'proforma' });
  const por = (t, campo = 'conductorId') => d.filter(x => x.tipo === t).map(x => x[campo]);
  assert.deepEqual(por('alta_gestoria_baja_nuestra'), ['2'], 'el que se fue en septiembre sí; la de noviembre no');
  assert.equal(d.find(x => x.tipo === 'alta_gestoria_baja_nuestra').detalle.dias, 80);
  assert.deepEqual(d.filter(x => x.tipo === 'legajo_cambiado').map(x => [x.conductorId, x.legajo, x.detalle.legajoErp]), [['4', '002646', '002627']]);
  const desc = d.filter(x => x.tipo === 'legajo_desconocido');
  assert.deepEqual(desc.map(x => [x.legajo, x.detalle.propuesta && x.detalle.propuesta.id, x.detalle.propuesta && x.detalle.propuesta.situacion]),
    [['002700', '6', 'de ETT'], ['002622', '8', 'de alta']]);
  assert.deepEqual(por('nombre_distinto'), ['10']);
  assert.deepEqual(por('alta_nuestra_no_gestoria'), ['5'], 'el del legajo cambiado no sale dos veces');
  assert.deepEqual(por('sin_legajo'), ['7'], 'ni el propuesto ni el que entra después');
  assert.ok(d.every(x => x.clave === `${x.tipo}:${x.conductorId || ''}:${x.legajo || ''}`));
});

test('con la base: subir la proforma, que las diferencias vivan entre cargas, resolverlas, el legajo, el correo y la tarjeta del lunes', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  const quien = { usuarioId: u.id, rol: 'superadmin' };
  const ana = await fabrica.conductor({ nombre: 'ANA', apellidos: 'PRUEBA UNO' });
  const luis = await fabrica.conductor({ nombre: 'LUIS', apellidos: 'PRUEBA DOS', baja: '2026-09-04' });
  const nuevo = await fabrica.conductor({ nombre: 'ÑOÑO', apellidos: 'NUEVO TRES', alta: '2026-11-01' });
  const fuera = await fabrica.conductor({ nombre: 'JUAN', apellidos: 'NO ESTA', alta: '2026-01-01' });
  await consulta(`UPDATE conductor SET legajo = '000057' WHERE id = $1`, [ana.id]);
  await consulta(`UPDATE conductor SET legajo = '002614' WHERE id = $1`, [luis.id]);
  await consulta(`UPDATE conductor SET legajo = '000999' WHERE id = $1`, [fuera.id]);

  // La tarjeta del lunes de esta semana: nace (sin titular de la función, por asignar).
  const lunes = calendario.sumarDias(calendario.hoy(), 1 - calendario.diaSemana(calendario.hoy()));
  const db = require('../services/db');
  const t = await db.transaccion(cli => gestoria.tarjetaDelLunes({ periodo: lunes, cli }));
  assert.ok(t.tarjeta);

  const b1 = muestra('proforma.xls').toString('base64');
  const previa = await gestoria.subir({ base64: b1, nombre: 'nom_nov2026.xls' }, quien);
  assert.equal(previa.previa, true);
  assert.deepEqual(previa.resumen.porTipo, { alta_gestoria_baja_nuestra: 1, legajo_desconocido: 1, alta_nuestra_no_gestoria: 1 });
  assert.equal((await consulta('SELECT count(*)::int n FROM gestoria_discrepancia')).rows[0].n, 0, 'la previa no apunta nada');

  const r1 = await gestoria.subir({ base64: b1, nombre: 'nom_nov2026.xls', confirmar: true }, quien);
  assert.deepEqual([r1.nuevas, r1.siguen, r1.resueltas], [3, 0, 0]);
  const tarjeta = (await consulta(`SELECT estado FROM tarea WHERE id = $1`, [t.tarjeta])).rows[0];
  assert.equal(tarjeta.estado, 'cerrada', 'subir el listado cierra la tarjeta de la semana');
  await assert.rejects(gestoria.subir({ base64: b1, nombre: 'otra.xls', confirmar: true }, quien), /ya se cargó/);

  // Lo que se le manda a la gestoría.
  const c = await gestoria.correo(quien);
  assert.match(c.cuerpo, /002614 PRUEBA DOS, LUIS: baja el 04\/09\/2026/);
  assert.match(c.cuerpo, /000999 NO ESTA, JUAN.*alta el 01\/01\/2026/);
  assert.equal(c.ids.length, 2);
  assert.equal((await gestoria.marcarEnviadas({ ids: c.ids }, quien)).marcadas, 2);

  // El legajo de la gestoría a la ficha propuesta.
  const { filas } = await gestoria.lista(quien);
  const desc = filas.find(f => f.tipo === 'legajo_desconocido');
  assert.equal(desc.detalle.propuesta.id, String(nuevo.id));
  await gestoria.ponerLegajo(desc.id, { conductorId: nuevo.id }, quien);
  assert.equal((await consulta('SELECT legajo FROM conductor WHERE id = $1', [nuevo.id])).rows[0].legajo, '002700');

  // Otra carga (la misma proforma, cifrada: otros bytes): la de la baja sigue; la que ya no sale, resuelta sola.
  await gestoria.cerrar(filas.find(f => f.tipo === 'alta_nuestra_no_gestoria').id, { estado: 'descartada', nota: 'Está de excedencia' }, quien);
  await assert.rejects(gestoria.cerrar(filas.find(f => f.tipo === 'alta_gestoria_baja_nuestra').id, { estado: 'descartada', nota: '' }, quien), /di por qué/);
  const r2 = await gestoria.subir({ base64: muestra('proforma-cifrada.xls').toString('base64'), nombre: 'nom_nov2026_v2.xls', confirmar: true }, quien);
  assert.deepEqual([r2.nuevas, r2.siguen, r2.ignoradas], [0, 1, 1], 'la baja sigue; la descartada no vuelve');
  const vivas = (await consulta(`SELECT tipo, estado FROM gestoria_discrepancia ORDER BY id`)).rows;
  assert.deepEqual(vivas.map(v => `${v.tipo}:${v.estado}`), [
    'alta_gestoria_baja_nuestra:pendiente', 'legajo_desconocido:resuelta', 'alta_nuestra_no_gestoria:descartada']);

  // Tráfico no sube nada.
  await assert.rejects(gestoria.subir({ base64: b1 }, { usuarioId: u.id, rol: 'trafico' }), /permiso/);
}));
