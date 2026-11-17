// ============================================================
// CALENDARIO LABORAL — días y horas hábiles (pieza A2 de la hoja de ruta)
// ============================================================
// Convención 3 de Ignacio: «Días y horas hábiles los calcula el sistema». Aquí
// van, además, los criterios de aceptación de la hoja de ruta que son pura
// cuenta de calendario (ítems 5, 7, 10 y 18): el día que se hagan esos ítems,
// solo tendrán que llamar a estas funciones.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { fijarAhora } = require('./apoyo/reloj');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const calendario = require('../services/calendario');
const parametros = require('../services/parametros');

// Un calendario de prueba: la oficina de Madrid de lunes a viernes de 9 a 18,
// con el puente de diciembre de 2026 (7 y 8), Navidad y Reyes.
const cal = calendario.atar(calendario.crear({
  festivos: ['2026-12-07', '2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06'],
  horario: { dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' },
  anos: [2026, 2027],
}));

test('un día es hábil si es de lunes a viernes y no es festivo', () => {
  assert.equal(cal.esHabil('2026-12-09'), true, 'miércoles');
  assert.equal(cal.esHabil('2026-12-07'), false, 'lunes festivo');
  assert.equal(cal.esHabil('2026-12-12'), false, 'sábado');
  assert.equal(cal.esHabil('2026-12-13'), false, 'domingo');
});

test('ítem 5: el plazo cuenta 5 días hábiles y salta fines de semana y festivos', () => {
  // Desde el jueves 03/12: vie 04 (1), [sáb, dom, lun 07 y mar 08 festivos], mié 09 (2), jue 10 (3), vie 11 (4), lun 14 (5).
  assert.equal(cal.sumarDiasHabiles('2026-12-03', 5), '2026-12-14');
  // Sin festivos por medio: una semana justa.
  assert.equal(cal.sumarDiasHabiles('2026-11-13', 5), '2026-11-20');
  assert.equal(cal.sumarDiasHabiles('2026-11-13', 0), '2026-11-13');
});

test('ítem 6: «4 días hábiles antes del corte» salta el festivo y el fin de semana', () => {
  // Antes del viernes 25/12 (festivo): jue 24 (1), mié 23 (2), mar 22 (3), lun 21 (4).
  assert.equal(cal.restarDiasHabiles('2026-12-25', 4), '2026-12-21');
});

test('ítem 7: si el 20 no es hábil, se toma el hábil anterior', () => {
  assert.equal(cal.habilEnOAntes('2026-12-20'), '2026-12-18', 'el domingo 20 → el viernes 18');
  assert.equal(cal.habilEnOAntes('2026-11-20'), '2026-11-20', 'el viernes 20 se queda');
  assert.equal(cal.habilEnODespues('2026-12-05'), '2026-12-09', 'el sábado 5 → el miércoles 9, tras el puente');
});

test('los días hábiles que quedan, y los que ya han pasado', () => {
  assert.equal(cal.diasHabilesEntre('2026-11-13', '2026-11-20'), 5);
  assert.equal(cal.diasHabilesEntre('2026-11-20', '2026-11-13'), -5);
  assert.equal(cal.diasHabilesEntre('2026-12-04', '2026-12-09'), 1, 'del viernes 4 al miércoles 9 solo cuenta el 9');
});

test('ítem 1: semáforo verde con plazo, amarillo el último día, rojo vencido', () => {
  assert.equal(cal.semaforo('2026-11-20', '2026-11-19'), 'verde');
  assert.equal(cal.semaforo('2026-11-20', '2026-11-20'), 'amarillo');
  assert.equal(cal.semaforo('2026-11-20', '2026-11-21'), 'rojo');
});

test('ítem 18: un siniestro del sábado empieza a contar las 5 horas hábiles el lunes al abrir la oficina', () => {
  // Sábado 14/11/2026 a las 10:00 de Madrid → lunes 16 de 9:00 a 14:00 (en invierno, UTC+1).
  const vence = cal.sumarHorasHabiles(new Date('2026-11-14T10:00:00+01:00'), 5);
  assert.equal(vence.toISOString(), '2026-11-16T13:00:00.000Z');
});

test('ítem 10: 24 horas hábiles de una multa urgente cruzan el fin de semana', () => {
  // Jueves 12/11 a las 16:00: jue 2 h, vie 9 h, lun 9 h → quedan 4 → martes 17 a las 13:00.
  const vence = cal.sumarHorasHabiles(new Date('2026-11-12T16:00:00+01:00'), 24);
  assert.equal(vence.toISOString(), '2026-11-17T12:00:00.000Z');
});

test('las horas hábiles respetan el horario de verano', () => {
  // Viernes 03/07/2026 a las 17:00: 1 h ese día, 1 h el lunes → lunes 06 a las 10:00 (UTC+2).
  const vence = cal.sumarHorasHabiles(new Date('2026-07-03T17:00:00+02:00'), 2);
  assert.equal(vence.toISOString(), '2026-07-06T08:00:00.000Z');
});

test('«hoy» es el día de Madrid, no el de UTC (la trampa de toISOString)', t => {
  fijarAhora(t, '2026-11-13T23:30:00Z');   // las 00:30 del sábado 14 en Madrid
  assert.equal(calendario.hoy(), '2026-11-14');
});

test('en la base: los festivos de Madrid capital y de la Comunidad no son hábiles', () => conBase(async () => {
  const madrid = await calendario.de('madrid');
  assert.equal(madrid.esHabil('2026-11-09'), false, 'la Almudena (db/244)');
  assert.equal(madrid.esHabil('2026-05-15'), false, 'San Isidro (db/244)');
  assert.equal(madrid.esHabil('2026-04-02'), false, 'Jueves Santo, de la Comunidad (db/197)');
  assert.equal(madrid.esHabil('2026-12-08'), false, 'la Inmaculada, nacional (db/197)');
  assert.equal(madrid.esHabil('2026-11-10'), true);
  assert.equal(madrid.tieneFestivosDe(2026), true);
  assert.equal(madrid.horario.desde, '09:00');
}));

test('en la base: el horario de la oficina es un parámetro, y cambiarlo cambia la cuenta', () => conBase(async ({ fabrica }) => {
  const ignacio = await fabrica.usuario({ nombre: 'Responsable' });
  await parametros.cambiar('oficina.madrid.horario',
    { dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '15:00' },
    { usuarioId: ignacio.id, motivo: 'Jornada intensiva de prueba' });
  calendario.invalidar();
  const madrid = await calendario.de('madrid');
  const vence = madrid.sumarHorasHabiles(new Date('2026-11-14T10:00:00+01:00'), 5);
  assert.equal(vence.toISOString(), '2026-11-16T12:00:00.000Z', 'lunes de 8:00 a 13:00');
}));

test('Barcelona aún no tiene calendario, y lo dice', () => conBase(async () => {
  await assert.rejects(calendario.de('barcelona'), /Aún no hay calendario laboral de «barcelona»/);
}));
