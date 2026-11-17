// ============================================================
// LAS VACACIONES DE LA OFICINA (db/263, 17/11/2026)
// ============================================================
// Lo que decidió Camilo:
//   · generan 0,084 por cada día del horario de la oficina (de lunes a
//     viernes) desde la fecha de alta, aunque sea festivo o esté de
//     vacaciones, con un tope de 1,84 al mes (un parámetro);
//   · gastan los días de unas vacaciones aprobadas que no son sus dos días de
//     libranza ni festivos;
//   · el simulador suma lo que aún generará hasta el día antes de irse («hoy
//     tengo 10, pero si empiezo el otro mes las vacaciones, debe de contarme
//     11,84»);
//   · cada uno ve las suyas; quien tiene la llave de Usuarios y permisos, las
//     de todos, pone la fecha de alta y aprueba; pedidas, no restan.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const vac = require('../modules/VacacionesOficina/vacacionesOficina.service');
const usuarios = require('../modules/Usuarios/usuarios.service');
const calendario = require('../services/calendario');
const contadores = require('../services/contadores');
const push = require('../services/notificacionesPush');

const enviar = push.enviar;
let avisos = [];
beforeEach(() => { avisos = []; push.enviar = async (ids, a) => { avisos.push({ ids: [...ids], titulo: a.titulo }); return {}; }; });
afterEach(() => { push.enviar = enviar; contadores.olvidar(); });

const LV = [1, 2, 3, 4, 5];
const base = { laborables: LV, festivos: new Set(), tope: 1.84 };

test('generan 0,084 por cada día de lunes a viernes, aunque sea festivo, con el tope de 1,84 al mes', () => {
  // Enero de 2026 tiene 22 días de lunes a viernes (22 × 0,084 = 1,85 → 1,84); febrero, 20 (1,68).
  const s = vac._saldoDe({ ...base, alta: '2025-06-01', hoy: '2026-02-28', festivos: new Set(['2026-01-01', '2026-01-06']) });
  assert.equal(s.inicio, '2026-01-01', 'quien entró antes de 2026 empieza el 01/01/2026');
  assert.deepEqual(s.meses.map(m => [m.mes, m.dias, m.generadas, m.tope]), [['2026-01', 22, 1.84, true], ['2026-02', 20, 1.68, false]],
    'los festivos (01/01 y 06/01) también generan');
  assert.equal(s.generadas, 3.52);
  const sinAlta = vac._saldoDe({ ...base, alta: null, hoy: '2026-02-28' });
  assert.deepEqual([sinAlta.generadas, sinAlta.saldo, sinAlta.inicio], [0, 0, null], 'sin fecha de alta no genera');
});

test('gastan las aprobadas sin sus dos días de libranza ni festivos; las pedidas no restan; las futuras, programadas', () => {
  const vacaciones = [
    { id: 1, desde: '2026-04-06', hasta: '2026-04-19', libra_dias: [6, 7], estado: 'aprobada' },   // 14 días, 10 laborables
    { id: 2, desde: '2026-12-21', hasta: '2026-12-27', libra_dias: [6, 7], estado: 'aprobada' },   // 25/12 festivo: gasta 4
    { id: 3, desde: '2026-06-01', hasta: '2026-06-05', libra_dias: [6, 7], estado: 'pedida' },
    { id: 4, desde: '2026-05-04', hasta: '2026-05-08', libra_dias: [6, 7], estado: 'rechazada' },
  ];
  const s = vac._saldoDe({ ...base, alta: '2026-01-01', hoy: '2026-05-31', festivos: new Set(['2026-12-25']), vacaciones });
  assert.deepEqual([s.disfrutadas, s.programadas, s.pedidas], [10, 4, 5]);
  assert.equal(s.saldo, Math.round((s.generadas - 10) * 100) / 100);
  assert.equal(s.saldoTras, Math.round((s.saldo - 4) * 100) / 100);
  assert.equal(s.meses.find(m => m.mes === '2026-04').gastadas, 10, 'y en su mes');
  // Quien libra lunes y martes gasta el sábado y el domingo.
  const otra = vac._saldoDe({ ...base, alta: '2026-01-01', hoy: '2026-05-31',
    vacaciones: [{ id: 5, desde: '2026-05-04', hasta: '2026-05-10', libra_dias: [1, 2], estado: 'aprobada' }] });
  assert.equal(otra.disfrutadas, 5);
});

