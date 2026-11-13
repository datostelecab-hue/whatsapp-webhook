// ============================================================
// LA ORGANIZACIÓN (pieza A5 de la hoja de ruta, db/248)
// ============================================================
// Áreas, superiores y quién hace qué: lo que necesitan «avisa al responsable y
// a su superior» y «cada responsable de área ve el suyo» (ítem 1), «la aprueba
// un supervisor» (ítems 1 y 5) y «solo lo ven Laura, Ignacio y Fernando»
// (ítem 4, convención 6).
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const usuarios = require('../modules/Usuarios/usuarios.service');
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
    // La titular va DETRÁS por orden alfabético: así «primero los titulares» se prueba de verdad.
    const diana = await fabrica.usuario({ nombre: 'Zoe' });
    const otra = await fabrica.usuario({ nombre: 'Ana' });
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

// ── Lo que encontró la revisión del 13/11/2026 ─────────────────────────────

test('no se cierra un círculo por el responsable del área, aunque no se ponga superior', () => conBase(async ({ fabrica }) => {
  const r = await fabrica.usuario({ nombre: 'Rocio' });
  const m = await fabrica.usuario({ nombre: 'Mario' });
  // Rocío lleva Control y tiene puesto como superior a Mario...
  await org.ponerArea(r.id, { area: 'control', superiorId: m.id, responsable: true });
  // ...y Mario entra en Control sin superior puesto: pasaría a depender de Rocío.
  await assert.rejects(org.ponerArea(m.id, { area: 'control' }), /círculo de superiores: Mario De Prueba → Rocio De Prueba → Mario/);
  // Lo normal sigue pasando: entrar sin superior en un área con responsable.
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  await org.ponerArea(ana.id, { area: 'control' });
  assert.equal((await org.superiorDe(ana.id)).id, r.id);
  // Y una cadena más larga: Rocío → Sara → Bea, y Bea entra en Control.
  const sara = await fabrica.usuario({ nombre: 'Sara' });
  const bea = await fabrica.usuario({ nombre: 'Bea' });
  await org.ponerArea(r.id, { area: 'control', superiorId: sara.id, responsable: true });
  await org.ponerArea(sara.id, { area: 'rrhh', superiorId: bea.id });
  await assert.rejects(org.ponerArea(bea.id, { area: 'control' }), /círculo/);
}));

test('si el superior puesto está bloqueado, manda el responsable del área', () => conBase(async ({ fabrica, consulta }) => {
  const jefa = await fabrica.usuario({ nombre: 'Jefa' });
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  const s = await fabrica.usuario({ nombre: 'Sebas' });
  await org.ponerArea(jefa.id, { area: 'rrhh', responsable: true });
  await org.ponerArea(ana.id, { area: 'rrhh', superiorId: s.id });
  assert.equal((await org.superiorDe(ana.id)).id, s.id);
  await consulta(`UPDATE usuario SET estado = 'bloqueado' WHERE id = $1`, [s.id]);
  const sup = await org.superiorDe(ana.id);
  assert.deepEqual([sup.id, sup.porque], [jefa.id, 'responsable del área']);
}));

test('una función de una sola persona cuyo titular está bloqueado: se le anula a él al darla, y al desbloquearlo no hay dos', () =>
  conBase(async ({ fabrica, consulta }) => {
    const ignacio = await fabrica.usuario({ nombre: 'Ignacio' });
    const diana = await fabrica.usuario({ nombre: 'Diana' });
    const mercedes = await fabrica.usuario({ nombre: 'Mercedes' });
    await org.darFuncion(diana.id, 'nomina', {}, { quien: ignacio.id });
    const suya = (await org.ficha(diana.id)).funciones[0];
    await consulta(`UPDATE usuario SET estado = 'bloqueado' WHERE id = $1`, [diana.id]);
    await org.darFuncion(mercedes.id, 'nomina', {}, { quien: ignacio.id });
    await consulta(`UPDATE usuario SET estado = 'activo' WHERE id = $1`, [diana.id]);
    assert.deepEqual((await org.quienes('nomina', { conSuplentes: false })).map(p => p.id), [mercedes.id]);
    const h = await libro.historial('usuario_funcion', String(suya.id));
    assert.deepEqual(h.map(x => x.accion), ['alta', 'anulacion']);
    assert.equal(h[1].quien, 'Ignacio De Prueba');
    assert.match(h[1].motivo, /Pasa a Mercedes De Prueba: Diana De Prueba está bloqueado/);
    // Con la titular activa, sigue sin poder darse.
    await assert.rejects(org.darFuncion(diana.id, 'nomina', {}, { quien: ignacio.id }), /una sola persona \(Mercedes De Prueba\)/);
  }));

test('quitar una función a alguien que acaban de bloquear la quita y no contesta error', () => conBase(async ({ fabrica, consulta }) => {
  const pepe = await fabrica.usuario({ nombre: 'Pepe' });
  await org.darFuncion(pepe.id, 'multas');
  const f = (await org.ficha(pepe.id)).funciones[0];
  await consulta(`UPDATE usuario SET estado = 'bloqueado' WHERE id = $1`, [pepe.id]);
  assert.equal(await org.quitarFuncion(f.id, 'Se va de la empresa'), null, 'sin ficha que enseñar, pero sin error');
  const fila = (await consulta('SELECT anulado_at IS NOT NULL AS anulada FROM usuario_funcion WHERE id = $1', [f.id])).rows[0];
  assert.equal(fila.anulada, true);
  await assert.rejects(org.quitarFuncion(f.id, 'Otra vez'), /ya no la tiene/);
}));

