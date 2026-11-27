// ============================================================
// EL FICHERO FIE DE LA GESTORÍA (db/312, 27/11/2026)
// ============================================================
// Lo legal: el FIE corrige las bajas del ERP. Datos de mentira.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const fie = require('../modules/RRHH/fie');
const srv = require('../modules/RRHH/fie.service');

const P = (fecha_baja, fecha_fin = null, extra = {}) => ({ id: fecha_baja, fecha_baja, fecha_fin, revision: null, baja_anulada: false, alta_anulada: false, ...extra });
const B = (id, desde, hasta = null, prevista = null) => ({ id, desde, hasta, prevista });
const tipos = plan => plan.map(x => x.acciones.map(a => a.tipo + (a.a !== undefined ? `:${a.a}` : '')).join(','));

test('el plan: abrir, rectificar el primer día, el alta, reabrir, la revisión y el parte anulado', () => {
  assert.deepEqual(tipos(srv.planear([P('2026-11-05', '2026-11-25')], [])), ['crear'], 'no la tiene: se abre');
  assert.deepEqual(srv.planear([P('2026-11-05', '2026-11-25')], [])[0].acciones[0], { tipo: 'crear', desde: '2026-11-05', hasta: '2026-11-25', prevista: null, contingencia: undefined });
  assert.deepEqual(tipos(srv.planear([P('2026-11-05', '2026-11-25')], [B('1', '2026-11-06')])), ['desde:2026-11-05,hasta:2026-11-25']);
  // El ERP empieza antes que el FIE: se corta, no se borra (lo de antes, a revisar), y se abre la del FIE.
  assert.deepEqual(tipos(srv.planear([P('2026-10-22', '2026-11-25')], [B('1', '2026-09-10', '2026-11-26')])), ['recortar:2026-10-21,crear']);
  // Una baja partida en tramos (uno por parte) y una recaída: se juntan, y el que sigue pasa a la siguiente.
  const partida = [B('c', '2026-10-15', '2026-10-30'), B('d', '2026-10-31', '2026-11-12'), B('e', '2026-11-13', '2026-12-03')];
  assert.deepEqual(tipos(srv.planear([P('2026-10-15', '2026-11-13'), P('2026-11-14', null, { revision: '2026-12-04' })], partida)),
    ['quitar,desplazar:2026-11-14,hasta:2026-11-13', 'hasta:null,prevista:2026-12-04']);
  assert.deepEqual(tipos(srv.planear([P('2026-11-05')], [B('1', '2026-11-05', '2026-11-20')])), ['hasta:null'], 'el FIE no tiene el alta: se reabre');
  assert.deepEqual(tipos(srv.planear([P('2026-11-05', '2026-11-25', { alta_anulada: true })], [B('1', '2026-11-05', '2026-11-25')])), ['hasta:null']);
  assert.deepEqual(tipos(srv.planear([P('2026-11-05', null, { revision: '2026-12-04' })], [B('1', '2026-11-05')])), ['prevista:2026-12-04']);
  assert.deepEqual(tipos(srv.planear([P('2026-11-05', null, { baja_anulada: true })], [B('1', '2026-11-05')])), ['anular']);
  assert.deepEqual(tipos(srv.planear([P('2026-11-05', '2026-11-25')], [B('1', '2026-11-05', '2026-11-25')])), [''], 'ya cuadra');
  // Una recaída: el ERP tiene una sola baja abierta; el FIE, dos procesos.
  assert.deepEqual(tipos(srv.planear([P('2026-11-14'), P('2026-10-15', '2026-11-13')], [B('1', '2026-10-15')])),
    ['hasta:2026-11-13', 'crear'], 'la primera se cierra y la recaída se abre aparte');
  assert.match(srv.texto({ tipo: 'hasta', a: '2026-11-25', de: null }), /Alta el 25\/11\/2026: vuelve el 26\/11\/2026/);
});

test('el FIE leído: el documento sin su primer dígito, las fechas y lo anulado', () => {
  assert.equal(fie.dniDe('051922270T'), '51922270T');
  assert.equal(fie.dniDe('0Y2058088Q'), 'Y2058088Q');
  assert.equal(fie.dniNorm('7481208K'), fie.dniNorm('07481208K'), 'un DNI con o sin el cero de delante es el mismo');
  assert.equal(fie.fecha('20261125'), '2026-11-25');
  assert.equal(fie.fecha(''), null);
  assert.equal(srv.fechaDelFichero('FICHERO FIE TIBUS LUXURY 27-11-2026.xlsx', []), '2026-11-27');
});

