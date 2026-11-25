// ============================================================
// LAS AUSENCIAS QUE VALIDA RR. HH. (módulo 1, db/289, 25/11/2026)
// ============================================================
// «Ninguna ausencia se descuenta como absentismo sin validación. Tarea diaria
// para Diana: revisar las ausencias nuevas y confirmar que no son una baja
// médica. Si una ausencia cae dentro de una baja cargada, se reclasifica sola
// como "Baja médica (IT)" y sale del absentismo. Es retroactivo».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ausencias = require('../modules/RRHH/ausencias.service');
const bitacora = require('../modules/Operaciones/bitacora.service');
const plantilla = require('../modules/Conductores/plantilla.service');

test('el periodo de nómina va del 26 al 25', () => {
  assert.deepEqual(ausencias.periodoDe('2026-10-26'), { desde: '2026-10-26', hasta: '2026-11-25', mes: '2026-11' });
  assert.deepEqual(ausencias.periodoDe('2026-11-25'), { desde: '2026-10-26', hasta: '2026-11-25', mes: '2026-11' });
  assert.deepEqual(ausencias.periodoDe('2026-11-26'), { desde: '2026-11-26', hasta: '2026-12-25', mes: '2026-12' });
  assert.deepEqual(ausencias.periodoDe('2027-01-03'), { desde: '2026-12-26', hasta: '2027-01-25', mes: '2027-01' });
});

test('la regla de la «Ausencia» de la bitácora, una sola vez', () => {
  const c = { altaIdx: 0, bajaIdx: null, huecos: [], situaciones: [[5, 5]], sinPlaza: [[6, 6]],
    dias: [7.5, 'J', null, 'L', 0, null, null, 'B'] };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(i => bitacora.claseDelDia(c, i)),
    ['trabajado', 'trabajado', 'ausencia', null, 'ausencia', null, null, null]);
  assert.equal(bitacora.claseDelDia({ ...c, altaIdx: 3 }, 2), null, 'antes del alta no es ausencia');
});

test('detectar, decidir y reclasificar sola (también lo ya decidido)', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/ausencias'), ($1, '/ausencias/validar'), ($1, '/permisos/aprobar')`, [diana.id]);
  const yo = { usuarioId: diana.id, rol: 'oficina' };
  const p = await fabrica.conductor({ nombre: 'PROPIA' });
  const e = await fabrica.conductor({ nombre: 'DE ETT', tipo: 'ett' });
  const id = String(p.id);
  const fila = async dia => (await consulta(
    `SELECT id::text AS id, estado, automatica, situacion_id FROM ausencia_rrhh WHERE conductor_id = $1 AND dia = $2`, [p.id, dia])).rows[0];
  const tarjeta = async origen => (await consulta(
    `SELECT estado FROM tarea WHERE tipo = 'ausencias_revisar' AND origen_id = $1`, [origen])).rows[0];

  // 1. Entran las de plantilla propia desde el 26/10; la de la ETT y la de antes, no.
  const r = await ausencias.detectar({ hoy: '2026-11-20', candidatos: [
    { conductorId: id, dia: '2026-11-02' }, { conductorId: id, dia: '2026-11-03' },
    { conductorId: String(e.id), dia: '2026-11-02' }, { conductorId: id, dia: '2026-10-20' }] });
  assert.equal(r.nuevas, 2);
  assert.equal((await fila('2026-11-02')).estado, 'pendiente');
  assert.equal(await fila('2026-10-20'), undefined, 'antes del 26/10 no se toca');
  assert.equal((await tarjeta('2026-11-20')).estado !== 'cerrada', true, 'nace la tarjeta del día');

  // 2. Sin la llave no se decide; con ella, injustificada (absentismo).
  const otro = await fabrica.usuario({ rol: 'oficina', nombre: 'Otro' });
  await assert.rejects(ausencias.decidir({ ids: [(await fila('2026-11-02')).id], estado: 'injustificada' }, { usuarioId: otro.id, rol: 'oficina' }), /permiso/);
  await ausencias.decidir({ ids: [(await fila('2026-11-02')).id], estado: 'injustificada' }, yo);
  assert.equal((await fila('2026-11-02')).estado, 'injustificada');
  await assert.rejects(ausencias.decidir({ ids: [(await fila('2026-11-03')).id], estado: 'justificada', nota: '' }, yo), /por qué/);

  // 3. Llega una baja médica del 02 al 04: las dos se reclasifican solas, también la injustificada.
  await plantilla.anadirAusencia(p.id, { estado: 'baja_medica', desde: '2026-11-02', hasta: '2026-11-04', motivo: 'Parte' }, yo);
  const r2 = await ausencias.detectar({ hoy: '2026-11-21', candidatos: [] });
  assert.equal(r2.reclasificadas, 2);
  const f2 = await fila('2026-11-02');
  assert.deepEqual([f2.estado, f2.automatica, !!f2.situacion_id], ['baja_medica', true, true]);
  assert.equal((await tarjeta('2026-11-20')).estado, 'cerrada', 'sin nada por revisar, la tarjeta se cierra sola');
  const libro = (await consulta(`SELECT count(*)::int AS n FROM auditoria WHERE tabla = 'ausencia_rrhh' AND registro = $1`, [f2.id])).rows[0].n;
  assert.ok(libro >= 2, 'cada cambio, al libro');

  // 4. La que deja de ser ausencia (le ponen una J) se cierra sola; si vuelve a serlo, vuelve a pendiente.
  await ausencias.detectar({ hoy: '2026-11-21', candidatos: [{ conductorId: id, dia: '2026-11-10' }] });
  assert.equal((await fila('2026-11-10')).estado, 'pendiente');
  await ausencias.detectar({ hoy: '2026-11-22', candidatos: [] });
  assert.equal((await fila('2026-11-10')).estado, 'ya_no_es');
  await ausencias.detectar({ hoy: '2026-11-23', candidatos: [{ conductorId: id, dia: '2026-11-10' }] });
  assert.equal((await fila('2026-11-10')).estado, 'pendiente');

  // 5. Diana abre un permiso desde la ausencia: se abre la situación y se resuelve con ella.
  await assert.rejects(ausencias.decidir({ ids: [(await fila('2026-11-10')).id], estado: 'permiso' }, yo), /qué permiso/);
  const tipo = (await consulta(`SELECT leave_type_code FROM leave_type WHERE leave_type_code <> 'PR_ASUNTOS_PROPIOS' LIMIT 1`)).rows[0].leave_type_code;
  const d = await ausencias.decidir({ ids: [(await fila('2026-11-10')).id], estado: 'permiso', tipoPermiso: tipo, desde: '2026-11-10', hasta: '2026-11-10' }, yo);
  assert.equal(d.decididas, 1);
  const f5 = await fila('2026-11-10');
  assert.deepEqual([f5.estado, f5.automatica, String(f5.situacion_id)], ['permiso', false, d.situacionId]);
  const sit = (await consulta(`SELECT estado, leave_type_code FROM conductor_estado_hist WHERE id = $1`, [d.situacionId])).rows[0];
  assert.deepEqual([sit.estado, sit.leave_type_code], ['permiso', tipo]);

  // 6. La lista y el % de plantilla de baja.
  const l = await ausencias.lista(yo);
  assert.ok(l.filas.some(x => x.conductor_id === id && x.periodo === '2026-11'));
  const h = await ausencias.historicoBaja(yo);
  assert.ok(h.meses.length >= 1 && h.hoy && h.hoy.alta >= 1);
}));
