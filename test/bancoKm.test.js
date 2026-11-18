// ============================================================
// EL BANCO DE KM (db/267, 18/11/2026)
// ============================================================
// Camilo: «un límite de 17,5 km por fuera desconectado al día, por cada uno; si
// descansa no se le suma al límite… si se programó otro día de la nada entonces
// son 6 días y el límite sube a 105; esto también aplica a los NN».
//
//   · pura: qué suma al límite (le tocaba, salió sin tocarle; la libranza, la
//     oficina y Barcelona no), los km fuera coche a coche, el lunes de la semana
//     y cuándo se cierra una jornada;
//   · con la base: la foto de una jornada se guarda y se rehace sin duplicar, y
//     la semana suma el límite y los km de cada uno y reparte los de cada coche.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const banco = require('../modules/Operaciones/bancoKm.service');

after(() => banco._conReporte(null));

// Las filas como las da el reporte de Control (reporteDia con conKmFuera).
const fila = (o = {}) => ({
  persona: 'c1', conductorId: null, nombre: 'Uno', turno: 'Día', horas: 0, debiaSalir: false, deOficina: false,
  esJ: false, kmDesc: 0, kmFueraPorCoche: {}, fichaje: '', sinFichar: false, otraSede: null, ...o,
});

test('lo que suma al límite: le tocaba (saliera o no) o salió sin tocarle; la libranza, la oficina y Barcelona no', () => {
  const { filas, coches } = banco._filasDelDia([
    fila({ persona: 'c1', debiaSalir: true, horas: 9.2, kmDesc: 12.34, kmFueraPorCoche: { '1234ABC': 12.34 } }),
    fila({ persona: 'c2', debiaSalir: true, horas: 0 }),                                   // le tocaba y no salió
    fila({ persona: 'c3', debiaSalir: false, horas: 6, kmDesc: 3 }),                        // NN: salió sin tocarle
    fila({ persona: 'c4', debiaSalir: false, horas: 0, kmDesc: 20, kmFueraPorCoche: { '5678DEF': 20 } }),   // libraba y el coche anduvo
    fila({ persona: 'u9', deOficina: true, kmDesc: 4, kmFueraPorCoche: { '1234ABC': 4 } }),  // un viaje de la oficina
    fila({ persona: 'c5', debiaSalir: true, horas: 8, kmDesc: 'Barcelona', otraSede: 'Barcelona' }),
    fila({ persona: 'c6', debiaSalir: true, horas: 7, kmDesc: 'REVISAR' }),
    fila({ persona: 'c7', debiaSalir: false, horas: 0, kmDesc: 0 }),                         // libraba y nada: fuera
    fila({ persona: 'c8', debiaSalir: true, esJ: true }),                                    // le tocaba, con una J
  ], 17.5);
  const de = p => filas.find(f => f.persona === p);
  assert.deepEqual(filas.map(f => f.persona), ['c1', 'c2', 'c3', 'c4', 'u9', 'c6', 'c8']);
  assert.deepEqual([de('c1').limite_km, de('c1').km_fuera], [17.5, 12.3]);
  assert.equal(de('c2').limite_km, 17.5, 'le tocaba aunque no saliera');
  assert.equal(de('c3').limite_km, 17.5, 'el NN también suma');
  assert.deepEqual([de('c4').limite_km, de('c4').km_fuera], [0, 20], 'libraba: no suma, pero sus km sí gastan');
  assert.equal(de('u9').limite_km, 0, 'la oficina no tiene banco');
  assert.deepEqual([de('c6').km_fuera, de('c6').revisar], [0, true]);
  assert.deepEqual([de('c8').limite_km, de('c8').justificado], [17.5, true]);
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
  // Cinco días le tocan a cada uno; Hamza sale además el sábado sin tocarle.
  const reportes = {};
  const lunes = '2026-11-02';
  for (let i = 0; i < 7; i++) {
    const d = `2026-11-0${2 + i}`;
    const tocaC = i < 5, tocaH = i < 5;
    reportes[d] = [
      fila({ persona: C, conductorId: carlos.id, nombre: 'Carlos', turno: 'Día', debiaSalir: tocaC, horas: tocaC ? 9 : 0,
        kmDesc: tocaC ? 2 : 0, kmFueraPorCoche: tocaC ? { '1111AAA': 2 } : {} }),
      fila({ persona: H, conductorId: hamza.id, nombre: 'Hamza', turno: 'Noche', debiaSalir: tocaH, horas: tocaH || i === 5 ? 9 : 0,
        kmDesc: tocaH || i === 5 ? 20 : 0, kmFueraPorCoche: tocaH || i === 5 ? { '1111AAA': 18, '2222BBB': 2 } : {} }),
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
  await assert.rejects(banco.calcularDia('2026-11-12', { ahora }), /cerrada/, 'el mismo día no está cerrado');
  await assert.rejects(banco.calcularDia('2026-10-20', { ahora }), /empieza/);

  const s = await banco.semana(lunes);
  const c = s.conductores.find(x => x.persona === C), h = s.conductores.find(x => x.persona === H);
  assert.deepEqual([c.programados, c.extra, c.limite, c.km, c.saldo, c.estado], [5, 0, 87.5, 10, 77.5, 'dentro']);
  assert.deepEqual([h.programados, h.extra, h.limite, h.km, h.saldo, h.estado], [5, 1, 105, 120, -15, 'pasado'],
    'seis días (uno sin tocarle): 105 km de límite, y se pasó');
  assert.equal(s.conductores[0].persona, H, 'el más pasado, primero');
  const coche = s.coches.find(x => x.matricula === '1111AAA');
  assert.equal(coche.km, 118);
  assert.deepEqual(coche.personas.map(p => [p.persona, p.pct]), [[H, 92], [C, 8]], 'de quién son sus km fuera, en %');
  assert.equal((await banco.historia(H, '2026-11-08')).semanas[0].saldo, -15);
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