test('el simulador suma lo que aún generará hasta el día antes de irse («hoy tengo 10 … el otro mes, 11,84»)', () => {
  // Hasta el 30/06/2026: enero 1,84, febrero 1,68, marzo 1,84, abril 1,84, mayo 21 × 0,084 = 1,76, junio 1,84 = 10,80.
  const s = vac._saldoDe({ ...base, alta: '2026-01-01', hoy: '2026-06-30' });
  assert.equal(s.saldo, 10.8);
  // Del 03/08 (lunes) al 14/08: julio entero se genera antes (23 días → 1,84) y el 01-02/08 es fin de semana.
  const sim = vac._simularSobre(s, { desde: '2026-08-03', hasta: '2026-08-14', libra: [6, 7], hoy: '2026-06-30', festivos: new Set() });
  assert.deepEqual([sim.naturales, sim.cuentan, sim.libranzas], [12, 10, 2]);
  assert.deepEqual([sim.saldoHoy, sim.generaraHastaEntonces, sim.disponible, sim.quedaria], [10.8, 1.84, 12.64, 2.64]);
  // Si empiezan mañana, no hay nada más que generar.
  const ya = vac._simularSobre(s, { desde: '2026-07-01', hasta: '2026-07-03', libra: [6, 7], hoy: '2026-06-30', festivos: new Set() });
  assert.deepEqual([ya.generaraHastaEntonces, ya.disponible, ya.nuevos], [0, 10.8, 3]);
  assert.deepEqual(vac._dosDias(null, LV), [6, 7], 'por defecto libra los dos días que no son del horario');
  assert.throws(() => vac._dosDias([3], LV), /dos días/);
});

