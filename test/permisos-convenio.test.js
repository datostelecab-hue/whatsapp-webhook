// ============================================================
// LOS PERMISOS DEL CONVENIO: EL VALIDADOR Y EL SALDO (módulo 1, db/290)
// ============================================================
// «Permisos retribuidos: validador configurable (de momento, Diana), con el
// saldo por conductor y tipo de permiso siempre visible según el convenio».
// Camilo, 25/11/2026: la llave en todas las puertas (también asuntos propios),
// y pasarse del convenio se avisa y pide motivo.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const plantilla = require('../modules/Conductores/plantilla.service');
const convenio = require('../modules/Conductores/permisosConvenio');
const permisos = require('../services/permisos');

test('lo que da cada permiso, en una frase', () => {
  assert.equal(convenio.regla({ duracion: 15, unidad: 'CALENDAR_DAYS' }), '15 días naturales por hecho causante');
  assert.equal(convenio.regla({ duracion: 2, unidad: 'WORKDAYS', nota: '+2 dias si requiere desplazamiento' }),
    '2 días laborables por hecho causante (+2 días si requiere desplazamiento)');
  assert.equal(convenio.regla({ duracion: 8, unidad: 'HOURS_PER_YEAR' }), '8 horas al año (cada día de permiso cuenta 8 h)');
  // Laborables: del lunes 02/11 al domingo 08/11 librando sábado y domingo, 5.
  assert.equal(convenio.cuenta({ unidad: 'WORKDAYS' }, '2026-11-02', '2026-11-08', new Set([6, 7])), 5);
});

test('las semillas de los roles no reparten lo que es «manual»', () => {
  assert.ok(!permisos.semillaDeRol('oficina').some(c => c.startsWith('/ausencias')), 'datos de salud: se dan uno a uno');
  assert.ok(!permisos.semillaDeRol('directiva').includes('/permisos/aprobar'));
});

test('la llave en todas las puertas, el aviso con motivo y el saldo', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/permisos/aprobar')`, [diana.id]);
  const yo = { usuarioId: diana.id };
  const otro = { usuarioId: (await fabrica.usuario({ rol: 'superadmin', nombre: 'Sin' })).id };
  const c = await fabrica.conductor({ nombre: 'PERMISOS' });

  // Sin la llave, ni el superadmin.
  await assert.rejects(plantilla.anadirAusencia(c.id, { estado: 'permiso', tipoPermiso: 'PR_FALLECIMIENTO', desde: '2026-11-02', hasta: '2026-11-03' }, otro),
    /Validar permisos/);
  // Fallecimiento: 2 laborables. Dos días, bien.
  await plantilla.anadirAusencia(c.id, { estado: 'permiso', tipoPermiso: 'PR_FALLECIMIENTO', desde: '2026-11-02', hasta: '2026-11-03' }, yo);
  // Cuatro (con desplazamiento): sin motivo, el error lo pide; con motivo, se guarda y lo dice.
  const sinMotivo = await plantilla.anadirAusencia(c.id, { estado: 'permiso', tipoPermiso: 'PR_FALLECIMIENTO', desde: '2026-11-09', hasta: '2026-11-12' }, yo)
    .then(() => null, e => e);
  assert.ok(sinMotivo && sinMotivo.pide && sinMotivo.pide.campo === 'motivoExceso', 'pide el motivo');
  assert.equal(sinMotivo.status, 409);
  await plantilla.anadirAusencia(c.id, { estado: 'permiso', tipoPermiso: 'PR_FALLECIMIENTO', desde: '2026-11-09', hasta: '2026-11-12',
    motivoExceso: 'Desplazamiento a Galicia' }, yo);
  const m = (await consulta(`SELECT motivo FROM conductor_estado_hist WHERE conductor_id = $1 AND desde = '2026-11-09'`, [c.id])).rows[0].motivo;
  assert.match(m, /Más de lo que da el convenio .*Desplazamiento a Galicia/);

  // Asuntos propios: 2 al año, sumando los del año.
  await plantilla.anadirAusencia(c.id, { estado: 'asuntos_propios', desde: '2026-11-16', hasta: '2026-11-16' }, yo);
  await assert.rejects(plantilla.anadirAusencia(c.id, { estado: 'asuntos_propios', desde: '2026-11-18', hasta: '2026-11-19' }, yo),
    e => e.pide && /3 días este año/.test(e.pide.texto));

  // Corregir un permiso: la llave, y la cuenta sin contarse a sí mismo.
  const fila = (await consulta(`SELECT id FROM conductor_estado_hist WHERE conductor_id = $1 AND desde = '2026-11-02'`, [c.id])).rows[0].id;
  await assert.rejects(plantilla.editarAusencia(c.id, fila, { hasta: '2026-11-03' }, otro), /Validar permisos/);
  await assert.rejects(plantilla.editarAusencia(c.id, fila, { hasta: '2026-11-05' }, yo), e => !!e.pide, 'alargarlo a 4 laborables pide motivo');
  await assert.rejects(plantilla.borrarAusencia(c.id, fila, otro), /Validar permisos/);

  // El saldo: lo que lleva de cada uno, y lo que le queda de los que son al año.
  const s = await plantilla.saldoPermisos(c.id, '2026');
  const fall = s.tipos.find(t => t.codigo === 'PR_FALLECIMIENTO');
  assert.deepEqual([fall.permisos, fall.usado, fall.queda], [2, 6, null]);
  const ap = s.tipos.find(t => t.codigo === 'PR_ASUNTOS_PROPIOS');
  assert.deepEqual([ap.usado, ap.queda], [1, 1]);
  assert.ok(s.tipos.find(t => t.codigo === 'PR_ACOMP_MEDICO').queda === 8);
}));
