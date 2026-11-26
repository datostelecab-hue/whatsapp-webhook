// ============================================================
// LAS ALTAS NUEVAS ANTE LA GESTORÍA (módulo 8, db/304, 26/11/2026)
// ============================================================
// Cada contrato nuevo de plantilla propia tiene su alta: sin confirmar, no
// vincula coche; se confirma con el justificante. Si no se presenta a su primer
// turno, a las dos horas el aviso y la tarjeta; a los dos días cotizados, a
// Ignacio; si se presenta, todo se da por visto.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../services/db');
const calendario = require('../services/calendario');
const altas = require('../modules/Gestoria/altas.service');

const conLlaves = async (consulta, fabrica, nombre, claves) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre });
  for (const k of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, k]);
  return { usuarioId: u.id, rol: 'oficina' };
};
const adjunto = (consulta, id) => consulta(
  `INSERT INTO adjunto (dueno_tipo, dueno_id, almacen, ruta, nombre, mime, bytes, sha256)
   VALUES ('alta_gestoria', $1::varchar, 'r2', 'pruebas/alta/' || $1::text || '.pdf', 'alta.pdf', 'application/pdf', 10, repeat('a', 64))`, [String(id)]);

test('alta nueva: sin pedir, el candado del coche y la confirmación con justificante', () => conBase(async ({ consulta, fabrica }) => {
  const D = await conLlaves(consulta, fabrica, 'Diana', ['/gestoria', '/gestoria/gestionar']);
  const mira = await conLlaves(consulta, fabrica, 'Mira', ['/gestoria']);
  const entra = calendario.sumarDias(calendario.hoy(), 5);
  const nuevo = await fabrica.conductor({ nombre: 'NUEVO', alta: entra });
  const ett = await fabrica.conductor({ nombre: 'ETT', alta: entra, tipo: 'ett' });
  const antiguo = await fabrica.conductor({ nombre: 'ANTIGUO', alta: '2026-11-01' });

  const { filas } = await altas.lista(mira);
  const suya = filas.find(f => f.conductor_id === String(nuevo.id));
  assert.ok(suya, 'el contrato nuevo de plantilla propia está');
  assert.ok(!filas.some(f => [String(ett.id), String(antiguo.id)].includes(f.conductor_id)), 'ni la ETT ni los de antes del 27/11');
  assert.equal(suya.estado, 'pendiente');
  assert.equal((await consulta(`SELECT count(*)::int AS n FROM tarea WHERE tipo = 'alta_pedir' AND origen_id = $1 AND estado <> 'cerrada'`, [suya.id])).rows[0].n, 1);
  assert.equal((await consulta(`SELECT tipo FROM firma_envio WHERE origen = 'alta' AND origen_id = $1`, [suya.id])).rows[0].tipo, 'incorporacion',
    'su carta de incorporación, a la cola de Firmas');
  // Y su documento informativo del contrato (db/308), con lo de esa persona.
  const info = (await consulta(`SELECT tipo, detalle FROM firma_envio WHERE origen = 'alta' AND origen_id = $1`, [`${suya.id}|informativo`])).rows[0];
  assert.equal(info.tipo, 'informativo');
  assert.equal(info.detalle.tipo, 'INDEFINIDO A TIEMPO COMPLETO');
  assert.equal(info.detalle.inicio, entra.split('-').reverse().join('/'));
  assert.match(info.detalle.mes, /^[A-Z]+$/);

  // El candado: sin confirmar, no vincula coche. La ETT y los de antes, sí.
  assert.deepEqual(await altas.bloqueaCoche(nuevo.id), { fechaAlta: entra, estado: 'pendiente' });
  assert.equal(await altas.bloqueaCoche(ett.id), null);
  assert.equal(await altas.bloqueaCoche(antiguo.id), null);
  assert.equal((await altas.sinConfirmar()).get(String(nuevo.id)), 'pendiente', 'en rojo en el planificador');

  // Marcarla es de quien gestiona la gestoría.
  await assert.rejects(altas.solicitar(suya.id, {}, mira), e => e.status === 403);
  await altas.solicitar(suya.id, {}, D);
  assert.equal((await consulta(`SELECT estado FROM tarea WHERE tipo = 'alta_pedir' AND origen_id = $1`, [suya.id])).rows[0].estado, 'cerrada');
  // Confirmarla pide el justificante.
  await assert.rejects(altas.confirmar(suya.id, {}, D), /justificante/);
  await adjunto(consulta, suya.id);
  await altas.confirmar(suya.id, {}, D);
  assert.equal(await altas.bloqueaCoche(nuevo.id), null, 'con el alta confirmada, ya vincula');
  assert.equal((await altas.sinConfirmar()).has(String(nuevo.id)), false);

  // Anular pide motivo; deshacer la devuelve a sin pedir.
  await assert.rejects(altas.anular(suya.id, {}, D), /por qué/);
  await altas.reabrir(suya.id, { nota: 'Marcada por error' }, D);
  assert.equal((await altas.ficha(suya.id, mira)).estado, 'pendiente');
}));

