// ============================================================
// LOS DESCUENTOS EN NÓMINA (módulo 4.2, db/298, 26/11/2026)
// ============================================================
// Ninguno entra sin aprobar; el combustible, con el visto bueno de Legal; se
// aplaza a mano (todo o una parte); al cerrar el mes se descuenta y el efectivo
// queda saldado en Recaudación; los km llegan solos del Banco de KM.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const descuentos = require('../modules/RRHH/descuentos.service');

test('el mes de nómina va del 26 al 25', async () => {
  assert.equal(await descuentos.periodoDe('2026-11-25'), '2026-11');
  assert.equal(await descuentos.periodoDe('2026-11-26'), '2026-12');
  assert.equal(await descuentos.periodoDe('2026-12-28'), '2027-01');
});

test('proponer, aprobar, aplazar una parte y cerrar el mes: el efectivo, saldado en Recaudación', () => conBase(async ({ consulta, fabrica }) => {
  const usuario = async (nombre, claves) => {
    const u = await fabrica.usuario({ rol: 'oficina', nombre });
    for (const c of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
    return { usuarioId: u.id, rol: 'oficina' };
  };
  const D = await usuario('Diana', ['/descuentos', '/descuentos/proponer']);
  const J = await usuario('Jefe', ['/descuentos', '/descuentos/aprobar']);
  const R = await usuario('Caja', ['/recaudacion/nomina']);
  const otro = await usuario('Nadie', []);
  const c = await fabrica.conductor({ nombre: 'DESCUENTO' });

  await assert.rejects(descuentos.crear({ conductorId: c.id, origen: 'siniestro', importe: '100', motivo: 'Golpe' }, otro), /proponer/);
  await assert.rejects(descuentos.crear({ conductorId: c.id, origen: 'km', importe: '5', motivo: 'xxx' }, D), /de dónde/, 'los km no se apuntan a mano');
  const sin = await descuentos.crear({ conductorId: c.id, origen: 'siniestro', importe: '150,50', fecha: '2026-11-20', motivo: 'Retrovisor roto en la entrega' }, D);
  assert.equal(sin.estado, 'pendiente', 'quien propone no aprueba');
  await assert.rejects(descuentos.aprobar(sin.id, {}, D), /aprobar/);
  await descuentos.aprobar(sin.id, {}, J);

  // El combustible: sin el visto bueno de Legal no se aprueba.
  const comb = await descuentos.crear({ conductorId: c.id, origen: 'combustible', importe: '60', fecha: '2026-11-20', motivo: 'Repostajes sin cuadrar' }, D);
  await assert.rejects(descuentos.aprobar(comb.id, {}, J), /Legal/);
  await descuentos.aprobar(comb.id, { vistoLegal: 'Legal, 24/11/2026' }, J);

  // El efectivo lo propone quien apunta la nómina en Recaudación; queda por aprobar.
  const efe = await descuentos.crear({ conductorId: c.id, origen: 'efectivo', importe: '30', fecha: '2026-11-20', motivo: 'Efectivo sin entregar' }, R);
  assert.equal(efe.estado, 'pendiente');
  await descuentos.aprobar(efe.id, {}, J);
  // Este mes, solo 10 €; el resto se aplaza al cerrar.
  await assert.rejects(descuentos.aplazar(efe.id, { importe: '30' }, J), /menos de/);
  await descuentos.aplazar(efe.id, { importe: '10' }, J);

  const r = await descuentos.cerrarMes({ periodo: '2026-11' }, J);
  assert.deepEqual([r.descontados, r.aplazados, r.total], [3, 1, 220.5]);
  const f = await descuentos.ficha(efe.id, J);
  assert.deepEqual([f.estado, f.saldo, f.periodo, f.descontado], ['aplazado', 20, '2026-12', 10]);
  const mov = (await consulta(`SELECT tipo, importe::float AS importe FROM recaudacion_movimiento WHERE conductor_id = $1 AND anulado_at IS NULL`, [c.id])).rows;
  assert.deepEqual(mov, [{ tipo: 'nomina', importe: 10 }], 'el efectivo descontado, saldado en Recaudación');
  assert.equal((await descuentos.ficha(sin.id, J)).estado, 'aplicado');
  await assert.rejects(descuentos.anular(efe.id, { motivo: 'no' + 'xx' }, J), /descontado una parte/);
  const x = await descuentos.excelDelMes('2026-11', J);
  assert.ok(x.buffer.length > 1000);
}));

test('los km: el exceso de la semana del Banco de KM, a su precio, una vez por persona y semana', () => conBase(async ({ fabrica }) => {
  const c = await fabrica.conductor({ nombre: 'KM' });
  const e = await fabrica.conductor({ nombre: 'KMETT', tipo: 'ett' });
  const banco = require('../modules/Operaciones/bancoKm.service');
  const original = banco.semana;
  banco.semana = async lunes => ({
    lunes, domingo: '2026-11-29', faltan: [], dias: Array.from({ length: 7 }, () => ({ cerrada: true })),
    conductores: [
      { conductorId: c.id, km: 132.4, kmFuera: 140.4, justificados: 8, pendientes: 0, limite: 100, horasViaje: 11.4, matriculas: [] },
      { conductorId: e.id, km: 300, kmFuera: 300, justificados: 0, pendientes: 0, limite: 100, horasViaje: 10, matriculas: [] },
    ],
  });
  try {
    const r = await descuentos.kmDeLaSemana('2026-11-23');
    assert.equal(r.nuevos, 1, 'solo plantilla propia');
    assert.equal((await descuentos.kmDeLaSemana('2026-11-23')).nuevos, 0, 'no se repite');
    const J = { usuarioId: (await fabrica.usuario({ rol: 'superadmin', nombre: 'J' })).id, rol: 'superadmin' };
    const l = (await descuentos.lista(J)).filas.find(x => x.origen === 'km');
    assert.deepEqual([l.importe, l.estado, l.concepto, l.periodo], [32.4, 'pendiente', '758', '2026-12']);
  } finally { banco.semana = original; }
}));
