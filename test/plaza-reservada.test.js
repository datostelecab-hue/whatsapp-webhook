// ============================================================
// PLAZA RESERVADA EN EL PLANIFICADOR (db/277, 23/11/2026) Y «ALTA A MANO» DE LA ETT
// ============================================================
// «Cuando tengo un "Hueco" en un cuadrante, puedo separar esa plaza para
// alguien que esté en proceso de terminar su alta (…) la plaza se puede guardar
// como "Sin nombre". (…) si ponen a alguien que ya tiene un alta prevista,
// entonces el hasta del conductor planificado irá hasta ese día». Y «se la
// planifica sí o sí, para algo se le guardó el puesto».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const reservas = require('../modules/Planificacion/reservas.service');
const plan = require('../modules/Planificacion/planificador.repo');
const cand = require('../modules/Seleccion/candidaturas.service');

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const masDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function unaPlaza({ fabrica, consulta }) {
  const v = await fabrica.vehiculo();
  const p = (await consulta('INSERT INTO plaza (vehiculo_id, slot) VALUES ($1, 0) RETURNING id', [v.id])).rows[0];
  return { v, plazaId: String(p.id) };
}
const asignaciones = async (consulta, plazaId) => (await consulta(
  `SELECT conductor_id, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta
     FROM asignacion WHERE plaza_id = $1 ORDER BY desde`, [plazaId])).rows;

test('«Sin nombre»: solo el cartel; una reserva por plaza; quien se planifica, sin hasta', () => conBase(async h => {
  const { plazaId } = await unaPlaza(h);
  const yo = (await h.fabrica.usuario()).id;
  const r = await reservas.reservar({ plazaId, nota: 'Para el de la semana que viene' }, { usuarioId: yo });
  assert.equal(r.planificadaDesde, null);
  await assert.rejects(reservas.reservar({ plazaId }, { usuarioId: yo }), e => e.status === 409);

  const b = await h.fabrica.conductor({ nombre: 'Bea' });
  await plan.guardar([{ slots: [{ plazaId, id: String(b.id), desde: hoy() }] }], { dia: hoy(), usuarioId: yo });
  assert.deepEqual((await asignaciones(h.consulta, plazaId)).map(a => a.hasta), [null], 'sin persona en la reserva, sin hasta');

  const t = await plan.tablero({ dia: hoy() });
  const celda = t.coches.flatMap(c => c.personas).find(p => p && p.plazaId === plazaId);
  assert.deepEqual([celda.reserva.nombre, celda.reserva.nota], [null, 'Para el de la semana que viene'], 'la celda dice «Plaza reservada · Sin nombre»');
}));

test('con alta prevista: se la planifica desde ese día y quien se ponga acaba la víspera; quitarla la quita', () => conBase(async h => {
  const { plazaId } = await unaPlaza(h);
  const yo = (await h.fabrica.usuario()).id;
  const llega = masDias(hoy(), 10);
  const ana = await h.fabrica.conductor({ nombre: 'Ana', alta: llega, tipo: 'ett' });

  const personas = (await reservas.candidatos()).personas;
  const enLista = personas.find(p => p.id === Number(ana.id));
  assert.deepEqual([enLista.llega, enLista.tipo], [llega, 'ett'], 'sale entre quienes están en proceso de alta');

  const r = await reservas.reservar({ plazaId, conductorId: ana.id }, { usuarioId: yo });
  assert.equal(r.planificadaDesde, llega, 'planificada sí o sí desde su alta');
  await assert.rejects(reservas.reservar({ plazaId: (await unaPlaza(h)).plazaId, conductorId: ana.id }, { usuarioId: yo }), /ya tiene una plaza reservada/);

  // Alguien se planifica hoy en la plaza: acaba la víspera de que llegue Ana.
  const b = await h.fabrica.conductor({ nombre: 'Bea' });
  await plan.guardar([{ slots: [{ plazaId, id: String(b.id), desde: hoy() }] }], { dia: hoy(), usuarioId: yo });
  assert.deepEqual((await asignaciones(h.consulta, plazaId)).map(a => [String(a.conductor_id), a.desde, a.hasta]),
    [[String(b.id), hoy(), masDias(llega, -1)], [String(ana.id), llega, null]]);

  // Quitar la reserva: Ana sale del cuadrante (aún no había empezado).
  await reservas.quitar(r.id, { usuarioId: yo });
  assert.deepEqual((await asignaciones(h.consulta, plazaId)).map(a => String(a.conductor_id)), [String(b.id)]);
}));

test('con alguien ya en la plaza, reservar para quien llega le corta a la víspera', () => conBase(async h => {
  const { plazaId } = await unaPlaza(h);
  const yo = (await h.fabrica.usuario()).id;
  const b = await h.fabrica.conductor({ nombre: 'Bea' });
  await plan.guardar([{ slots: [{ plazaId, id: String(b.id), desde: hoy() }] }], { dia: hoy(), usuarioId: yo });
  const llega = masDias(hoy(), 5);
  const ana = await h.fabrica.conductor({ nombre: 'Ana', alta: llega });
  await reservas.reservar({ plazaId, conductorId: ana.id }, { usuarioId: yo });
  assert.deepEqual((await asignaciones(h.consulta, plazaId)).map(a => [String(a.conductor_id), a.hasta]),
    [[String(b.id), masDias(llega, -1)], [String(ana.id), null]]);
}));

test('ETT, alta a mano: todo obligatorio, el DNI/NIE con su letra, y entra en la bolsa como una fila de la tabla', () => conBase(async h => {
  const yo = (await h.fabrica.usuario()).id;
  const bien = { nombre: 'Lucía', apellidos: 'Gómez Ruiz', dni: '12345678Z', telefono: '612 345 678', correo: 'Lucia@Correo.com',
    direccion: 'Calle Mayor 3, 2º B', cp: '28013', nacimiento: '1990-05-20' };
  await assert.rejects(cand.altaAMano({ ...bien, correo: '' }, { usuarioId: yo }), /Falta el correo/);
  await assert.rejects(cand.altaAMano({ ...bien, dni: '12345678A' }, { usuarioId: yo }), /no es válido/);
  await assert.rejects(cand.altaAMano({ ...bien, telefono: '12345' }, { usuarioId: yo }), /9 cifras/);
  await assert.rejects(cand.altaAMano({ ...bien, cp: '280' }, { usuarioId: yo }), /5 cifras/);

  const r = await cand.altaAMano(bien, { usuarioId: yo });
  assert.equal(r.que, 'creada');
  const c = (await h.consulta(
    `SELECT c.nombre, c.apellidos, c.dni_nie, c.email, c.codigo_postal, to_char(c.fecha_nacimiento, 'YYYY-MM-DD') AS nac, k.canal, k.estado
       FROM conductor c JOIN candidatura k ON k.conductor_id = c.id WHERE c.dni_nie = '12345678Z'`)).rows[0];
  assert.deepEqual(c, { nombre: 'Lucía', apellidos: 'Gómez Ruiz', dni_nie: '12345678Z', email: 'lucia@correo.com',
    codigo_postal: '28013', nac: '1990-05-20', canal: 'bolsa_ett', estado: 'preseleccion' });
  // Otra vez la misma: ya estaba, no se duplica.
  assert.equal((await cand.altaAMano(bien, { usuarioId: yo })).que, 'ya_estaba');
}));