/** Un FIE de mentira con la forma del de verdad (dos filas de cabecera). */
async function fieDeMentira(filas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  const cab = ['Fecha Registro', 'C.C.C. Principal', 'Razón Social', 'N.A.F.', 'IPF', 'Primer Apellido', 'Segundo Apellido', 'Nombre',
    'Fecha Inicio Relación Laboral', 'Fecha Extinción Relación Laboral', 'Entidad Responsable', 'Fecha Baja IT', 'Indicador Recaida',
    'Fecha Proceso Inicial', 'Fecha Proceso Anterior', 'Días Acumulados', 'Fecha Proceso IT Inexistente', 'Causa IT Proceso Inexistente',
    'Contingencia', 'Indicador Carencia', 'Tipo Proceso', 'Duración Estimada', 'Fecha Fin Pago Delegado', 'Causa Fin Pago Delegado',
    'Fecha Fin IT', 'Causa Fin IT', 'Parte de Baja Anulado', 'Parte de Alta Anulado', 'Modalidad de pago', 'Procesos con peculiaridades',
    'Indicador de IT internacional', 'Fecha siguiente revisión médica'];
  ws.addRow(cab.map(() => 'DIT (Datos de Incapacidad Temporal)'));
  ws.addRow(cab);
  for (const f of filas) {
    const r = cab.map(() => '');
    r[0] = f.registro; r[4] = f.ipf; r[5] = 'PRUEBA'; r[7] = 'MENTIRA'; r[11] = f.baja; r[18] = '1';
    r[24] = f.fin || ''; r[26] = f.anulada ? 'S' : ''; r[31] = f.revision || '';
    ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('con la base: leer, la previa, aplicar (que enciende el automático) y el FIE siguiente se aplica solo', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  for (const k of ['/ausencias', '/ausencias/validar']) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [diana.id, k]);
  const quien = { usuarioId: diana.id, rol: 'oficina' };
  const c = await fabrica.conductor({ nombre: 'BAJA', apellidos: 'DE PRUEBA', alta: '2026-01-01' });
  await consulta(`UPDATE conductor SET dni_nie = '12345678Z' WHERE id = $1`, [c.id]);
  // En el ERP, la baja empezó un día más tarde y sigue abierta.
  await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde) VALUES ($1, 'baja_medica', '2026-11-06')`, [c.id]);

  const f1 = await fieDeMentira([
    { registro: '20261120', ipf: '012345678Z', baja: '20261105', revision: '20261204' },
    { registro: '20261120', ipf: '099999999R', baja: '20261110' },   // nadie con ese documento
  ]);
  const r1 = await srv.importar({ buffer: f1, nombre: 'FICHERO FIE TIBUS LUXURY 20-11-2026.xlsx' });
  assert.deepEqual([r1.procesos, r1.nuevos], [2, 2]);
  assert.equal((await srv.importar({ buffer: f1, nombre: 'otro nombre.xlsx' })).ya, true, 'el mismo fichero no entra dos veces');

  // La previa: no toca nada.
  const v = await srv.vista(quien);
  assert.equal(v.automatico, false);
  const suya = v.filas.find(f => f.conductor_id === String(c.id));
  assert.deepEqual(suya.acciones, ['Primer día de la baja: del 06/11/2026 al 05/11/2026', 'Próxima revisión: el 04/12/2026']);
  assert.ok(v.filas.find(f => f.sin_ficha));
  assert.equal((await srv.aplicar()).saltado, 'la previa aún no se ha aplicado a mano', 'sola no aplica hasta la primera vez a mano');
  const antes = (await consulta(`SELECT to_char(desde, 'YYYY-MM-DD') d FROM conductor_estado_hist WHERE conductor_id = $1 AND estado = 'baja_medica'`, [c.id])).rows[0].d;
  assert.equal(antes, '2026-11-06');

  // Aplicar a mano: corrige y enciende el automático.
  const a = await srv.aplicar(quien);
  assert.deepEqual([a.aplicados, a.sinFicha, a.errores], [1, 1, 0]);
  const b = (await consulta(`SELECT id, to_char(desde, 'YYYY-MM-DD') d, hasta, to_char(hasta_previsto, 'YYYY-MM-DD') p FROM conductor_estado_hist WHERE conductor_id = $1 AND estado = 'baja_medica'`, [c.id])).rows[0];
  assert.deepEqual([b.d, b.hasta, b.p], ['2026-11-05', null, '2026-12-04']);
  assert.ok((await consulta(`SELECT count(*)::int n FROM baja_parte WHERE conductor_id = $1 AND origen = 'fie'`, [c.id])).rows[0].n >= 2);
  assert.equal((await srv.vista(quien)).automatico, true);

  // El FIE siguiente trae el alta: se aplica solo.
  await srv.importar({ buffer: await fieDeMentira([{ registro: '20261126', ipf: '012345678Z', baja: '20261105', fin: '20261125' }]),
    nombre: 'FICHERO FIE TIBUS LUXURY 26-11-2026.xlsx' });
  const a2 = await srv.aplicar();
  assert.equal(a2.aplicados, 1);
  assert.equal((await consulta(`SELECT to_char(hasta, 'YYYY-MM-DD') h FROM conductor_estado_hist WHERE id = $1`, [b.id])).rows[0].h, '2026-11-25',
    'el alta el día de la Fecha Fin IT: vuelve el siguiente');
  assert.equal((await consulta(`SELECT count(*)::int n FROM baja_parte WHERE situacion_id = $1 AND tipo = 'alta' AND origen = 'fie'`, [b.id])).rows[0].n, 1);

  // Y si el alta se anula, la baja se reabre.
  const wb = await fieDeMentira([{ registro: '20261127', ipf: '012345678Z', baja: '20261105', fin: '20261125' }]);
  const ExcelJS2 = require('exceljs'); const w = new ExcelJS2.Workbook(); await w.xlsx.load(wb);
  w.getWorksheet('Report').getRow(3).getCell(28).value = 'S';   // Parte de Alta Anulado
  await srv.importar({ buffer: Buffer.from(await w.xlsx.writeBuffer()), nombre: 'FICHERO FIE TIBUS LUXURY 27-11-2026.xlsx' });
  assert.equal((await srv.aplicar()).aplicados, 1);
  assert.equal((await consulta(`SELECT hasta FROM conductor_estado_hist WHERE id = $1`, [b.id])).rows[0].hasta, null, 'reabierta');
}));

test('con la base: una baja partida en tramos y una recaída quedan como dice el FIE', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  for (const k of ['/ausencias', '/ausencias/validar']) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [diana.id, k]);
  const c = await fabrica.conductor({ nombre: 'PARTIDA', apellidos: 'PRUEBA', alta: '2026-01-01' });
  await consulta(`UPDATE conductor SET dni_nie = '87654321X' WHERE id = $1`, [c.id]);
  for (const [d, h] of [['2026-09-10', '2026-10-14'], ['2026-10-15', '2026-10-30'], ['2026-10-31', '2026-11-12'], ['2026-11-13', '2026-12-03']]) {
    await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta) VALUES ($1, 'baja_medica', $2, $3)`, [c.id, d, h]);
  }
  await srv.importar({ buffer: await fieDeMentira([
    { registro: '20261126', ipf: '087654321X', baja: '20261015', fin: '20261113' },
    { registro: '20261126', ipf: '087654321X', baja: '20261114', revision: '20261204' },
  ]), nombre: 'FICHERO FIE TIBUS LUXURY 26-11-2026.xlsx' });
  const r = await srv.aplicar({ usuarioId: diana.id, rol: 'oficina' });
  assert.deepEqual([r.aplicados, r.errores], [2, 0]);
  const tramos = (await consulta(`SELECT to_char(desde, 'YYYY-MM-DD') d, to_char(hasta, 'YYYY-MM-DD') h FROM conductor_estado_hist
    WHERE conductor_id = $1 AND estado = 'baja_medica' ORDER BY desde`, [c.id])).rows.map(t => `${t.d}→${t.h || '…'}`);
  assert.deepEqual(tramos, ['2026-09-10→2026-10-14', '2026-10-15→2026-11-13', '2026-11-14→…'],
    'lo de antes se queda; los trozos se juntan; la recaída, abierta');
}));
