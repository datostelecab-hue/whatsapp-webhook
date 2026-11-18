// ============================================================
// EL BANCO DE KM (db/267, 18/11/2026)
// ============================================================
// Camilo, 18/11/2026: «cada hora de viaje en BOLT genera 8,8 km por fuera en el
// banco, con un límite de 53 km al día… si hago 3 horas de viaje ese día puedo
// gastar 26,4 km por fuera; si tengo 50 km por fuera pero con 28 justificados…
// entonces hice 22 km por fuera, y me quedan 4,4 km generados para la semana»
// (db/268; antes, db/267, eran 17,5 km por día que tocaba).
//
//   · pura: lo que genera cada día (8,8 por hora de viaje, tope 53; la oficina y
//     Barcelona no), los km fuera coche a coche, el lunes de la semana y cuándo
//     se cierra una jornada;
//   · con la base: la foto de una jornada se guarda y se rehace sin duplicar; la
//     semana suma lo generado y lo gastado de cada uno y reparte lo de cada
//     coche; lo justificado y aprobado no cuenta (lo pendiente, sí); un día
//     calculado con la regla anterior vuelve a estar pendiente.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const banco = require('../modules/Operaciones/bancoKm.service');
const kmj = require('../services/repo/kmJustificacion');
const justificantes = require('../modules/Control/justificantes.service');
const permisos = require('../services/permisos');

after(() => banco._conReporte(null));

// Las filas como las da el reporte de Control (reporteDia con conKmFuera).
const fila = (o = {}) => ({
  persona: 'c1', conductorId: null, nombre: 'Uno', turno: 'Día', horas: 0, horasViaje: 0, debiaSalir: false, deOficina: false,
  esJ: false, kmDesc: 0, kmFueraPorCoche: {}, fichaje: '', sinFichar: false, otraSede: null, ...o,
});
const REGLA = { kmHora: 8.8, tope: 53 };

test('lo que genera un día: 8,8 km por hora de viaje, con tope de 53; la espera, la oficina y Barcelona no', () => {
  assert.deepEqual([0, 1, 3, 6, 7].map(h => banco._generado(h, REGLA)), [0, 8.8, 26.4, 52.8, 53]);
  const { filas, coches } = banco._filasDelDia([
    fila({ persona: 'c1', debiaSalir: true, horas: 9.2, horasViaje: 3, kmDesc: 12.34, kmFueraPorCoche: { '1234ABC': 12.34 } }),
    fila({ persona: 'c2', debiaSalir: true, horas: 0 }),                                   // le tocaba y no salió: no genera
    fila({ persona: 'c3', debiaSalir: false, horas: 6, horasViaje: 1, kmDesc: 3 }),         // NN: genera por su viaje
    fila({ persona: 'c4', debiaSalir: false, horas: 0, kmDesc: 20, kmFueraPorCoche: { '5678DEF': 20 } }),   // libraba y el coche anduvo
    fila({ persona: 'u9', deOficina: true, horasViaje: 2, kmDesc: 4, kmFueraPorCoche: { '1234ABC': 4 } }),  // un viaje de la oficina
    fila({ persona: 'c5', debiaSalir: true, horas: 8, horasViaje: 5, kmDesc: 'Barcelona', otraSede: 'Barcelona' }),
    fila({ persona: 'c6', debiaSalir: true, horas: 7, horasViaje: 7.5, kmDesc: 'REVISAR' }),
    fila({ persona: 'c7', debiaSalir: false, horas: 0, kmDesc: 0 }),                         // libraba y nada: fuera
  ], REGLA);
  const de = p => filas.find(x => x.persona === p);
  assert.deepEqual(filas.map(x => x.persona), ['c1', 'c2', 'c3', 'c4', 'u9', 'c6']);
  assert.deepEqual([de('c1').limite_km, de('c1').horas_viaje, de('c1').km_fuera], [26.4, 3, 12.3], '3 h de viaje: 26,4 km');
  assert.equal(de('c2').limite_km, 0, 'sin viaje no genera, le tocara o no');
  assert.equal(de('c3').limite_km, 8.8);
  assert.deepEqual([de('c4').limite_km, de('c4').km_fuera], [0, 20], 'libraba: no genera, pero sus km sí gastan');
  assert.equal(de('u9').limite_km, 0, 'la oficina no tiene banco');
  assert.deepEqual([de('c6').limite_km, de('c6').km_fuera, de('c6').revisar], [53, 0, true], '7,5 h: el tope de 53');
  assert.deepEqual(coches, [
    { persona: 'c1', matricula: '1234ABC', km_fuera: 12.3 },
    { persona: 'c4', matricula: '5678DEF', km_fuera: 20 },
    { persona: 'u9', matricula: '1234ABC', km_fuera: 4 },
  ]);
});

