// ============================================================
// EL EXPEDIENTE DE RR. HH. DE UNA PERSONA (26/11/2026)
// ============================================================
// Reúne lo de cada módulo; cada sección solo si quien mira tiene la llave de
// su módulo. Con solo la de Plantilla, nada de salud ni de dinero.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const expediente = require('../modules/Conductores/expediente.service');

test('cada sección con su llave; lo que no puede ver no llega', () => conBase(async ({ consulta, fabrica }) => {
  const usuario = async (nombre, claves) => {
    const u = await fabrica.usuario({ rol: 'oficina', nombre });
    for (const c of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
    return { usuarioId: u.id, rol: 'oficina' };
  };
  const c = await fabrica.conductor({ nombre: 'EXPEDIENTE' });
  await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta_previsto) VALUES ($1, 'baja_medica', CURRENT_DATE - 3, CURRENT_DATE + 7)`, [c.id]);

  const soloPlantilla = await usuario('Trafico', ['/plantilla']);
  const r1 = await expediente.deUno(c.id, soloPlantilla);
  assert.deepEqual([r1.secciones.length, r1.ocultas], [0, expediente.SECCIONES.length]);

  const rrhh = await usuario('RRHH', ['/plantilla', '/ausencias', '/disciplina', '/descuentos']);
  const r2 = await expediente.deUno(c.id, rrhh);
  assert.deepEqual(r2.secciones.map(s => s.id).sort(), ['ausencias', 'descuentos', 'permisos', 'sanciones']);
  const aus = r2.secciones.find(s => s.id === 'ausencias');
  assert.ok(!aus.error, aus.error);
  assert.equal(aus.datos.bajas.length, 1, 'su baja abierta, con la llave de ausencias');
  assert.ok(r2.secciones.every(s => !s.error), JSON.stringify(r2.secciones.filter(s => s.error)));

  const todo = await expediente.deUno(c.id, { usuarioId: (await fabrica.usuario({ rol: 'superadmin', nombre: 'Jefe' })).id, rol: 'superadmin' });
  assert.equal(todo.secciones.length, expediente.SECCIONES.length);
}));
