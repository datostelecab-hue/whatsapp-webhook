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
