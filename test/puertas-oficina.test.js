// ============================================================
// PUERTAS DESDE EL ERP (27/11/2026)
// ============================================================
// La oficina abre y cierra un coche desde su ficha: el desarrollador o la llave
// '/puertas', con la misma orden que el bot. Mapon, simulado.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const puertasBot = require('../services/puertasBot');
const oficina = require('../services/puertasOficina');

test('abrir desde el ERP: quién puede, la orden como en el bot y lo que se le dice', () => conBase(async ({ consulta, fabrica }) => {
  const real = puertasBot.ejecutar;
  const ordenes = [];
  puertasBot.ejecutar = async o => { ordenes.push(o); return { ok: true }; };
  try {
    const v = await fabrica.vehiculo({ matricula: '0400MMZ' });
    const sin = await fabrica.usuario({ rol: 'oficina', nombre: 'Sin' });
    const con = await fabrica.usuario({ rol: 'oficina', nombre: 'Con' });
    await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/puertas')`, [con.id]);

    await assert.rejects(oficina.orden({ matricula: '0400MMZ', abrir: true }, { id: sin.id, rol: 'oficina' }), e => e.status === 403);
    await assert.rejects(oficina.orden({ matricula: '0400MMZ', abrir: true }, { id: sin.id, rol: 'superadmin' }), e => e.status === 403,
      'el superadmin no por serlo: una puerta se da persona a persona');
    await assert.rejects(oficina.orden({ matricula: '9999ZZZ', abrir: true }, { id: con.id, rol: 'oficina' }), e => e.status === 404);

    const r = await oficina.orden({ matricula: '0400 mmz', abrir: true }, { id: con.id, rol: 'oficina', nombre: 'Con', apellidos: 'Llave' });
    assert.equal(r.ok, true);
    assert.equal(r.titulo, 'Orden de abrir enviada');
    assert.equal(ordenes.length, 1);
    assert.deepEqual([ordenes[0].matricula, ordenes[0].abrir, ordenes[0].sede, ordenes[0].nombre, ordenes[0].telefono],
      [v.matricula, true, null, 'ERP · Con Llave', `erp:${con.id}`]);

    // El desarrollador, por su rol. Y si Mapon no llega, se dice por qué.
    puertasBot.ejecutar = async () => ({ ok: false, motivo: 'no-llega' });
    const f = await oficina.orden({ matricula: '0400MMZ', abrir: false }, { id: sin.id, rol: 'desarrollador' });
    assert.equal(f.ok, false);
    assert.match(f.texto, /no ha recibido la orden de cerrar/);
  } finally {
    puertasBot.ejecutar = real;
  }
}));
