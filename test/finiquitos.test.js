// ============================================================
// LOS FINIQUITOS (módulo 7, db/291, 25/11/2026)
// ============================================================
// «El resumen de cierre incluye siempre vacaciones netas, el 100% de la
// recaudación pendiente, descuentos y bonus pendientes, cada uno con su soporte.
// Tras la aprobación, se dispara solo el envío a firma y el aviso a la gestoría».
// Camilo: nace al dar la baja (propia y ETT), Diana revisa, Ignacio aprueba,
// vacaciones en días.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const finiquitos = require('../modules/RRHH/finiquitos.service');
const pdf = require('../modules/RRHH/finiquitos.pdf');

test('el recorrido: preparar, revisar, aprobar, enviar, firmar; cada uno con su llave', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  const ignacio = await fabrica.usuario({ rol: 'directiva', nombre: 'Ignacio' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/finiquitos'), ($1, '/finiquitos/revisar'), ($2, '/finiquitos'), ($2, '/finiquitos/aprobar')`,
    [diana.id, ignacio.id]);
  const D = { usuarioId: diana.id, rol: 'oficina' }, I = { usuarioId: ignacio.id, rol: 'directiva' };
  const c = await fabrica.conductor({ nombre: 'SE VA', alta: '2026-01-01', baja: '2026-11-20' });
  const tarjeta = async (tipo, id) => (await consulta(`SELECT estado, responsable_id FROM tarea WHERE tipo = $1 AND origen_id = $2`, [tipo, String(id)])).rows[0];

  // Preparar: con la llave de revisar. Cuatro conceptos, cada uno con su soporte.
  await assert.rejects(finiquitos.preparar(c.id, {}, I), /revisa/);
  const { id, nuevo } = await finiquitos.preparar(c.id, {}, D);
  assert.equal(nuevo, true);
  let f = await finiquitos.ficha(id, D);
  assert.equal(f.estado, 'borrador');
  assert.deepEqual(f.resumen.conceptos.map(x => x.clave), ['vacaciones', 'recaudacion', 'variables', 'otros']);
  assert.ok(f.resumen.conceptos.every(x => Array.isArray(x.soporte)));
  assert.equal(f.resumen.destino, 'la gestoría');
  assert.ok(await tarjeta('finiquito_revisar', id), 'nace la tarjeta de revisarlo');
  const errores = f.resumen.conceptos.filter(x => x.error).map(x => `${x.clave}: ${x.error}`);
  assert.deepEqual(errores, [], 'todas las fuentes responden');

  // Revisar (Diana), no Ignacio. Nace la tarjeta de aprobar, a quien tiene la llave.
  await assert.rejects(finiquitos.revisar(id, {}, I), /revisar/);
  await finiquitos.revisar(id, { nota: 'Visto' }, D);
  assert.equal((await tarjeta('finiquito_revisar', id)).estado, 'cerrada');
  assert.equal(Number((await tarjeta('finiquito_aprobar', id)).responsable_id), ignacio.id);

  // Aprobar (Ignacio), no Diana. Sin correo de la gestoría en Parámetros: aprobado y sin enviar, y lo dice.
  await assert.rejects(finiquitos.aprobar(id, D), /aprobar/);
  const a = await finiquitos.aprobar(id, I);
  assert.equal(a.estado, 'aprobado');
  assert.match(a.aviso.motivo, /correo de la gestoría/);
  await assert.rejects(finiquitos.preparar(c.id, {}, D), /no se recalcula/, 'aprobado, ya no se recalcula');

  // Se manda a mano y se marca; firmado, solo con el firmado adjunto.
  await finiquitos.enviar(id, { aMano: true, a: 'gestoria@ejemplo.test' }, D);
  f = await finiquitos.ficha(id, D);
  assert.deepEqual([f.estado, f.enviado_a], ['enviado', 'gestoria@ejemplo.test']);
  await assert.rejects(finiquitos.firmado(id, D), /firmado/);

  // El PDF sale.
  const bytes = await pdf.generar(f);
  assert.equal(Buffer.from(bytes).slice(0, 5).toString(), '%PDF-');
  const libro = (await consulta(`SELECT count(*)::int AS n FROM auditoria WHERE tabla = 'finiquito' AND registro = $1`, [id])).rows[0].n;
  assert.ok(libro >= 3, 'cada paso, al libro');
}));

test('el de la ETT: va a la agencia y sus vacaciones las liquida ella', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/finiquitos'), ($1, '/finiquitos/revisar')`, [diana.id]);
  const c = await fabrica.conductor({ nombre: 'DE ETT', tipo: 'ett', ettNombre: 'Agencia', alta: '2026-09-01', baja: '2026-11-18' });
  const { id } = await finiquitos.preparar(c.id, {}, { usuarioId: diana.id });
  const f = await finiquitos.ficha(id, { usuarioId: diana.id });
  assert.match(f.resumen.destino, /ETT/);
  assert.equal(f.resumen.conceptos.find(x => x.clave === 'vacaciones').noAplica, true);
  assert.equal(f.resumen.totales.vacacionesDias, null);
}));

test('otros descuentos: los aprobados o aplazados cuentan por su saldo; los por aprobar se enseñan; el efectivo no se repite', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/finiquitos'), ($1, '/finiquitos/revisar')`, [diana.id]);
  const D = { usuarioId: diana.id, rol: 'oficina' };
  const c = await fabrica.conductor({ nombre: 'DEBE', alta: '2026-01-01', baja: '2026-11-20' });
  const desc = (origen, estado, importe, saldo) => consulta(
    `INSERT INTO descuento_nomina (conductor_id, origen, concepto, importe, saldo, periodo, fecha, motivo, estado)
     VALUES ($1, $2, '758', $3, $4, '2026-11', '2026-11-15', 'Prueba', $5)`, [c.id, origen, importe, saldo, estado]);
  await desc('km', 'aprobado', 40, 40);
  await desc('siniestro', 'aplazado', 300, 120);
  await desc('combustible', 'pendiente', 50, 50);
  await desc('efectivo', 'aprobado', 80, 80);
  await desc('otro', 'aplicado', 10, 0);
  const { id } = await finiquitos.preparar(c.id, {}, D);
  const otros = (await finiquitos.ficha(id, D)).resumen.conceptos.find(x => x.clave === 'otros');
  assert.ok(!otros.error, otros.error);
  assert.equal(otros.importe, -160, 'km 40 + lo que queda del siniestro 120');
  assert.ok(otros.soporte.some(l => /POR APROBAR/.test(l)), 'el de combustible, por aprobar, se enseña');
  assert.ok(otros.soporte.some(l => /recaudación pendiente/.test(l)), 'el efectivo, en la recaudación');
}));

