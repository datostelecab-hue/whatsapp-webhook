// ============================================================
// UNA BAJA ENCIMA DE UNAS VACACIONES (módulo 2, db/292, 25/11/2026)
// ============================================================
// «Si una baja coincide con vacaciones aprobadas, muestra una alerta con el
// conductor, los días solapados y la baja, para que Diana decida si devuelve
// esos días al saldo». Camilo: la baja manda y Diana decide.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const plantilla = require('../modules/Conductores/plantilla.service');
const repoVac = require('../modules/Vacaciones/vacaciones.repo');
const vacaciones = require('../modules/Vacaciones/vacaciones.service');

test('la baja recorta o parte las vacaciones, apunta los días y RR. HH. decide', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  const otro = await fabrica.usuario({ rol: 'oficina', nombre: 'Otro' });
  await consulta(`DELETE FROM usuario_permiso WHERE clave = '/vacaciones/aprobar'`);
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/vacaciones/aprobar')`, [u.id]);
  const c = await fabrica.conductor({ nombre: 'VACACIONES' });
  await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta, hasta_previsto, libra_dias)
                  VALUES ($1, 'vacaciones', '2026-11-02', '2026-11-15', '2026-11-15', '{6,7}')`, [c.id]);
  const vac = async () => (await consulta(`SELECT to_char(desde, 'MM-DD') || '/' || to_char(hasta, 'MM-DD') AS t, libra_dias
    FROM conductor_estado_hist WHERE conductor_id = $1 AND estado = 'vacaciones' ORDER BY desde`, [c.id])).rows;

  // Una baja en medio (del 05 al 08): las parte en dos, con sus dos días de libranza.
  const r = await plantilla.anadirAusencia(c.id, { estado: 'baja_medica', desde: '2026-11-05', hasta: '2026-11-08', motivo: 'Parte' }, { usuarioId: u.id });
  assert.equal(r.solapes, 1);
  assert.deepEqual((await vac()).map(x => x.t), ['11-02/11-04', '11-09/11-15']);
  assert.deepEqual((await vac())[1].libra_dias.map(Number), [6, 7]);

  // Otra por «Cambiar situación», abierta desde el 12: recorta el trozo de después.
  await plantilla.cambiarSituacion(c.id, { estado: 'baja_medica', desde: '2026-11-12' }, { usuarioId: u.id });
  assert.deepEqual((await vac()).map(x => x.t), ['11-02/11-04', '11-09/11-11']);

  const sol = await repoVac.solapes({ conductorId: c.id });
  assert.deepEqual(sol.map(s => [s.desde, s.hasta, s.estado]).sort(),
    [['2026-11-05', '2026-11-08', 'pendiente'], ['2026-11-12', '2026-11-15', 'pendiente']]);

  // Decidir: con la llave de aprobar vacaciones. Mantenidos cuentan como vacaciones.
  const s1 = sol.find(s => s.desde === '2026-11-05');
  await assert.rejects(vacaciones.resolverSolape(s1.id, { decision: 'mantenidos' }, { usuarioId: otro.id }), /aprueba|aprobar/);
  await vacaciones.resolverSolape(s1.id, { decision: 'mantenidos', nota: 'Las pidió antes' }, { usuarioId: u.id });
  const mant = await repoVac.solapesMantenidos([String(c.id)], '2026-01-01');
  assert.deepEqual(mant.map(t => [t.estado, t.desde, t.hasta, !!t.solape]), [['vacaciones', '2026-11-05', '2026-11-08', true]]);
  await assert.rejects(vacaciones.resolverSolape(s1.id, { decision: 'devueltos' }, { usuarioId: u.id }), /ya estaba decidido/);
}));
