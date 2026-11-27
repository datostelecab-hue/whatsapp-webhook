// ============================================================
// LAS TAREAS AL IRSE ALGUIEN (ítem 8) Y LOS PENDIENTES DEL DÍA 20 (ítem 7), 27/11/2026
// ============================================================
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const calendario = require('../services/calendario');
const salidas = require('../modules/RRHH/salidas.service');
const pendientes = require('../modules/RRHH/pendientesNomina.service');

const tarjetas = async (consulta, tipo) => (await consulta(
  `SELECT origen_id, estado, titulo FROM tarea WHERE tipo = $1 ORDER BY id`, [tipo])).rows;

test('al irse alguien: BOLT, lo que tenía y la gestoría; BOLT se cierra sola al desactivarla', () => conBase(async ({ consulta, fabrica }) => {
  const hoy = calendario.hoy();
  const propio = await fabrica.conductor({ nombre: 'SEVA', apellidos: 'PROPIO', alta: '2026-01-01', baja: hoy });
  const ett = await fabrica.conductor({ nombre: 'SEVA', apellidos: 'ETT', alta: '2026-01-01', baja: hoy, tipo: 'ett' });
  const antes = await fabrica.conductor({ nombre: 'YA', apellidos: 'SEFUE', alta: '2026-01-01', baja: '2026-10-01' });
  const sigue = await fabrica.conductor({ nombre: 'SIGUE', apellidos: 'DEALTA', alta: '2026-01-01' });
  await consulta(`UPDATE conductor_periodo_empleo SET causa_baja = 'voluntaria' WHERE conductor_id = $1`, [propio.id]);
  await consulta(`INSERT INTO conductor_externo (conductor_id, sistema, externo_id, estado_externo, enlazado_at) VALUES ($1, 'bolt', 'cuenta-seva', 'active', now())`, [propio.id]);

  const r = await salidas.revisar();
  assert.equal(r.salidas, 2, 'las dos de hoy; ni la de octubre ni quien sigue de alta');
  const o = id => `${id}|${hoy}`;
  assert.deepEqual((await tarjetas(consulta, 'salida_bolt')).map(t => t.origen_id), [o(propio.id)], 'BOLT solo a quien tiene una cuenta activa');
  assert.deepEqual((await tarjetas(consulta, 'salida_material')).map(t => t.origen_id).sort(), [o(propio.id), o(ett.id)].sort());
  assert.deepEqual((await tarjetas(consulta, 'salida_gestoria')).map(t => t.origen_id), [o(propio.id)], 'la gestoría, solo la plantilla propia');
  assert.equal((await tarjetas(consulta, 'salida_coche')).length, 0, 'sin coche ni turnos, no nace');
  assert.match((await tarjetas(consulta, 'salida_bolt'))[0].titulo, /PROPIO, SEVA.*baja voluntaria/);
  assert.ok(![antes.id, sigue.id].some(id => JSON.stringify(r).includes(String(id))));

  // Otra vuelta no repite; al desactivarla en BOLT, la tarjeta se cierra sola.
  await salidas.revisar();
  assert.equal((await tarjetas(consulta, 'salida_material')).length, 2);
  await consulta(`UPDATE conductor_externo SET estado_externo = 'deactivated' WHERE externo_id = 'cuenta-seva'`);
  const r2 = await salidas.revisar();
  assert.equal(r2.cerradas, 1);
  assert.equal((await tarjetas(consulta, 'salida_bolt'))[0].estado, 'cerrada');
  assert.equal(salidas.funcionBolt({ tipo: 'propia', causa: 'despido_disciplinario' }), 'desactiva_suspension_despido');
  assert.equal(salidas.funcionBolt({ tipo: 'ett', causa: 'voluntaria' }), 'desactiva_fin_ett');
}));

test('el día 20: una tarjeta por tipo con su número, el aviso y cada mañana se cierran las que llegan a cero', () => conBase(async ({ consulta, fabrica }) => {
  const horasReal = pendientes.TIPOS.horas.contar;
  pendientes.TIPOS.horas.contar = async () => 2;   // el cálculo de nóminas tiene sus propias pruebas
  try {
    const nomina = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
    await consulta(`INSERT INTO usuario_funcion (usuario_id, funcion) VALUES ($1, 'nomina')`, [nomina.id]).catch(() => null);
    const a = await fabrica.conductor({ nombre: 'AUS', apellidos: 'UNO' });
    const b = await fabrica.conductor({ nombre: 'BAJ', apellidos: 'DOS' });
    // Dos ausencias sin validar en el periodo (del 26/11 al 25/12) y una fuera.
    for (const dia of ['2026-11-27', '2026-12-10', '2026-11-20']) {
      await consulta(`INSERT INTO ausencia_rrhh (conductor_id, dia, estado, detectada_el) VALUES ($1, $2, 'pendiente', $2)`, [a.id, dia]);
    }
    // Una baja abierta con el fin previsto pasado.
    await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta_previsto) VALUES ($1, 'baja_medica', '2026-12-01', '2026-12-10')`, [b.id]);

    const v = await pendientes.ventanaDe('2026-12');
    assert.deepEqual([v.desde, v.hasta], ['2026-11-26', '2026-12-25']);
    const r = await pendientes.generar({ periodo: '2026-12', hoy: '2026-12-18' });
    assert.deepEqual([r.ausencias, r.horas, r.bajas], [2, 2, 1]);
    const t = await tarjetas(consulta, pendientes.TARJETA);
    assert.deepEqual(t.map(x => x.origen_id), ['2026-12|ausencias', '2026-12|bajas', '2026-12|horas']);
    assert.match(t[0].titulo, /diciembre: 2 ausencias sin validar/);
    // Repetirlo no duplica.
    await pendientes.generar({ periodo: '2026-12', hoy: '2026-12-18' });
    assert.equal((await tarjetas(consulta, pendientes.TARJETA)).length, 3);

    // Se valida una: cambia el número; se validan todas y se cierra la baja: se cierran.
    await consulta(`UPDATE ausencia_rrhh SET estado = 'injustificada', resuelta_at = now() WHERE dia = '2026-11-27'`);
    await pendientes.seguir({ hoy: '2026-12-19' });
    assert.match((await tarjetas(consulta, pendientes.TARJETA))[0].titulo, /1 ausencia sin validar/);
    await consulta(`UPDATE ausencia_rrhh SET estado = 'justificada', resuelta_at = now() WHERE dia = '2026-12-10'`);
    await consulta(`UPDATE conductor_estado_hist SET hasta = '2026-12-15' WHERE conductor_id = $1`, [b.id]);
    const s = await pendientes.seguir({ hoy: '2026-12-20' });
    assert.equal(s.cerradas, 2);
    const fin = await tarjetas(consulta, pendientes.TARJETA);
    assert.deepEqual(fin.map(x => x.estado), ['cerrada', 'cerrada', fin[2].estado], 'la de horas no se cierra sola');
    assert.notEqual(fin[2].estado, 'cerrada');
  } finally {
    pendientes.TIPOS.horas.contar = horasReal;
  }
}));
