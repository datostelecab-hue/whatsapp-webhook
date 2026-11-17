// ============================================================
// LAS VACACIONES DE LA OFICINA (db/263, 17/11/2026)
// ============================================================
// Lo que decidió Camilo:
//   · cada mes completo genera 1,84 justos (un parámetro), tenga los días
//     laborables que tenga; el que va en curso, el promedio (1,84 entre los
//     21,74 días de un mes medio: 0,0846) por cada día de lunes a viernes,
//     aunque sea festivo o esté de vacaciones;
//   · gastan los días de unas vacaciones aprobadas que no son sus dos días de
//     libranza ni festivos;
//   · el simulador suma lo que aún generará hasta el día antes de irse («hoy
//     tengo 10, pero si empiezo el otro mes las vacaciones, debe de contarme
//     11,84»), y cada día del calendario suma al banco con los días reales;
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

test('cada mes completo genera 1,84 justos (se pase o no llegue); el que va en curso, 0,0846 por día de lunes a viernes', () => {
  assert.equal(Math.round(vac._tasaDe(1.84, LV) * 10000) / 10000, 0.0846, '1,84 entre los 21,74 días de un mes medio');
  // Enero de 2026 tiene 22 días de lunes a viernes (pasaría de 1,84); febrero, 20 (no llegaría).
  const s = vac._saldoDe({ ...base, alta: '2025-06-01', hoy: '2026-02-28', festivos: new Set(['2026-01-01', '2026-01-06']) });
  assert.equal(s.inicio, '2026-01-01', 'quien entró antes de 2026 empieza el 01/01/2026');
  assert.deepEqual(s.meses.map(m => [m.mes, m.dias, m.generadas, m.completo]), [['2026-01', 22, 1.84, true], ['2026-02', 20, 1.84, true]]);
  assert.equal(s.generadas, 3.68);
  // Alta el 15/01: enero, 12 días × 0,0846 = 1,02; febrero va por el 10, 7 días = 0,59.
  const mitad = vac._saldoDe({ ...base, alta: '2026-01-15', hoy: '2026-02-10' });
  assert.deepEqual(mitad.meses.map(m => [m.mes, m.dias, m.generadas, m.completo]), [['2026-01', 12, 1.02, false], ['2026-02', 7, 0.59, false]]);
  assert.equal(mitad.generadas, 1.61);
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

test('el simulador suma lo que generará hasta irse y durante las vacaciones, con los días reales («el otro mes, 11,84»)', () => {
  // Hasta el 30/06/2026, seis meses completos: 6 × 1,84 = 11,04.
  const s = vac._saldoDe({ ...base, alta: '2026-01-01', hoy: '2026-06-30' });
  assert.equal(s.saldo, 11.04);
  // Del 03/08 (lunes) al 14/08: julio completo se genera antes (+1,84; el 01-02/08 es fin de semana).
  const sim = vac._simularSobre(s, { desde: '2026-08-03', hasta: '2026-08-14', libra: [6, 7], hoy: '2026-06-30', festivos: new Set() });
  assert.deepEqual([sim.naturales, sim.cuentan, sim.libranzas], [12, 10, 2]);
  assert.deepEqual([sim.saldoHoy, sim.generaraHastaEntonces, sim.disponible, sim.quedaria], [11.04, 1.84, 12.88, 2.88]);
  // Y en las vacaciones genera sus 10 días laborables a 0,0846: al volver, 3,73.
  assert.deepEqual([sim.alVolver, sim.generaDurante], [3.73, 0.85]);
  assert.deepEqual(sim.dias.slice(0, 7).map(d => d.banco), [11.96, 11.05, 10.13, 9.22, 8.3, 8.3, 8.3],
    'el banco de cada día: + 0,0846 − 1 los laborables; el fin de semana, igual');
  // A mitad de mes (15/06: 11 días, 0,93): si se va el 01/07, junio se completa (+0,91).
  const mitad = vac._saldoDe({ ...base, alta: '2026-01-01', hoy: '2026-06-15' });
  const julio = vac._simularSobre(mitad, { desde: '2026-07-01', hasta: '2026-07-03', libra: [6, 7], hoy: '2026-06-15', festivos: new Set() });
  assert.deepEqual([mitad.saldo, julio.generaraHastaEntonces, julio.disponible], [10.13, 0.91, 11.04]);
  // Si empiezan mañana, no hay nada más que generar antes.
  const ya = vac._simularSobre(s, { desde: '2026-07-01', hasta: '2026-07-03', libra: [6, 7], hoy: '2026-06-30', festivos: new Set() });
  assert.deepEqual([ya.generaraHastaEntonces, ya.disponible, ya.nuevos], [0, 11.04, 3]);
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

test('«Vacaciones por meses» de la oficina: quién se va y cuándo, solo para quien aprueba', () => conBase(async h => {
  const p = await oficina(h);
  await usuarios.fijarFechaAlta(p.ana.id, '2026-01-01', p.firma);
  const hoy = calendario.hoy();
  const a = calendario.sumarDias(hoy, 3), b = calendario.sumarDias(hoy, 5);
  const r = await vac.pedir(p.ana, { desde: a, hasta: b, libra: [6, 7] });
  await assert.rejects(vac.calendarioOficina(p.ana), e => e.status === 403, 'solo quien aprueba');
  const c = await vac.calendarioOficina(p.jefe);
  assert.equal(c.hoy, hoy);
  assert.equal(c.desde, '2026-01');
  assert.deepEqual(c.periodos.filter(x => x.id === p.ana.id).map(x => [x.desde, x.hasta, x.pendiente, x.libra]), [[a, b, true, [6, 7]]], 'las que esperan, también, con su libranza');
  assert.ok(c.sinVacaciones.some(x => x.id === p.luis.id), 'quien no tiene ni un día, en la lista de a quién le toca');
  assert.ok(!c.sinVacaciones.some(x => x.id === p.ana.id), 'quien ya pidió, no');
  assert.ok(c.personas.some(x => x.id === p.ana.id), 'las personas, para abrir su ficha');
  assert.ok(c.festivos.includes('2026-12-25') && c.festivos.includes(`${Number(hoy.slice(0, 4)) + 1}-01-01`), 'los festivos, y el 1 de enero del año que viene aunque no esté cargado');
  await vac.rechazar(p.jefe, r.id, { motivo: 'Coincide con el cierre' });
  const otra = await vac.calendarioOficina(p.jefe);
  assert.deepEqual(otra.periodos.filter(x => x.id === p.ana.id), [], 'las no aprobadas ya no salen');
}));

test('la previsión de una petición: del 24/12 al 12/01 gasta 12; al irse tendrá 11,49 y al volver le sobran 0,56 (en verde); si se alarga, se pasa (en rojo)', () => {
  // El caso de Camilo (17/11/2026): alta el 17/06/2026, hoy 9,22.
  const e = { hoy: '2026-11-17', festivos: new Set(['2026-12-07', '2026-12-08', '2026-12-25', '2027-01-01']) };
  const v = { id: 1, desde: '2026-12-24', hasta: '2027-01-12', libra_dias: [6, 7], estado: 'pedida' };
  const s = vac._saldoDe({ ...base, ...e, alta: '2026-06-17', vacaciones: [v] });
  assert.equal(s.saldo, 9.22);
  const pv = vac._previsionDe(s, v, { ...e, laborables: LV });
  assert.deepEqual([pv.gasta, pv.alIrse, pv.alVolver, pv.sePasa], [12, 11.49, 0.56, false], 'cuadra contando lo que genera durante las vacaciones');
  const larga = { ...v, hasta: '2027-01-29' };
  const s2 = vac._saldoDe({ ...base, ...e, alta: '2026-06-17', vacaciones: [larga] });
  const pv2 = vac._previsionDe(s2, larga, { ...e, laborables: LV });
  assert.deepEqual([pv2.gasta, pv2.sePasa, pv2.alVolver], [25, true, -11.34], 'se pasa 11,34 días');
});

test('registrar unas ya disfrutadas: del 20 al 30 de agosto son 7 días, y se restan de las de hoy', () => conBase(async h => {
  const p = await oficina(h);
  await usuarios.fijarFechaAlta(p.ana.id, '2026-01-01', p.firma);
  const antes = await vac.mias(p.ana);
  await assert.rejects(vac.registrar(p.ana, { usuarioId: p.ana.id, desde: '2026-08-20', hasta: '2026-08-30' }), e => e.status === 403, 'solo quien aprueba');
  avisos = [];
  const r = await vac.registrar(p.jefe, { usuarioId: p.ana.id, desde: '2026-08-20', hasta: '2026-08-30', libra: [6, 7], nota: 'Agosto' });
  assert.equal(r.dias, 7, 'jueves 20 y viernes 21, y del lunes 24 al viernes 28: los sábados y domingos no cuentan');
  assert.deepEqual(avisos.map(x => [x.ids, x.titulo]), [[[p.ana.id], 'Vacaciones registradas']], 'le llega a quien se las registran');
  const despues = await vac.mias(p.ana);
  assert.equal(despues.disfrutadas, antes.disfrutadas + 7);
  assert.equal(despues.saldo, Math.round((antes.saldo - 7) * 100) / 100, 'se restan de las que tiene hoy');
  assert.equal(despues.vacaciones.find(v => v.id === r.id).estado, 'aprobada', 'entran ya aprobadas');
  await assert.rejects(vac.registrar(p.jefe, { usuarioId: p.ana.id, desde: '2026-08-24', hasta: '2026-08-26' }), e => e.status === 409, 'no encima de otras');
  const hoy = calendario.hoy();
  await assert.rejects(vac.registrar(p.jefe, { usuarioId: p.ana.id, desde: hoy, hasta: calendario.sumarDias(hoy, 3) }), /se piden/, 'las que vienen se piden');
  await assert.rejects(vac.registrar(p.jefe, { usuarioId: p.ana.id, desde: '2025-12-20', hasta: '2025-12-24' }), /empieza el 01.01.2026/, 'antes de 2026 no cuenta');
}));

test('con la base: un festivo de la oficina no gasta vacaciones (el calendario trae sus festivos)', () => conBase(async h => {
  const p = await oficina(h);
  await usuarios.fijarFechaAlta(p.ana.id, '2026-01-01', p.firma);
  const cal = await calendario.de('madrid');
  assert.ok(cal.festivos instanceof Set && cal.festivos.has('2026-12-25'), 'el calendario expone sus festivos');
  const sim = await vac.simular(p.ana, { desde: '2026-12-21', hasta: '2026-12-27', libra: [6, 7] });
  assert.deepEqual([sim.naturales, sim.libranzas, sim.festivos, sim.cuentan], [7, 2, 1, 4], 'el 25/12 no gasta');
  // Cruzando el año: el 1 de enero es festivo seguro, esté cargado el año o no.
  const fin = await vac.simular(p.ana, { desde: '2026-12-28', hasta: '2027-01-03', libra: [6, 7] });
  assert.deepEqual([fin.naturales, fin.libranzas, fin.festivos, fin.cuentan], [7, 2, 1, 4], 'el 1/1 tampoco gasta');
}));