async function oficina({ fabrica, consulta }) {
  const jefe = await fabrica.usuario({ nombre: 'Ignacia' });
  const ana = await fabrica.usuario({ nombre: 'Ana' });
  const luis = await fabrica.usuario({ nombre: 'Luis' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/usuarios')`, [jefe.id]);
  const firma = { usuarioId: jefe.id, origen: 'usuarios' };
  return { jefe: { id: jefe.id, rol: 'oficina' }, ana: { id: ana.id, rol: 'oficina' }, luis: { id: luis.id, rol: 'oficina' }, firma };
}

test('la fecha de alta la pone quien lleva Usuarios; sin ella no se simula; cada uno ve las suyas', () => conBase(async h => {
  const p = await oficina(h);
  const hoy = calendario.hoy();
  const desde = calendario.sumarDias(hoy, 14), hasta = calendario.sumarDias(hoy, 20);
  const mias = await vac.mias(p.ana);
  assert.deepEqual([mias.alta, mias.generadas, mias.aprueba], [null, 0, false]);
  await assert.rejects(vac.simular(p.ana, { desde, hasta }), e => e.status === 409 && /fecha de alta/.test(e.message));
  assert.equal(await usuarios.fijarFechaAlta(p.ana.id, '2026-01-01', p.firma), '2026-01-01');
  await assert.rejects(usuarios.fijarFechaAlta(p.ana.id, 'ayer', p.firma), /aaaa-mm-dd/);
  assert.equal((await usuarios.fechasDeAlta()).porId.get(p.ana.id), '2026-01-01');
  assert.ok((await vac.mias(p.ana)).generadas > 0);
  assert.equal((await vac.mias(p.jefe)).aprueba, true, 'quien tiene la llave de Usuarios aprueba');
  await assert.rejects(vac.de(p.luis, p.ana.id), e => e.status === 403, 'Luis no ve las de Ana');
  await assert.rejects(vac.lista(p.luis), e => e.status === 403);
  assert.equal((await vac.de(p.jefe, p.ana.id)).id, p.ana.id);
  assert.ok((await vac.lista(p.jefe)).filas.some(x => x.id === p.ana.id));
  assert.equal((await vac.de({ id: p.luis.id, rol: 'desarrollador' }, p.ana.id)).id, p.ana.id, 'y el desarrollador');
}));

test('pedir, aprobar, no aprobar, retirar y anular: pedidas no restan, aprobadas sí; avisa a quien toca', () => conBase(async h => {
  const p = await oficina(h);
  await usuarios.fijarFechaAlta(p.ana.id, '2026-01-01', p.firma);
  const hoy = calendario.hoy();
  const lunes = d => { let x = d; while (calendario.diaSemana(x) !== 1) x = calendario.sumarDias(x, 1); return x; };
  const a = lunes(calendario.sumarDias(hoy, 20)), b = calendario.sumarDias(a, 4);   // de lunes a viernes

  const r = await vac.pedir(p.ana, { desde: a, hasta: b, libra: [6, 7], nota: 'Viaje' });
  assert.deepEqual(avisos.map(x => [x.ids, x.titulo]), [[[p.jefe.id], 'Vacaciones por aprobar']], 'a quien tiene la llave');
  let mias = await vac.mias(p.ana);
  assert.deepEqual([mias.pedidas, mias.programadas], [r.simulacion.cuentan, 0], 'pedidas: no restan');
  await assert.rejects(vac.pedir(p.ana, { desde: a, hasta: b }), e => e.status === 409, 'no se pide dos veces lo mismo');
  await assert.rejects(vac.pedir(p.ana, { desde: calendario.sumarDias(hoy, -3), hasta: hoy }), /de hoy en adelante/);
  await assert.rejects(vac.aprobar(p.luis, r.id), e => e.status === 403, 'Luis no aprueba');
  const enMenu = await contadores.recuentos({ id: p.jefe.id, rol: 'oficina', permisos: [] });
  assert.equal(enMenu['vacaciones_oficina.pedidas'].n, 1, 'el número del menú de quien aprueba');

  avisos = [];
  await vac.aprobar(p.jefe, r.id);
  assert.deepEqual(avisos.map(x => [x.ids, x.titulo]), [[[p.ana.id], 'Vacaciones aprobadas']]);
  mias = await vac.mias(p.ana);
  assert.deepEqual([mias.pedidas, mias.programadas, mias.saldoTras], [0, r.simulacion.cuentan, Math.round((mias.saldo - r.simulacion.cuentan) * 100) / 100]);
  await assert.rejects(vac.retirar(p.ana, r.id), e => e.status === 409, 'aprobadas ya no se retiran');
  await assert.rejects(vac.anular(p.jefe, r.id, { motivo: '' }), /por qué/);
  await vac.anular(p.jefe, r.id, { motivo: 'Cierre de mes' });
  assert.equal((await vac.mias(p.ana)).programadas, 0);

  // Otra: no aprobada, con motivo; y una tercera que retira ella.
  const c = lunes(calendario.sumarDias(a, 14));
  const r2 = await vac.pedir(p.ana, { desde: c, hasta: calendario.sumarDias(c, 1) });
  await assert.rejects(vac.rechazar(p.jefe, r2.id, { motivo: 'no' }), /por qué/);
  await vac.rechazar(p.jefe, r2.id, { motivo: 'Coincide con otra persona' });
  const r3 = await vac.pedir(p.ana, { desde: c, hasta: calendario.sumarDias(c, 1) });
  await assert.rejects(vac.retirar(p.luis, r3.id), e => e.status === 403, 'solo retira las suyas');
  await vac.retirar(p.ana, r3.id);
  const estados = (await vac.mias(p.ana)).vacaciones.map(v => v.estado);
  assert.deepEqual(estados.sort(), ['anulada', 'anulada', 'rechazada']);
  const libro = (await h.consulta(`SELECT count(*)::int n FROM auditoria WHERE tabla = 'oficina_vacacion'`)).rows[0].n;
  assert.ok(libro >= 6, 'todo queda en el libro');
}));