test('la semana va de lunes a domingo; una jornada se cierra a las 12:00 del día siguiente (más una hora de margen)', () => {
  assert.deepEqual(['2026-11-16', '2026-11-18', '2026-11-22', '2026-11-23'].map(banco._lunesDe),
    ['2026-11-16', '2026-11-16', '2026-11-16', '2026-11-23']);
  // El miércoles 18 a las 12:30 (hora de Madrid, invierno: 11:30 UTC): la del martes aún no.
  assert.equal(banco._ultimaCerrada(new Date('2026-11-18T11:30:00Z')), '2026-11-16');
  assert.equal(banco._ultimaCerrada(new Date('2026-11-18T12:05:00Z')), '2026-11-17');
});

test('con la base: la foto de cada jornada, la semana de cada uno y la de cada coche', () => conBase(async ({ fabrica, consulta }) => {
  const carlos = await fabrica.conductor({ nombre: 'Carlos' });
  const hamza = await fabrica.conductor({ nombre: 'Hamza' });
  const C = `c${carlos.id}`, H = `c${hamza.id}`;
  // Carlos: 3 h de viaje y 2 km fuera, cinco días. Hamza: 2 h de viaje y 20 km fuera, seis días.
  const reportes = {};
  const lunes = '2026-11-02';
  for (let i = 0; i < 7; i++) {
    const d = `2026-11-0${2 + i}`;
    const salC = i < 5, salH = i < 6;
    reportes[d] = [
      fila({ persona: C, conductorId: carlos.id, nombre: 'Carlos', turno: 'Día', debiaSalir: salC, horas: salC ? 9 : 0, horasViaje: salC ? 3 : 0,
        kmDesc: salC ? 2 : 0, kmFueraPorCoche: salC ? { '1111AAA': 2 } : {} }),
      fila({ persona: H, conductorId: hamza.id, nombre: 'Hamza', turno: 'Noche', debiaSalir: i < 5, horas: salH ? 9 : 0, horasViaje: salH ? 2 : 0,
        kmDesc: salH ? 20 : 0, kmFueraPorCoche: salH ? { '1111AAA': 18, '2222BBB': 2 } : {} }),
    ];
  }
  banco._conReporte(async (d, o) => {
    assert.equal(o.conKmFuera, true, 'pide también a quien solo tiene km fuera');
    return { parcial: false, sinFichaje: null, filas: reportes[d] };
  });
  const ahora = new Date('2026-11-12T12:00:00Z');
  for (let i = 0; i < 7; i++) await banco.calcularDia(`2026-11-0${2 + i}`, { ahora });
  // Otra vez el lunes: se rehace, no se duplica.
  await banco.calcularDia(lunes, { ahora });
  assert.equal((await consulta(`SELECT count(*)::int AS n FROM km_banco_dia WHERE dia = $1`, [lunes])).rows[0].n, 2);
  assert.equal((await consulta(`SELECT version FROM km_banco_calculo WHERE dia = $1`, [lunes])).rows[0].version, banco.VERSION);
  await assert.rejects(banco.calcularDia('2026-11-12', { ahora }), /cerrada/, 'el mismo día no está cerrado');
  await assert.rejects(banco.calcularDia('2026-10-20', { ahora }), /empieza/);

  const s = await banco.semana(lunes);
  const c = s.conductores.find(x => x.persona === C), h = s.conductores.find(x => x.persona === H);
  assert.deepEqual([c.horasViaje, c.limite, c.km, c.saldo, c.estado], [15, 132, 10, 122, 'dentro'], '5 días × 26,4');
  assert.deepEqual([h.horasViaje, h.limite, h.km, h.saldo, h.estado], [12, 105.6, 120, -14.4, 'pasado'], '6 días × 17,6, y 120 km fuera');
  assert.equal(s.conductores[0].persona, H, 'el más pasado, primero');
  const coche = s.coches.find(x => x.matricula === '1111AAA');
  assert.equal(coche.km, 118);
  assert.deepEqual(coche.personas.map(p => [p.persona, p.pct]), [[H, 92], [C, 8]], 'de quién son sus km fuera, en %');
  assert.equal((await banco.historia(H, '2026-11-08')).semanas[0].saldo, -14.4);

  // Un día calculado con la regla de antes vuelve a estar pendiente (y la tarea lo pide con la versión).
  await consulta(`UPDATE km_banco_calculo SET version = 1 WHERE dia = '2026-11-03'`);
  assert.ok((await banco.pendientes(ahora)).includes('2026-11-03'));
}));

