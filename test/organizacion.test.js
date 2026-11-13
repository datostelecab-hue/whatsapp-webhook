// ============================================================
// LA ORGANIZACIÓN (pieza A5 de la hoja de ruta, db/248)
// ============================================================
// Áreas, superiores y quién hace qué: lo que necesitan «avisa al responsable y
// a su superior» y «cada responsable de área ve el suyo» (ítem 1), «la aprueba
// un supervisor» (ítems 1 y 5) y «solo lo ven Laura, Ignacio y Fernando»
// (ítem 4, convención 6).
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const org = require('../services/organizacion');
const libro = require('../services/libro');

test('el superior es el que se pone; si no, el responsable del área; el responsable no es su propio superior', () =>
  conBase(async ({ fabrica }) => {
    const jefa = await fabrica.usuario({ nombre: 'Jefa', rol: 'oficina' });
    const ana = await fabrica.usuario({ nombre: 'Ana', rol: 'oficina' });
    const otro = await fabrica.usuario({ nombre: 'Otro', rol: 'oficina' });
    await org.ponerArea(jefa.id, { area: 'rrhh', responsable: true }, { quien: jefa.id });
    await org.ponerArea(ana.id, { area: 'rrhh' }, { quien: jefa.id });
    assert.equal((await org.superiorDe(ana.id)).id, jefa.id, 'el responsable del área');
    assert.equal(await org.superiorDe(jefa.id), null, 'la responsable no se tiene a sí misma');
    await org.ponerArea(ana.id, { area: 'rrhh', superiorId: otro.id }, { quien: jefa.id });
    assert.equal((await org.superiorDe(ana.id)).id, otro.id, 'el puesto a mano manda');

    // Cada persona lleva solo el área en la que está: si se cambia, suelta la otra.
    await org.ponerArea(jefa.id, { area: 'control', responsable: true }, { quien: jefa.id });
    const areas = (await org.organigrama()).areas;
    assert.equal(areas.find(a => a.codigo === 'rrhh').responsable_id, null, 'rrhh se queda sin responsable');
    assert.equal(areas.find(a => a.codigo === 'control').responsable_id, jefa.id);
    await org.ponerArea(jefa.id, { area: 'control' }, { quien: jefa.id });
    assert.equal((await org.organigrama()).areas.find(a => a.codigo === 'control').responsable_id, null,
      'sin marcar «responsable», deja de serlo');
  }));

test('no se puede cerrar un círculo de superiores, ni ser el superior de uno mismo', () => conBase(async ({ fabrica }) => {
  const a = await fabrica.usuario({ nombre: 'A' });
  const b = await fabrica.usuario({ nombre: 'B' });
  await org.ponerArea(b.id, { area: 'control', superiorId: a.id });
  await assert.rejects(org.ponerArea(a.id, { area: 'control', superiorId: b.id }), /círculo/);
  await assert.rejects(org.ponerArea(a.id, { area: 'control', superiorId: a.id }), /propio superior/);
  await assert.rejects(org.ponerArea(a.id, { area: 'no_existe' }), /No existe el área/);
}));

test('convención 6: una función se mira en la persona; ni el superadmin ni el desarrollador la tienen por su rol', () =>
  conBase(async ({ fabrica }) => {
    const laura = await fabrica.usuario({ nombre: 'Laura', rol: 'oficina' });
    const dev = await fabrica.usuario({ nombre: 'Dev', rol: 'desarrollador' });
    const admin = await fabrica.usuario({ nombre: 'Admin', rol: 'superadmin' });
    await org.darFuncion(laura.id, 'expedientes_ver', {}, { quien: dev.id });
    await org.exigir(laura.id, 'expedientes_ver');
    await assert.rejects(org.exigir(dev.id, 'expedientes_ver'), /es de Laura/);
    await assert.rejects(org.exigir(admin.id, 'expedientes_ver'), /es de Laura/);
    assert.equal(await org.tiene(null, 'expedientes_ver'), false);
  }));

test('ítems 1 y 5: «la aprueba un supervisor» sale de quién tiene la función, sin bloqueados ni anuladas', () =>
  conBase(async ({ fabrica, consulta }) => {
    const ignacio = await fabrica.usuario({ nombre: 'Ignacio' });
    const william = await fabrica.usuario({ nombre: 'William' });
    const ido = await fabrica.usuario({ nombre: 'Ido' });
    for (const u of [ignacio, william, ido]) await org.darFuncion(u.id, 'supervisor', {}, { quien: ignacio.id });
    await consulta(`UPDATE usuario SET estado = 'bloqueado' WHERE id = $1`, [ido.id]);
    const f = (await org.ficha(william.id)).funciones.find(x => x.codigo === 'supervisor');
    await org.quitarFuncion(f.id, 'Se va a Barcelona', { quien: ignacio.id });
    assert.deepEqual((await org.quienes('supervisor')).map(p => p.id), [ignacio.id]);
  }));

test('una función de una sola persona no se da dos veces, salvo como suplente; ni la misma a la misma persona', () =>
  conBase(async ({ fabrica }) => {
    const diana = await fabrica.usuario({ nombre: 'Diana' });
    const otra = await fabrica.usuario({ nombre: 'Otra' });
    await org.darFuncion(diana.id, 'nomina');
    await assert.rejects(org.darFuncion(otra.id, 'nomina'), /una sola persona/);
    await org.darFuncion(otra.id, 'nomina', { suplente: true });
    await assert.rejects(org.darFuncion(diana.id, 'nomina'), /Ya tiene/);
    const q = await org.quienes('nomina');
    assert.deepEqual(q.map(p => [p.id, p.suplente]), [[diana.id, false], [otra.id, true]]);
    assert.deepEqual((await org.quienes('nomina', { conSuplentes: false })).map(p => p.id), [diana.id]);
  }));