test('cambiar el área, el superior y el responsable queda en el libro con quién y desde dónde', () => conBase(async ({ fabrica }) => {
  const ignacio = await fabrica.usuario({ nombre: 'Ignacio' });
  const laura = await fabrica.usuario({ nombre: 'Laura' });
  await org.ponerArea(laura.id, { area: 'rrhh', superiorId: ignacio.id, responsable: true }, { quien: ignacio.id });
  const hu = (await libro.historial('usuario', String(laura.id))).at(-1);
  assert.deepEqual([hu.accion, hu.quien, hu.origen], ['cambio', 'Ignacio De Prueba', 'organizacion']);
  assert.deepEqual(hu.cambios.map(c => c.campo).sort(), ['area_codigo', 'superior_id']);
  const ha = (await libro.historial('cat_area', 'rrhh')).at(-1);
  assert.deepEqual([ha.quien, ha.origen, ha.cambios.map(c => c.campo)], ['Ignacio De Prueba', 'organizacion', ['responsable_id']]);
}));

test('las llaves hijas del catálogo salen con su nombre, no con la ruta', () => conBase(async ({ fabrica }) => {
  const u = await fabrica.usuario({ nombre: 'Jefe', rol: 'jefe_trafico' });
  const x = await org.excepcionesDeLlaves(u.id, 'jefe_trafico');
  assert.ok(x.deMenos.length > 0);
  assert.ok(x.deMenos.some(k => k.clave === '/planificador/editar'), 'una hija de su rol');
  for (const k of x.deMenos) assert.notEqual(k.etiqueta, k.clave, `${k.clave} sin nombre`);
}));

test('lo que se cambia en /usuarios queda en el libro con quién lo hizo (db/248)', () => conBase(async ({ fabrica }) => {
  const jefe = await fabrica.usuario({ nombre: 'Gestor' });
  const u = await fabrica.usuario({ nombre: 'Laura' });
  const firma = { usuarioId: jefe.id, origen: 'usuarios' };
  await usuarios.actualizarUsuario(u.email, { rol: 'trafico' }, firma);
  await usuarios.actualizarUsuario(u.email, { estado: 'bloqueado' }, firma);
  await usuarios.cortarSesiones(u.id, firma);
  await usuarios.fijarFichaObligatorio(u.id, true, firma);
  const h = (await libro.historial('usuario', String(u.id))).slice(1);
  assert.deepEqual(h.map(x => [x.accion, x.quien, x.origen]), [
    ['cambio', 'Gestor De Prueba', 'usuarios'], ['estado', 'Gestor De Prueba', 'usuarios'],
    ['cambio', 'Gestor De Prueba', 'usuarios'], ['cambio', 'Gestor De Prueba', 'usuarios'],
  ]);
  // Y el que no tiene sesión (olvidé mi contraseña) lo firma el sistema, sin «SQL a mano».
  await usuarios.actualizarUsuario(u.email, { hash: 'otro', debe_cambiar: 'si' }, { origen: 'acceso' });
  const ultimo = (await libro.historial('usuario', String(u.id))).at(-1);
  assert.deepEqual([ultimo.quien, ultimo.origen], [null, 'acceso']);
}));

// ── La segunda pasada del 13/11/2026 ────────────────────────────────────────

test('tampoco un círculo que se cerraría al bloquear a alguien en /usuarios', () => conBase(async ({ fabrica, consulta }) => {
  const bruno = await fabrica.usuario({ nombre: 'Bruno' });
  const andres = await fabrica.usuario({ nombre: 'Andres' });
  const rocio = await fabrica.usuario({ nombre: 'Rocio' });
  await org.ponerArea(andres.id, { area: 'control', superiorId: bruno.id });
  // Rocío pasa a llevar Control con Andrés de superior. Hoy no hay círculo
  // (Andrés depende de Bruno), pero si se bloquea a Bruno, Andrés pasa a
  // depender de Rocío: Rocío → Andrés → Rocío. Se para ya.
  await assert.rejects(org.ponerArea(rocio.id, { area: 'control', superiorId: andres.id, responsable: true }),
    /podría quedar un círculo de superiores: Rocio De Prueba → Andres De Prueba → Rocio De Prueba\. Pasaría al bloquear/);
  // Sin ese superior, sí; y bloquear a Bruno ya no cierra nada.
  await org.ponerArea(rocio.id, { area: 'control', responsable: true });
  await consulta(`UPDATE usuario SET estado = 'bloqueado' WHERE id = $1`, [bruno.id]);
  assert.equal((await org.superiorDe(andres.id)).id, rocio.id);
  assert.equal(await org.superiorDe(rocio.id), null);
}));

test('ni uno que se cerraría al desbloquear a alguien', () => conBase(async ({ fabrica, consulta }) => {
  const a = await fabrica.usuario({ nombre: 'A' });
  const b = await fabrica.usuario({ nombre: 'B' });
  const c = await fabrica.usuario({ nombre: 'C' });
  await org.ponerArea(b.id, { superiorId: c.id });
  await org.ponerArea(a.id, { superiorId: b.id });
  await consulta(`UPDATE usuario SET estado = 'bloqueado' WHERE id = $1`, [b.id]);
  // Con B bloqueado, A no depende de nadie; pero si se desbloquea a B: C → A → B → C.
  await assert.rejects(org.ponerArea(c.id, { superiorId: a.id }), /podría quedar un círculo/);
}));
