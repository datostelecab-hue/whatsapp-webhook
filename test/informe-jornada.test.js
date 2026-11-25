// ============================================================
// EL INFORME DE JORNADA PARA EL SMAC (módulo 5, 25/11/2026)
// ============================================================
// «Por conductor y rango de fechas, con un clic desde su ficha, el ERP genera
// en PDF y Excel un consolidado para legal y los abogados». Decidido: estricto
// del convenio (la espera fuera del área no es efectiva), día natural, desde el
// 01/07/2026. Criterio del encargo: «sus totales cuadran con los fichajes».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const informe = require('../modules/RRHH/informeJornada');
const servicio = require('../modules/RRHH/informeJornada.service');
const pdf = require('../modules/RRHH/informeJornada.pdf');
const excel = require('../modules/RRHH/informeJornada.excel');

const H = 3600000;
// 10/11/2026 en Madrid es UTC+1: las 00:00 de Madrid son las 23:00 UTC del día anterior.
const T = (dia, hhmm) => Date.parse(`${dia}T${hhmm}:00+01:00`);

test('la medianoche de Madrid, también con el cambio de hora', () => {
  assert.equal(new Date(informe.medianoche('2026-11-10')).toISOString(), '2026-11-09T23:00:00.000Z');
  assert.equal(new Date(informe.medianoche('2026-07-10')).toISOString(), '2026-07-09T22:00:00.000Z');
  assert.equal(new Date(informe.medianoche('2026-10-25')).toISOString(), '2026-10-24T22:00:00.000Z', 'el día del cambio empieza en verano');
});

test('la cuenta: estricto del convenio, la medianoche parte, cada segundo una vez, auxiliares y conexiones', () => {
  const tramos = [
    // Día 10: conexión de 08:00 a 13:00.
    { situacion: 'espera', enArea: false, desdeMs: T('2026-11-10', '08:00'), hastaMs: T('2026-11-10', '09:00') },
    { situacion: 'viaje', desdeMs: T('2026-11-10', '09:00'), hastaMs: T('2026-11-10', '11:00') },
    { situacion: 'espera', enArea: true, desdeMs: T('2026-11-10', '11:00'), hastaMs: T('2026-11-10', '11:30') },
    { situacion: 'descanso', desdeMs: T('2026-11-10', '11:30'), hastaMs: T('2026-11-10', '12:00') },
    { situacion: 'viaje', desdeMs: T('2026-11-10', '12:00'), hastaMs: T('2026-11-10', '13:00') },
    // Una segunda cuenta que se pisa con el viaje de las 09:00: no cuenta dos veces.
    { situacion: 'espera', enArea: false, desdeMs: T('2026-11-10', '10:00'), hastaMs: T('2026-11-10', '10:30') },
    // De noche: de 22:00 del 10 a 02:00 del 11, cruza la medianoche.
    { situacion: 'viaje', desdeMs: T('2026-11-10', '22:00'), hastaMs: T('2026-11-11', '02:00') },
    // Desconectado: fuera.
    { situacion: 'desconectado', desdeMs: T('2026-11-11', '02:00'), hastaMs: T('2026-11-11', '05:00') },
    // Antes del rango: no entra.
    { situacion: 'viaje', desdeMs: T('2026-11-09', '20:00'), hastaMs: T('2026-11-09', '21:00') },
  ];
  const r = informe.calcular({ tramos, desde: '2026-11-10', hasta: '2026-11-11' });
  const [d10, d11] = r.dias;
  const min = s => Math.round(s / 60);
  assert.deepEqual([min(d10.viaje), min(d10.esperaArea), min(d10.esperaFuera), min(d10.descanso)], [5 * 60, 30, 60, 30],
    'viaje 2 h + 1 h + 2 h (22-24); la espera solapada con el viaje no suma');
  assert.equal(min(d10.efectivo), 5 * 60 + 30, 'efectivo = viaje + espera en área');
  assert.equal(min(d10.presencia), 5 * 60 + 30 + 60, 'presencia = efectivo + espera no efectiva (sin descanso)');
  assert.equal(min(d10.aux), 20, '20 min de auxiliares el día con actividad');
  assert.deepEqual([min(d11.viaje), min(d11.aux)], [120, 20], 'el 11, las 2 h de después de medianoche');
  assert.equal(new Date(d10.primera).toISOString(), new Date(T('2026-11-10', '08:00')).toISOString());
  assert.equal(new Date(d10.ultima).toISOString(), new Date(T('2026-11-11', '00:00')).toISOString(), 'la última del día 10 es la medianoche');
  // Dos conexiones: 08:00-13:00 y 22:00-02:00 (entera, aunque cruce el día).
  assert.deepEqual(r.sesiones.map(s => [min(s.duracion), min(s.viaje)]), [[5 * 60, 3 * 60], [4 * 60, 4 * 60]]);
  // Semana y mes: lo mismo que la suma de los días.
  assert.equal(r.semanas.length, 1);
  assert.equal(r.semanas[0].desde, '2026-11-10');
  assert.equal(min(r.meses[0].efectivo), min(d10.efectivo) + min(d11.efectivo));
  assert.equal(min(r.totales.efectivoConAux), min(d10.efectivo + d11.efectivo) + 40);
  assert.equal(r.totales.diasConActividad, 2);
  assert.equal(informe.hm(5 * 3600 + 5 * 60), '5 h 05 min');
  assert.throws(() => informe.calcular({ tramos: [], desde: '2026-11-11', hasta: '2026-11-10' }), /rango/);
});