test('convención 5: dar y quitar una función queda en el libro, con quién y por qué; quitar es anular', () =>
  conBase(async ({ fabrica, consulta }) => {
    const ignacio = await fabrica.usuario({ nombre: 'Ignacio', apellidos: 'De Prueba' });
    const daiane = await fabrica.usuario({ nombre: 'Daiane' });
    await org.darFuncion(daiane.id, 'multas', {}, { quien: ignacio.id });
    const f = (await org.ficha(daiane.id)).funciones[0];
    await assert.rejects(org.quitarFuncion(f.id, '', { quien: ignacio.id }), /Di por qué/);
    await org.quitarFuncion(f.id, 'Ahora lo lleva otra persona', { quien: ignacio.id });

    const h = await libro.historial('usuario_funcion', String(f.id));
    assert.deepEqual(h.map(x => x.accion), ['alta', 'anulacion']);
    assert.equal(h[0].quien, 'Ignacio De Prueba');
    assert.equal(h[1].motivo, 'Ahora lo lleva otra persona');
    const fila = (await consulta('SELECT anulado_at IS NOT NULL AS anulada FROM usuario_funcion WHERE id = $1', [f.id])).rows[0];
    assert.equal(fila.anulada, true, 'la fila sigue: nada se borra');
  }));

test('cambiar el rol o el área de alguien queda en el libro; su contraseña y su tema, no', () => conBase(async ({ fabrica, consulta }) => {
  const u = await fabrica.usuario({ nombre: 'Rol' });
  await consulta(`UPDATE usuario SET rol_id = (SELECT id FROM rol WHERE codigo = 'trafico') WHERE id = $1`, [u.id]);
  await consulta(`UPDATE usuario SET pass_hash = 'otro-hash', ultimo_acceso = now() WHERE id = $1`, [u.id]);
  await consulta(`UPDATE usuario SET tema = 'claro-rosa', ayudas = NOT COALESCE(ayudas, FALSE) WHERE id = $1`, [u.id]);
  const h = await libro.historial('usuario', String(u.id));
  assert.deepEqual(h.map(x => x.accion), ['alta', 'cambio'], 'ni la contraseña, ni el último acceso, ni el tema dejan fila');
  assert.deepEqual(h[1].cambios.map(c => c.campo), ['rol_id']);
  const todo = JSON.stringify((await consulta(`SELECT antes, despues FROM auditoria WHERE tabla = 'usuario' AND registro = $1`, [String(u.id)])).rows);
  assert.equal(todo.includes('pass_hash'), false);
}));

test('ítem 1: el tablero del equipo de un responsable es su área; con «ve todos», toda la oficina', () => conBase(async ({ fabrica }) => {
  const laura = await fabrica.usuario({ nombre: 'Laura' });
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  const pepe = await fabrica.usuario({ nombre: 'Pepe' });
  const fernando = await fabrica.usuario({ nombre: 'Fernando' });
  await org.ponerArea(laura.id, { area: 'rrhh', responsable: true });
  await org.ponerArea(ana.id, { area: 'rrhh' });
  await org.ponerArea(pepe.id, { area: 'taller' });
  await org.darFuncion(fernando.id, 've_todos_los_tableros');

  const deLaura = await org.equipo(laura.id);
  assert.equal(deLaura.todos, false);
  assert.deepEqual(deLaura.personas.map(p => p.id), [ana.id]);
  const deFernando = await org.equipo(fernando.id);
  assert.equal(deFernando.todos, true);
  assert.ok(deFernando.personas.some(p => p.id === pepe.id) && deFernando.personas.some(p => p.id === ana.id));
}));

test('convención 6: las llaves que se salen de las de su rol, de más y de menos', () => conBase(async ({ fabrica, consulta }) => {
  const u = await fabrica.usuario({ nombre: 'Llaves', rol: 'taller' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/vehiculos'), ($1, '/nominas')`, [u.id]);
  const x = await org.excepcionesDeLlaves(u.id, 'taller');
  assert.equal(x.accesoTotal, false);
  assert.ok(x.deMas.some(k => k.clave === '/nominas'), '/nominas no es del rol taller');
  assert.ok(x.deMenos.some(k => k.clave === '/pendientes'), '/pendientes es del rol taller y no la tiene');
  assert.equal(x.deMas.some(k => k.clave === '/vehiculos'), false);
  assert.equal((await org.excepcionesDeLlaves(u.id, 'desarrollador')).accesoTotal, true);
}));

test('el catálogo de funciones es coherente y una función que no existe no se inventa', () => conBase(async () => {
  const vistos = new Set();
  for (const f of org.FUNCIONES) {
    assert.match(f.codigo, /^[a-z_]+$/);
    assert.ok(!vistos.has(f.codigo), `repetida: ${f.codigo}`);
    vistos.add(f.codigo);
    assert.ok(f.etiqueta && f.descripcion && f.item, `${f.codigo} sin etiqueta, descripción o ítem`);
  }
  await assert.rejects(org.quienes('no_existe'), /No existe la función/);
}));

test('las funciones que siembra db/248 son todas del catálogo', async () => {
  const fs = require('fs');
  const sql = fs.readFileSync(require('path').join(__dirname, '..', 'db', '248-organizacion.sql'), 'utf8');
  const usadas = [...sql.matchAll(/\(\s*\d+,\s*'[^']*',\s*'[^']*',\s*'([a-z_]+)',\s*(TRUE|FALSE)\)/g)].map(m => m[1]);
  assert.ok(usadas.length > 20);
  for (const u of usadas) assert.ok(org.FUNCIONES.some(f => f.codigo === u), `db/248 siembra «${u}», que no está en el catálogo`);
});