test('no presentación: el aviso a las dos horas, el contador y Dirección a los dos días', () => conBase(async ({ consulta, fabrica }) => {
  const D = await conLlaves(consulta, fabrica, 'Diana', ['/gestoria', '/gestoria/gestionar']);
  const ign = await conLlaves(consulta, fabrica, 'Ignacio', ['/tablero/vencidas']);
  const entra = calendario.sumarDias(calendario.hoy(), 3);
  const c = await fabrica.conductor({ nombre: 'NOVIENE', alta: entra });
  const v = await fabrica.vehiculo({ matricula: '9999ZZZ' });
  const p = (await consulta('INSERT INTO plaza (vehiculo_id, slot) VALUES ($1, 0) RETURNING id', [v.id])).rows[0];
  await consulta(`INSERT INTO asignacion (plaza_id, conductor_id, desde) VALUES ($1, $2, $3)`, [p.id, c.id, entra]);

  const { filas } = await altas.lista(D);
  const a = filas.find(f => f.conductor_id === String(c.id));
  await altas.solicitar(a.id, {}, D);   // pedida: cotiza desde el alta

  const vuelta = (dia, hora) => db.transaccion(cli => altas.revisar({ cli, ahora: calendario.instante(dia, hora * 60), enSeguida: true }));
  const avisosDe = async tipo => (await consulta(`SELECT count(*)::int AS n FROM aviso WHERE tipo = $1 AND usuario_id = $2 AND estado = 'abierto'`, [tipo, ign.usuarioId])).rows[0].n;

  // El día antes, sin confirmar: aviso urgente.
  let r = await vuelta(calendario.sumarDias(entra, -1), 10);
  assert.equal(r.sinConfirmar, 1);
  assert.equal(await avisosDe('alta_sin_confirmar'), 1);
  assert.equal((await altas.ficha(a.id, D)).primer_dia, entra, 'su primer turno, del planificador');

  // A las 06:00 del primer día aún no; a las 07:30 (dos horas tras las 05:00), sí.
  r = await vuelta(entra, 6);
  assert.equal(r.noPresentados, 0);
  r = await vuelta(entra, 7.5);
  assert.equal(r.noPresentados, 1);
  assert.equal(await avisosDe('alta_no_presentado'), 1);
  assert.equal((await consulta(`SELECT count(*)::int AS n FROM tarea WHERE tipo = 'alta_no_presentado' AND origen_id = $1 AND estado <> 'cerrada'`, [a.id])).rows[0].n, 1);
  assert.equal(altas.diasCotizados(await altas.ficha(a.id, D), entra), 1);

  // Al día siguiente: dos días cotizados, a Dirección. Una vez.
  r = await vuelta(calendario.sumarDias(entra, 1), 8);
  assert.equal(r.escaladas, 1);
  assert.equal(await avisosDe('alta_dos_dias'), 1);
  r = await vuelta(calendario.sumarDias(entra, 1), 9);
  assert.equal(r.escaladas, 0);

  // Si al final vincula un coche, se presentó: avisos y tarjeta, vistos.
  await consulta(
    `INSERT INTO fichaje_turno (referencia, telefono, conductor_id, nombre, matricula, inicio)
     VALUES ('prueba-alta', '600000000', $1, 'NOVIENE', '9999ZZZ', $2)`, [c.id, new Date(calendario.instante(calendario.sumarDias(entra, 1), 10 * 60))]);
  r = await vuelta(calendario.sumarDias(entra, 1), 11);
  assert.equal(r.presentados, 1);
  assert.equal(await avisosDe('alta_no_presentado'), 0);
  assert.equal(await avisosDe('alta_dos_dias'), 0);
  assert.equal((await consulta(`SELECT estado FROM tarea WHERE tipo = 'alta_no_presentado' AND origen_id = $1`, [a.id])).rows[0].estado, 'cerrada');
}));

test('los días cotizados: solo si se pidió, hasta hoy o hasta su baja', () => {
  const base = { fecha_alta: '2026-12-01', baja: null, anulada: null, solicitada: '01/12/2026 09:00' };
  assert.equal(altas.diasCotizados({ ...base, estado: 'pendiente' }, '2026-12-03'), 0, 'sin pedir no cotiza');
  assert.equal(altas.diasCotizados({ ...base, estado: 'solicitada' }, '2026-12-03'), 3);
  assert.equal(altas.diasCotizados({ ...base, estado: 'confirmada', baja: '2026-12-02' }, '2026-12-05'), 2);
  assert.equal(altas.diasCotizados({ ...base, estado: 'anulada', anulada: '01/12/2026 18:00' }, '2026-12-05'), 1);
  assert.equal(altas.diasCotizados({ ...base, estado: 'solicitada' }, '2026-11-30'), 0, 'aún no ha empezado');
});
