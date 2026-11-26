// ============================================================
// LA CAUSA DE LA BAJA Y LA CARTA DE BAJA VOLUNTARIA (db/297, 26/11/2026)
// ============================================================
// Camilo: una lista de causas al dar la baja; en la voluntaria, el día en que
// la comunicó (la fecha de su carta; el preaviso, los días hasta su último);
// la carta entra sola en Firmas, solo plantilla propia, también programada.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const plantilla = require('../modules/Conductores/plantilla.service');
const firmas = require('../modules/RRHH/firmas.service');
const calendario = require('../services/calendario');
// El finiquito nace en segundo plano al dar la baja y se cruzaría con la
// transacción del test: aquí no se mira (tiene su propio test).
require('../modules/RRHH/finiquitos.service').alDarLaBaja = async () => null;

test('baja voluntaria: la causa se guarda, la carta entra en Firmas con sus huecos y se va si se cancela la baja', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/firmas'), ($1, '/firmas/aprobar')`, [diana.id]);
  const D = { usuarioId: diana.id, rol: 'oficina' };
  const hoy = calendario.hoy();
  let n = 0;
  const conDatos = async nombre => {
    const c = await fabrica.conductor({ nombre });
    await consulta(`UPDATE conductor SET email = $2, dni_nie = $3 WHERE id = $1`, [c.id, `${nombre.toLowerCase()}@ejemplo.test`, `0000000${++n}T`]);
    return c;
  };
  const cartaDe = async id => (await consulta(`SELECT id::text AS id, tipo, origen, estado, detalle FROM firma_envio WHERE conductor_id = $1`, [id])).rows;

  // Lo que se pide: el día en que la comunicó, no después de hoy ni de su último día.
  const a = await conDatos('AHORA');
  await assert.rejects(plantilla.darDeBaja(a.id, { fecha: hoy, causa: 'voluntaria' }, D), /qué día comunicó/);
  await assert.rejects(plantilla.darDeBaja(a.id, { fecha: hoy, causa: 'voluntaria', comunicada: calendario.sumarDias(hoy, 1) }, D), /posterior a hoy/);
  await assert.rejects(plantilla.darDeBaja(a.id, { fecha: hoy, causa: 'inventada' }, D), /no existe/);

  // Inmediata: la comunicó hace 10 días; se va hoy.
  const r = await plantilla.darDeBaja(a.id, { fecha: hoy, causa: 'voluntaria', comunicada: calendario.sumarDias(hoy, -10) }, D);
  assert.ok(r.dado);
  const p = (await consulta(`SELECT causa_baja, to_char(baja_comunicada, 'YYYY-MM-DD') AS com, motivo_baja FROM conductor_periodo_empleo WHERE conductor_id = $1`, [a.id])).rows[0];
  assert.deepEqual([p.causa_baja, p.com, p.motivo_baja], ['voluntaria', calendario.sumarDias(hoy, -10), 'Baja voluntaria'], 'sin motivo escrito, la causa hace de motivo');
  const [c1] = await cartaDe(a.id);
  assert.deepEqual([c1.tipo, c1.origen, c1.estado, c1.detalle.preaviso, c1.detalle.dni], ['baja_voluntaria', 'baja', 'borrador', '10', '00000001T']);
  assert.match(c1.detalle.ultimoDia, /de \d{4}\.$/);
  // Sale con la plantilla, sin PDF ni móvil: Diana la aprueba con el email y el DNI de la ficha.
  await firmas.aprobar(c1.id, {}, D);
  const pend = (await firmas.delBot.pendientes()).find(x => x.id === c1.id);
  assert.deepEqual(firmas.comoSe(pend).plantillaId, '7b79d63e-c1a8-4794-8de0-2bf85539c3d2');

  // Programada: la comunicó hoy y su último día es dentro de 15. Si se cancela la baja, la carta se descarta.
  const b = await conDatos('LUEGO');
  const r2 = await plantilla.darDeBaja(b.id, { fecha: calendario.sumarDias(hoy, 15), causa: 'voluntaria', comunicada: hoy }, D);
  assert.equal(r2.programada, calendario.sumarDias(hoy, 15));
  assert.equal((await cartaDe(b.id))[0].detalle.preaviso, '15');
  await plantilla.cancelarBaja(b.id, { motivo: 'Se lo ha pensado' }, D);
  assert.equal((await cartaDe(b.id))[0].estado, 'descartado');

  // ETT u otra causa: sin carta.
  const e = await fabrica.conductor({ nombre: 'ETT', tipo: 'ett' });
  await plantilla.darDeBaja(e.id, { fecha: hoy, causa: 'voluntaria', comunicada: hoy }, D);
  assert.equal((await cartaDe(e.id)).length, 0, 'la ETT no: su empresa es la ETT');
  const o = await conDatos('OTRA');
  await plantilla.darDeBaja(o.id, { fecha: hoy, causa: 'prueba' }, D);
  assert.equal((await cartaDe(o.id)).length, 0);
  assert.equal((await consulta(`SELECT causa_baja FROM conductor_periodo_empleo WHERE conductor_id = $1`, [o.id])).rows[0].causa_baja, 'prueba');
}));