test('con la base: el ejemplo de Camilo — 3 h de viaje, 50 km fuera, 28 justificados y aprobados: gastó 22 y le quedan 4,4', () => conBase(async ({ fabrica, consulta }) => {
  const yo = await fabrica.conductor({ nombre: 'Ejemplo' });
  const P = `c${yo.id}`;
  const dia = '2026-11-04';
  banco._conReporte(async () => ({ parcial: false, sinFichaje: null, filas: [
    fila({ persona: P, conductorId: yo.id, nombre: 'Ejemplo', debiaSalir: true, horas: 8, horasViaje: 3, kmDesc: 50, kmFueraPorCoche: { '3333CCC': 50 } }),
  ] }));
  await banco.calcularDia(dia, { ahora: new Date('2026-11-12T12:00:00Z') });

  const control = await fabrica.usuario({ nombre: 'Control' });
  const william = await fabrica.usuario({ nombre: 'William' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/justificantes'), ($1, '/justificantes/km')`, [william.id]);
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/justificantes')`, [control.id]);
  permisos.invalidar(william.id); permisos.invalidar(control.id);

  // Control la apunta desde la ficha del banco: nace pendiente y no resta.
  const { id } = await banco.justificar({ persona: P, dia, km: '28', matricula: '3333CCC', motivo: 'Llevó el coche al taller' }, control.id);
  let x = (await banco.semana(dia)).conductores.find(c => c.persona === P);
  assert.deepEqual([x.limite, x.kmFuera, x.km, x.pendientes, x.saldo], [26.4, 50, 50, 28, -23.6], 'pendiente: no resta');
  // Sin la llave no se aprueba; William sí.
  await assert.rejects(justificantes.aprobarKm(id, { id: control.id, rol: 'oficina' }), e => e.status === 403);
  await justificantes.aprobarKm(id, { id: william.id, rol: 'oficina' });
  x = (await banco.semana(dia)).conductores.find(c => c.persona === P);
  assert.deepEqual([x.limite, x.kmFuera, x.justificados, x.km, x.saldo, x.estado], [26.4, 50, 28, 22, 4.4, 'cerca'],
    '«entonces hice 22 km por fuera, y me quedan 4,4 km generados para la semana»');
  assert.equal((await banco.historia(P, dia)).semanas[0].saldo, 4.4, 'las semanas de la ficha, igual');
  // En /justificantes sale en su pestaña, aprobada; anularla la deja de restar.
  const cola = await justificantes.cola({ estado: 'aprobada', tipo: 'km' }, { id: william.id, rol: 'oficina' });
  assert.deepEqual([cola.aprueba, cola.filas.length, cola.filas[0].km], [true, 1, 28]);
  await justificantes.rechazarKm(id, { id: william.id, rol: 'oficina' }, 'No era del taller');
  x = (await banco.semana(dia)).conductores.find(c => c.persona === P);
  assert.equal(x.km, 50);
  // Más justificado que km fuera: nunca por debajo de cero.
  const otra = await kmj.poner({ conductorId: yo.id, dia, km: 80, motivo: 'Prueba de tope', usuarioId: control.id });
  await kmj.aprobar(otra.id, { usuarioId: william.id });
  x = (await banco.semana(dia)).conductores.find(c => c.persona === P);
  assert.deepEqual([x.km, x.justificados], [0, 50]);
}));

// ── El desglose (18/11/2026): de dónde sale cada km de una persona ───────────
const desg = require('../modules/Operaciones/bancoKm.desglose');

test('el desglose: descanso, desconectado, por no terminar el turno (lo llevaba otro) y fichado sin BOLT', () => {
  const H = 3600 * 1000;
  // El fijo de noche (c1, cuenta cF) ficha a las 0 y no termina hasta las 10 h.
  // Su compañero (cJ) coge el coche: en espera de 1 a 2 h y desconectado de 2 a 4 h.
  const tramosCrudos = [
    { id: 1, vehiculo: 'V', cuenta: 'cJ', situacion: 'espera', desde: 1 * H, hasta: 2 * H },
    { id: 2, vehiculo: 'V', cuenta: 'cJ', situacion: 'desconectado', desde: 2 * H, hasta: null },
    { id: 3, vehiculo: 'V', cuenta: 'cF', situacion: 'descanso', desde: 5 * H, hasta: 6 * H },
    { id: 4, vehiculo: 'V', cuenta: 'cF', situacion: 'viaje', desde: 6 * H, hasta: 7 * H },
    { id: 5, vehiculo: 'V', cuenta: 'cF', situacion: 'desconectado', desde: 9 * H, hasta: null },
    { id: 6, vehiculo: 'W', cuenta: 'cJ', situacion: 'viaje', desde: 4 * H, hasta: 4.5 * H },   // cJ aparece en otro coche a las 4
  ];
  const ahora = 30 * H;
  const fines = desg.finesKm(tramosCrudos, ahora);
  assert.equal(fines.get(2), 4 * H, 'el desconectado de cJ se corta cuando aparece en otro coche');
  assert.equal(fines.get(5), 21 * H, 'sin nada que lo corte, 12 h');
  const tramos = tramosCrudos.filter(t => t.vehiculo === 'V').map(t => ({ ...t, fin: fines.get(t.id) }));
  const fichajes = [{ id: 77, dueno: 'c1', inicio: 0, fin: 10 * H }];
  // 10 km cada hora, de 0 a 12 h (odómetro; sin GPS).
  const trozos = desg.trozos({ odometro: [{ inicio: 0, fin: 12 * H, metros: 120000 }], rutas: [] }, 0, 12 * H);
  const nombres = { cJ: 'Juan', cF: 'Francisco' };
  const reparto = desg.clasificar(trozos, { tramos, fichajes, persona: 'c1', suyas: new Set(['cF']), nombreDe: c => nombres[c], ahora });
  const km = cl => Math.round([...reparto.values()].filter(x => x.causa === cl).reduce((s, x) => s + x.metros, 0) / 100) / 10;
  assert.equal(km('fichaje_abierto'), 20, 'de 2 a 4 h, Juan desconectado con su fichaje abierto');
  assert.equal([...reparto.values()].find(x => x.causa === 'fichaje_abierto').con, 'Juan');
  assert.equal(km('fichado_sin_bolt'), 40, 'de 0 a 1, de 4 a 5 y de 7 a 9 h, fichado y sin nadie en BOLT (de 9 a 10 ya está él, desconectado)');
  assert.equal(km('descanso'), 10);
  assert.equal(km('desconectado'), 30, 'de 9 a 12 h: él, desconectado (con su fichaje y después sin él)');
  // Juan no se lleva nada: lo que hizo fuera de BOLT fue con el fichaje de otro.
  assert.equal(desg.clasificar(trozos, { tramos, fichajes, persona: 'c2', suyas: new Set(['cJ']), nombreDe: c => nombres[c], ahora }).size, 0);

  // Escalado a lo que dice la foto, sumando exacto.
  const esc = desg.escalar(reparto, 45);
  assert.equal(Math.round(esc.reduce((s, x) => s + x.km, 0) * 10) / 10, 45);
  assert.deepEqual(desg.escalar(new Map(), 7.5), [{ causa: 'sin_desglose', con: null, fichajeId: null, km: 7.5 }]);
});