test('el rango: desde el 01/07/2026, no más allá de hoy, y con un tope', () => {
  assert.throws(() => servicio.rango({ desde: '2026-06-30', hasta: '2026-07-10' }), /desde el 01\/07\/2026/);
  assert.throws(() => servicio.rango({ desde: '2026-07-10', hasta: '2099-01-01' }), /posterior a hoy/);
  assert.throws(() => servicio.rango({ desde: '2026-07-10' }), /Elige/);
  assert.deepEqual(servicio.rango({ desde: '2026-07-01', hasta: '2026-07-31' }), { desde: '2026-07-01', hasta: '2026-07-31' });
});

test('con la base: los tramos de sus cuentas, el PDF, el Excel, la huella y el libro', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  const c = await fabrica.conductor({ nombre: 'ANA', apellidos: 'PRUEBA' });
  await consulta(`UPDATE conductor SET dni_nie = '11111111H', legajo = '000057' WHERE id = $1`, [c.id]);
  await consulta(`INSERT INTO conductor_externo (conductor_id, sistema, externo_id, enlazado_at) VALUES ($1, 'bolt', 'cuenta-ana', now())`, [c.id]);
  await consulta(`INSERT INTO fv_vehiculo (uuid, matricula) VALUES ('veh-ana', '1234PRB')`);
  await consulta(`INSERT INTO fv_conductor (uuid, nombre) VALUES ('cuenta-ana', 'Ana'), ('cuenta-otra', 'Otra')`);
  const iso = ms => new Date(ms).toISOString();
  await consulta(`INSERT INTO fv_tramo (vehiculo_uuid, conductor_uuid, situacion, desde, hasta) VALUES
    ('veh-ana', 'cuenta-ana', 'viaje', $1, $2), ('veh-ana', 'cuenta-ana', 'espera', $2, $3), ('veh-ana', 'cuenta-ana', 'descanso', $3, $4),
    ('veh-ana', 'cuenta-otra', 'viaje', $4, $5)`,
  [iso(T('2026-11-10', '08:00')), iso(T('2026-11-10', '10:00')), iso(T('2026-11-10', '11:00')), iso(T('2026-11-10', '11:30')), iso(T('2026-11-10', '15:00'))]);

  const otroUsuario = await fabrica.usuario({ rol: 'oficina', nombre: 'Sin' });
  await assert.rejects(servicio.datos(c.id, { desde: '2026-11-10', hasta: '2026-11-10' }, { usuarioId: otroUsuario.id, rol: 'oficina' }), /RR\. HH\. y legal/);
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/informe-jornada')`, [u.id]);
  const d = await servicio.datos(c.id, { desde: '2026-11-10', hasta: '2026-11-10', formato: 'pdf' }, { usuarioId: u.id, rol: 'oficina' });
  const t = d.calculo.totales;
  assert.deepEqual([t.viaje, t.esperaFuera, t.descanso].map(s => Math.round(s / 60)), [120, 60, 30],
    'sus tramos; los de otra cuenta en su coche, no; sin zonas, la espera es no efectiva');
  assert.equal(Math.round(t.efectivo / 60), 120);
  assert.equal(Math.round(t.presencia / 60), 180, 'presencia = viaje + espera, el «tiempo de conexión» de BOLT');
  assert.match(d.huella, /^[0-9a-f]{64}$/);
  assert.equal(d.emitido.por, 'Diana De Prueba');
  const otra = await servicio.datos(c.id, { desde: '2026-11-10', hasta: '2026-11-10' }, { usuarioId: u.id, rol: 'oficina' });
  assert.equal(otra.huella, d.huella, 'los mismos datos, la misma huella');
  const libro = (await consulta(`SELECT accion, motivo FROM auditoria WHERE tabla = 'conductor' AND registro = $1::text AND accion = 'lectura' ORDER BY id DESC LIMIT 1`, [c.id])).rows[0];
  assert.match(libro.motivo, /Informe de jornada del 10\/11\/2026 al 10\/11\/2026/);

  const bPdf = await pdf.generar(d);
  assert.equal(bPdf.slice(0, 5).toString(), '%PDF-');
  const bXls = await excel.generar(d);
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bXls);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Resumen', 'Por día', 'Por semana', 'Por mes', 'Conexiones']);
}));
