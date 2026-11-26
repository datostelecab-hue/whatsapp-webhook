// ============================================================
// LA CAPACIDAD Y LAS FECHAS BLOQUEADAS DE LAS VACACIONES (módulo 2, db/302)
// ============================================================
// Camilo, 26/11/2026: entre todos, de media, las horas del mes (32.000), un 3 %
// más por cada festivo del tramo; cada conductor suma su promedio de horas los
// días que le toca trabajar («si uno me hace 12 y otro 6, son 18»); quien está
// fuera no suma. Si unas vacaciones lo dejan por debajo, o pisan una fecha
// bloqueada, aplicarlas pide un motivo.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const capacidad = require('../modules/Vacaciones/capacidad');
const parametros = require('../services/parametros');
const bitacora = require('../modules/Operaciones/bitacora.service');

test('la capacidad: la suma de los promedios de los que trabajan, contra las horas del mes; los bloqueos piden motivo', () => conBase(async ({ consulta, fabrica }) => {
  const doce = await fabrica.conductor({ nombre: 'DOCE' });
  const seis = await fabrica.conductor({ nombre: 'SEIS' });
  const diez = await fabrica.conductor({ nombre: 'DIEZ' });
  for (const c of [doce, seis, diez]) {
    const v = await fabrica.vehiculo();
    const p = (await consulta('INSERT INTO plaza (vehiculo_id, slot) VALUES ($1, 0) RETURNING id', [v.id])).rows[0];
    await consulta(`INSERT INTO asignacion (plaza_id, conductor_id, desde) VALUES ($1, $2, '2026-01-01')`, [p.id, c.id]);
  }
  const valor = parametros.valor, promedioHoras = bitacora.promedioHoras;
  // 620 h en marzo (31 días): hacen falta 20 h al día.
  parametros.valor = async clave => (clave === 'vacaciones.capacidad_horas_mes' ? 620 : clave === 'vacaciones.capacidad_festivo_pct' ? 3 : valor(clave));
  bitacora.promedioHoras = async () => ({ porId: new Map([[String(doce.id), { promedio: 12 }], [String(seis.id), { promedio: 6 }], [String(diez.id), { promedio: 10 }]]) });
  try {
    // Se va el de 12: quedan 6 + 10 = 16 de 20 al día.
    const r = await capacidad.revisar({ conductorId: doce.id, desde: '2027-03-01', hasta: '2027-03-03', hoy: '2026-11-26' });
    assert.deepEqual([r.capacidad, r.hace_falta, r.falta, r.alcanza, r.festivos], [48, 60, 12, false, []]);
    assert.match(r.frase, /^No se pueden aprobar más vacaciones del 01\/03\/2027 al 03\/03\/2027/);
    // Se va el de 6: quedan 12 + 10 = 22 de 20.
    const r2 = await capacidad.revisar({ conductorId: seis.id, desde: '2027-03-01', hasta: '2027-03-03', hoy: '2026-11-26' });
    assert.deepEqual([r2.capacidad, r2.alcanza], [66, true]);
    // Si el de 10 está de baja esos días, tampoco suma: 12 de 20.
    await consulta(`INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta) VALUES ($1, 'baja_medica', '2027-03-01', '2027-03-10')`, [diez.id]);
    const r3 = await capacidad.revisar({ conductorId: seis.id, desde: '2027-03-01', hasta: '2027-03-03', hoy: '2026-11-26' });
    assert.deepEqual([r3.capacidad, r3.alcanza], [36, false]);

    // Al aplicarlas: sin motivo, lo pide; con motivo, queda en la nota.
    await assert.rejects(capacidad.alAplicar(seis.id, { desde: '2027-03-01', hasta: '2027-03-03' }), e => e.pide && e.pide.campo === 'motivoExceso');
    assert.match(await capacidad.alAplicar(seis.id, { desde: '2027-03-01', hasta: '2027-03-03' }, 'Boda de su hermana'), /Boda de su hermana/);

    // Una fecha bloqueada pide motivo aunque haya capacidad.
    const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Aprueba' });
    await capacidad.bloquear({ desde: '2027-04-01', hasta: '2027-04-05', motivo: 'Semana Santa' }, u.id);
    assert.equal(await capacidad.alAplicar(seis.id, { desde: '2027-03-20', hasta: '2027-03-22' }), null, 'sin baja ni bloqueo, nada que decir');
    await assert.rejects(capacidad.alAplicar(seis.id, { desde: '2027-03-30', hasta: '2027-04-02' }), /Semana Santa/);
    const [b] = await capacidad.bloqueos({ desde: '2027-01-01' });
    await capacidad.desbloquear(b.id, { motivo: 'Al final no' }, u.id);
    assert.equal((await capacidad.bloqueos({ desde: '2027-01-01' })).length, 0);
  } finally { parametros.valor = valor; bitacora.promedioHoras = promedioHoras; }
}));

test('cada festivo del tramo sube un 3 % lo que hace falta', () => conBase(async () => {
  const valor = parametros.valor;
  parametros.valor = async clave => (clave === 'vacaciones.capacidad_horas_mes' ? 3100 : clave === 'vacaciones.capacidad_festivo_pct' ? 3 : valor(clave));
  const calendario = require('../services/calendario');
  const de = calendario.de;
  calendario.de = async () => ({ festivos: new Set(['2027-05-01']) });
  try {
    // Mayo (31 días): 100 h al día; con el 1 de mayo dentro, 103.
    const r = await capacidad.revisar({ desde: '2027-04-30', hasta: '2027-05-01', hoy: '2026-11-26' });
    assert.deepEqual([r.festivos, r.hace_falta], [['2027-05-01'], Math.round(3100 / 30 * 1.03 + 3100 / 31 * 1.03)]);
  } finally { parametros.valor = valor; calendario.de = de; }
}));

test('aprobar unas vacaciones sin capacidad pide el motivo, y con él quedan puestas con su nota', () => conBase(async ({ consulta, fabrica }) => {
  const plantilla = require('../modules/Conductores/plantilla.service');
  const c = await fabrica.conductor({ nombre: 'VACAS' });
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Aprueba' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/vacaciones/aprobar')`, [u.id]);
  require('../services/permisos').invalidar(u.id);
  // En la base de pruebas casi no hay flota: con 32.000 h al mes nunca alcanza.
  const datos = { estado: 'vacaciones', desde: '2027-03-01', hasta: '2027-03-05', libraDias: [6, 7] };
  await assert.rejects(plantilla.anadirAusencia(c.id, datos, { usuarioId: u.id }), e => e.pide && /No se pueden aprobar/.test(e.message));
  await plantilla.anadirAusencia(c.id, { ...datos, motivoExceso: 'Cubierto con un ETT' }, { usuarioId: u.id });
  const r = await consulta(`SELECT motivo FROM conductor_estado_hist WHERE conductor_id = $1 AND estado = 'vacaciones'`, [c.id]);
  assert.match(r.rows[0].motivo, /Cubierto con un ETT/);
}));
