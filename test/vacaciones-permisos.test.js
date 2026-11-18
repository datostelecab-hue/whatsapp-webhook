// ============================================================
// LOS PERMISOS DE LA OFICINA: ASUNTOS PROPIOS Y TELETRABAJO (db/271, 18/11/2026)
// ============================================================
// Camilo: «que también podamos solicitar 2 días de asuntos propios o permisos
// especiales, como medio día de teletrabajo, todo un día de teletrabajo, etc., y
// que quede un histórico de esos permisos».
//
//   · el banco de asuntos propios: 2 al año desde el alta (o 2026), enteros, lo
//     no usado se acumula, y no resta vacaciones;
//   · un permiso son sus días laborables sin festivo; el medio día es un solo día;
//   · no se pide un día que ya tiene un permiso ni unas vacaciones;
//   · lo aprueba quien lleva Usuarios y permisos; quien lo pidió lo retira; nada
//     se borra: el histórico enseña también lo rechazado y lo retirado.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const vac = require('../modules/VacacionesOficina/vacacionesOficina.service');
const vrepo = require('../modules/VacacionesOficina/vacacionesOficina.repo');
const usuarios = require('../modules/Usuarios/usuarios.service');
const calendario = require('../services/calendario');

/** Los festivos de Madrid que el calendario ya tiene: un lunes festivo no cuenta como día de permiso. */
let FESTIVOS = new Set();
const cargarFestivos = async () => { FESTIVOS = new Set((await calendario.de('madrid')).festivos || []); };

/** El primer lunes posterior a una fecha que no sea festivo: un día laborable seguro. */
function lunesDespues(d) {
  let x = calendario.sumarDias(d, 1);
  while (new Date(x + 'T12:00:00Z').getUTCDay() !== 1 || FESTIVOS.has(x)) x = calendario.sumarDias(x, 1);
  return x;
}

test('el banco de asuntos propios: 2 al año desde el alta (o 2026), enteros; lo no usado se acumula; lo futuro, programado', () => {
  assert.equal(vac._bancoAsuntos({ alta: null, hoy: '2026-11-18', alAno: 2 }).generados, 0, 'sin alta, no genera');
  assert.equal(vac._bancoAsuntos({ alta: '2025-03-01', hoy: '2026-11-18', alAno: 2 }).generados, 2, 'entró antes de 2026: cuenta desde 2026');
  assert.equal(vac._bancoAsuntos({ alta: '2026-09-01', hoy: '2026-11-18', alAno: 2 }).generados, 2, 'entró a mitad de año: sus 2 enteros');
  assert.equal(vac._bancoAsuntos({ alta: '2024-01-01', hoy: '2028-02-01', alAno: 2 }).generados, 6, 'se acumula: 2026, 2027 y 2028');
  const filas = [
    { tipo: 'asuntos_propios', fraccion: 'dia', estado: 'aprobado', fecha: '2026-05-04' },
    { tipo: 'asuntos_propios', fraccion: 'manana', estado: 'aprobado', fecha: '2026-06-01' },
    { tipo: 'asuntos_propios', fraccion: 'dia', estado: 'aprobado', fecha: '2027-01-08' },
    { tipo: 'asuntos_propios', fraccion: 'dia', estado: 'pedido', fecha: '2026-12-01' },
    { tipo: 'teletrabajo', fraccion: 'dia', estado: 'aprobado', fecha: '2026-07-01' },
  ];
  const b = vac._bancoAsuntos({ alta: '2025-03-01', hoy: '2026-11-18', alAno: 2, filas });
  // Generados 2; usados 1,5 (un día y medio, ya pasados); programado 1 (enero); pedido 1; el teletrabajo no cuenta.
  assert.deepEqual([b.generados, b.usados, b.programados, b.pedidos, b.saldo, b.saldoTras], [2, 1.5, 1, 1, 0.5, -0.5]);
});

