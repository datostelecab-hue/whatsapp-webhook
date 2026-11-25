// ============================================================
// LA COMUNICACIÓN SEMANAL DE HORAS (db/294, 25/11/2026)
// ============================================================
// Camilo: «siempre es cuando el trabajador no cumple con las horas que debe de
// hacer en la semana: si faltó un día, pero hizo 41 horas en la semana, pues
// está bien, nada de carta». «Siempre son 8». Solo propia. Cada martes. Sin
// SMS, por correo; sin email, que se diga.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const cuenta = require('../modules/RRHH/comunicaciones');
const comunicaciones = require('../modules/RRHH/comunicaciones.service');
const firmas = require('../modules/RRHH/firmas.service');

// La semana del lunes 16 al domingo 22 de noviembre de 2026.
const DIAS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const semana = (horas, extra = {}) => DIAS.map((dia, i) => ({
  dia, horas: horas[i] == null ? 0 : horas[i], marca: null, fuera: false, situacion: false, sinPlaza: false,
  clase: horas[i] === 'L' ? null : (horas[i] > 0 ? 'trabajado' : 'ausencia'), ...(extra[dia] || {}),
})).map(d => (d.horas === 'L' ? { ...d, horas: 0, marca: 'L' } : d));

test('la cuenta: 8 h por día planificado, lo que compensa, lo que no se pide', () => {
  // 5 días de trabajo y 2 libranzas: se le piden 40. Falta el lunes, se queda corto el miércoles: debe 8 + 2,7 = 10,7.
  const a = cuenta.calcular({ dias: semana([0, 8, 5.3, 8, 8, 'L', 'L']), alta: '2026-01-01' });
  assert.deepEqual([a.objetivo, a.horas, a.debe, a.carta], [40, 29.3, 10.7, true]);
  assert.deepEqual(a.lineas.map(l => [l.dia, l.tipo, l.debe]), [['2026-11-16', 'ausencia', 8], ['2026-11-18', 'menos', 2.7]]);
  // Camilo: «si tenía planificado 4 días para salir y 3 de descanso, 32 horas, sin importar el contrato».
  const cuatro = cuenta.calcular({ dias: semana([7.8, 8.1, 8, 7.4, 'L', 'L', 'L']), alta: '2026-01-01' });
  assert.deepEqual([cuatro.objetivo, cuatro.debe, cuatro.carta], [32, 0.7, false], 'por debajo de 2 h no hay carta');
  const cuatroMal = cuenta.calcular({ dias: semana([0, 8, 6, 8, 'L', 'L', 'L']), alta: '2026-01-01' });
  assert.deepEqual([cuatroMal.objetivo, cuatroMal.debe, cuatroMal.carta], [32, 10, true]);
  // Faltó un día pero hizo 41 h: nada.
  const b = cuenta.calcular({ dias: semana([0, 10, 10, 11, 10, 'L', 'L']), alta: '2026-01-01' });
  assert.deepEqual([b.debe, b.carta, b.lineas], [0, false, []]);
  // Un día largo compensa: el total es lo que debe en la semana, no la suma de los días.
  const c = cuenta.calcular({ dias: semana([6, 6, 6, 6, 12, 'L', 'L']), alta: '2026-01-01' });
  assert.equal(c.debe, 4);
  // Más libranzas de la cuenta: lo que el cuadrante no le dio no se le pide.
  assert.deepEqual(cuenta.calcular({ dias: semana([8, 7, 'L', 'L', 'L', 'L', 'L']), alta: '2026-01-01' }).objetivo, 16);
  // Vacaciones y lo justificado por RR. HH. no se piden.
  const d = cuenta.calcular({ dias: semana([0, 0, 8, 8, 8, 'L', 'L'], { '2026-11-16': { marca: 'V', clase: null }, '2026-11-17': { marca: 'V', clase: null } }),
    alta: '2026-01-01' });
  assert.deepEqual([d.objetivo, d.debe], [24, 0]);
  const e = cuenta.calcular({ dias: semana([0, 8, 8, 8, 8, 'L', 'L']), alta: '2026-01-01', justificadas: new Set(['2026-11-16']) });
  assert.equal(e.debe, 0, 'la ausencia que RR. HH. justificó no se debe');
  // Entra el jueves: solo los días con contrato.
  const f = cuenta.calcular({ dias: semana([0, 0, 0, 8, 0, 'L', 'L'], Object.fromEntries(DIAS.slice(0, 3).map(x => [x, { fuera: true, clase: null }]))),
    alta: '2026-11-19' });
  assert.deepEqual([f.objetivo, f.debe], [16, 8]);
  // Los huecos de la plantilla.
  assert.deepEqual(cuenta.textos(a), { incidencias: '• 16 de noviembre de 2026 – 8 horas\n• 18 de noviembre de 2026 – 2,7 horas', total: '10,7 h' });
  assert.deepEqual(cuenta.semanaDe('2026-11-19'), { lunes: '2026-11-16', domingo: '2026-11-22' });
});

test('el martes: a la cola de Firmas, sin PDF ni SMS; sin email no se aprueba y lo dice', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/firmas'), ($1, '/firmas/aprobar')`, [diana.id]);
  const D = { usuarioId: diana.id, rol: 'oficina' };
  const corto = await fabrica.conductor({ nombre: 'CORTO' });
  const cumple = await fabrica.conductor({ nombre: 'CUMPLE' });
  const ett = await fabrica.conductor({ nombre: 'DE ETT', tipo: 'ett' });
  await consulta(`UPDATE conductor SET email = 'corto@ejemplo.test' WHERE id = $1`, [corto.id]);
  const dias = new Map([
    [String(corto.id), semana([0, 8, 5.3, 8, 8, 'L', 'L'])],
    [String(cumple.id), semana([0, 10, 10, 11, 10, 'L', 'L'])],
    [String(ett.id), semana([0, 0, 0, 0, 0, 'L', 'L'])],
  ]);
  const r = await comunicaciones.prepararSemana('2026-11-16', { dias });
  assert.equal(r.nuevas, 1, 'solo el de propia que no llegó');
  assert.equal((await comunicaciones.prepararSemana('2026-11-16', { dias })).nuevas, 0, 'repetirlo no duplica');
  const env = (await consulta(`SELECT id::text AS id, tipo, estado, detalle FROM firma_envio WHERE conductor_id = $1`, [corto.id])).rows[0];
  assert.deepEqual([env.tipo, env.estado, env.detalle.debe, env.detalle.total], ['comunicacion', 'borrador', 10.7, '10,7 h']);
  assert.ok((await consulta(`SELECT 1 FROM tarea WHERE tipo = 'comunicaciones_semana' AND origen_id = '2026-11-16' AND estado <> 'cerrada'`)).rows.length);

  // Sin PDF y sin móvil se aprueba (plantilla, sin SMS). La tarjeta de la semana se cierra sola.
  const a = await firmas.aprobarVarias({ ids: [env.id] }, D);
  assert.deepEqual([a.aprobadas, a.fallos.length], [1, 0]);
  assert.equal((await consulta(`SELECT estado FROM tarea WHERE tipo = 'comunicaciones_semana' AND origen_id = '2026-11-16'`)).rows[0].estado, 'cerrada');
  const p = (await firmas.delBot.pendientes()).find(x => x.id === env.id);
  assert.equal(p.detalle.incidencias.split('\n').length, 2);

  // Sin email: no se aprueba, y dice que se ponga el correo del conductor.
  await consulta(`UPDATE conductor SET email = NULL WHERE id = $1`, [cumple.id]);
  const sinEmail = new Map([[String(cumple.id), semana([0, 0, 8, 8, 8, 'L', 'L'])]]);
  await comunicaciones.prepararSemana('2026-11-16', { dias: sinEmail });
  const env2 = (await consulta(`SELECT id::text AS id, nota FROM firma_envio WHERE conductor_id = $1`, [cumple.id])).rows[0];
  assert.match(env2.nota, /Falta el email del conductor/);
  const b = await firmas.aprobarVarias({ ids: [env2.id] }, D);
  assert.equal(b.aprobadas, 0);
  assert.match(b.fallos[0].motivo, /falta el email del conductor/);
}));