test('un permiso son sus días laborables sin festivo; el medio día es un solo día; dos meses como mucho', () => {
  const e = { laborables: [1, 2, 3, 4, 5], festivos: new Set(['2026-11-20']) };   // 20/11 es viernes
  assert.deepEqual(vac._diasDelPermiso('2026-11-16', '2026-11-22', e), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
  assert.throws(() => vac._validarPermiso({ tipo: 'teletrabajo', desde: '2026-11-16', hasta: '2026-11-17', fraccion: 'manana' }), /un solo día/);
  assert.throws(() => vac._validarPermiso({ tipo: 'nada', desde: '2026-11-16', hasta: '2026-11-16', fraccion: 'dia' }), /no existe/);
  assert.throws(() => vac._validarPermiso({ tipo: 'asuntos_propios', desde: '2026-01-01', hasta: '2026-12-31', fraccion: 'dia' }), /dos meses/);
  vac._validarPermiso({ tipo: 'teletrabajo', desde: '2026-11-16', hasta: '2026-11-16', fraccion: 'tarde' });   // no lanza
});

async function oficina({ fabrica, consulta }) {
  const jefe = await fabrica.usuario({ nombre: 'Ignacia' });
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  const luis = await fabrica.usuario({ nombre: 'Luis' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/usuarios')`, [jefe.id]);
  const firma = { usuarioId: jefe.id, origen: 'usuarios' };
  return { jefe: { id: jefe.id, rol: 'oficina' }, ana: { id: ana.id, rol: 'oficina' }, luis: { id: luis.id, rol: 'oficina' }, firma };
}

test('asuntos propios: un banco aparte que no resta vacaciones; pedir, aprobar y el histórico; el teletrabajo, sin banco', () => conBase(async h => {
  await cargarFestivos();
  const p = await oficina(h);
  await usuarios.fijarFechaAlta(p.ana.id, '2025-01-01', p.firma);
  const hoy = calendario.hoy();
  const anos = Number(hoy.slice(0, 4)) - 2026 + 1;
  const d1 = lunesDespues(hoy), d2 = calendario.sumarDias(d1, 1);
  const d4 = lunesDespues(d2), d5 = lunesDespues(d4), d6 = lunesDespues(d5), d7 = lunesDespues(d6);

  const antes = await vac.permisosMios(p.ana);
  assert.equal(antes.banco.generados, anos * 2, 'dos al año desde 2026, enteros');

  // Dos días de asuntos propios, como una sola petición.
  const sim = await vac.simularPermiso(p.ana, { tipo: 'asuntos_propios', desde: d1, hasta: d2, fraccion: 'dia' });
  assert.equal(sim.quedaria, anos * 2 - 2, 'lo que queda después: sin pasarse');
  assert.equal(sim.sePasa, false);
  const r = await vac.pedirPermiso(p.ana, { tipo: 'asuntos_propios', desde: d1, hasta: d2, fraccion: 'dia', nota: 'Trámites' });
  assert.equal(r.dias, 2);

  // Un día que ya tiene un permiso, no.
  await assert.rejects(vac.pedirPermiso(p.ana, { tipo: 'teletrabajo', desde: d1, hasta: d1, fraccion: 'manana' }), /Ya tienes un permiso/);

  // Medio día de teletrabajo: no mira el banco.
  const tele = await vac.pedirPermiso(p.ana, { tipo: 'teletrabajo', desde: d4, hasta: d4, fraccion: 'tarde', nota: 'Medio día en casa' });
  assert.equal((await vac.simularPermiso(p.ana, { tipo: 'teletrabajo', desde: d5, hasta: d5, fraccion: 'dia' })).banco, null, 'el teletrabajo no tiene banco');

  // Lo ve quien aprueba, con la previsión; quien no aprueba no lo ve.
  const lista = await vac.permisosLista(p.jefe, { estado: 'pedido' });
  const pedida = lista.permisos.find(g => g.grupo === r.grupo);
  assert.deepEqual([pedida.dias.length, pedida.prevision.sePasa], [2, false]);
  await assert.rejects(vac.permisosLista(p.ana, {}), e => e.status === 403);

  // Solo aprueba quien tiene la llave; luego queda aprobado y programado (es futuro).
  await assert.rejects(vac.resolverPermiso(p.ana, r.grupo, 'aprobar', {}), e => e.status === 403);
  await vac.resolverPermiso(p.jefe, r.grupo, 'aprobar', {});
  const tras = await vac.permisosMios(p.ana);
  assert.equal(tras.permisos.find(g => g.grupo === r.grupo).estado, 'aprobado');
  assert.deepEqual([tras.banco.programados, tras.banco.usados, tras.banco.saldoTras], [2, 0, anos * 2 - 2]);

  // Rechazado con motivo; y retirado por quien lo pidió (no por otro).
  const t2 = await vac.pedirPermiso(p.ana, { tipo: 'teletrabajo', desde: d5, hasta: d5, fraccion: 'dia' });
  await assert.rejects(vac.resolverPermiso(p.jefe, t2.grupo, 'rechazar', { motivo: 'no' }), /Di por qué/);
  await vac.resolverPermiso(p.jefe, t2.grupo, 'rechazar', { motivo: 'Esa semana, no' });
  const t3 = await vac.pedirPermiso(p.ana, { tipo: 'teletrabajo', desde: d6, hasta: d6, fraccion: 'dia' });
  await assert.rejects(vac.resolverPermiso(p.jefe, t3.grupo, 'retirar', {}), e => e.status === 403);
  await vac.resolverPermiso(p.ana, t3.grupo, 'retirar', {});

  // El histórico lo tiene todo: nada se borra.
  const historia = await vac.permisosMios(p.ana);
  const estados = Object.fromEntries(historia.permisos.map(g => [g.grupo, g.estado]));
  assert.deepEqual([estados[r.grupo], estados[tele.grupo], estados[t2.grupo], estados[t3.grupo]], ['aprobado', 'pedido', 'rechazado', 'retirado']);
  assert.equal(historia.permisos.length, 4);
  assert.equal(historia.permisos.find(g => g.grupo === t2.grupo).resueltoNota, 'Esa semana, no');
}));

test('el banco se pasa: se deja pedir y quien aprueba lo ve; un día con vacaciones no se pide', () => conBase(async h => {
  await cargarFestivos();
  const p = await oficina(h);
  await usuarios.fijarFechaAlta(p.ana.id, '2025-01-01', p.firma);
  const hoy = calendario.hoy();
  const anos = Number(hoy.slice(0, 4)) - 2026 + 1;
  const lunes = lunesDespues(hoy);
  // Una semana entera de asuntos propios: 5 días, con el banco de 2 al año.
  const semana = calendario.sumarDias(lunes, 4);
  const sim = await vac.simularPermiso(p.ana, { tipo: 'asuntos_propios', desde: lunes, hasta: semana, fraccion: 'dia' });
  assert.equal(sim.cuentan, 5);
  assert.equal(sim.quedaria, anos * 2 - 5);
  assert.equal(sim.sePasa, anos * 2 - 5 < 0);
  const r = await vac.pedirPermiso(p.ana, { tipo: 'asuntos_propios', desde: lunes, hasta: semana, fraccion: 'dia' });
  const lista = await vac.permisosLista(p.jefe, { estado: 'pedido' });
  assert.equal(lista.permisos.find(g => g.grupo === r.grupo).prevision.quedaria, anos * 2 - 5, 'quien aprueba ve cuánto quedaría');

  // Unas vacaciones aprobadas un día de otra semana: ese día no se pide.
  const dia = lunesDespues(calendario.sumarDias(semana, 1));
  const vid = await vrepo.insertar(null, { usuarioId: p.ana.id, desde: dia, hasta: dia, libra: [6, 7], nota: '', por: p.ana.id });
  await vrepo.resolver(null, vid, { estado: 'aprobada', por: p.jefe.id, nota: '', desdeEstados: ['pedida'] });
  await assert.rejects(vac.pedirPermiso(p.ana, { tipo: 'teletrabajo', desde: dia, hasta: dia, fraccion: 'dia' }), /tienes vacaciones/);
}));
