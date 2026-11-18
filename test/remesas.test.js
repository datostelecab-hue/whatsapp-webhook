// ============================================================
// REMESAS — lo que se le devuelve al conductor (db/266, 18/11/2026)
// ============================================================
// Camilo: «La remesa sí o sí debe de quitarle efectivo a entregar del
// conductor… estados: pagado con efectivo de BOLT (descuenta el monto que debe
// de entregar), pagado en nómina, pendiente de pago, pendiente de aprobación,
// pagado en su cuenta. Todos los estados pueden ser editables».
//
//   · pura: casar el nombre del Excel, su estado, los importes y el IBAN;
//   · con la base: pagada con su efectivo baja lo que debe entregar (y no toca
//     el cajón); cambiar de estado o anular lo deshace; quien no aprueba la deja
//     pendiente de aprobación y no la aprueba; el movimiento no se anula a mano;
//     el Excel entra una vez, sin tocar la recaudación.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const remesas = require('../modules/Administracion/remesas.service');
const recaudacion = require('../modules/Administracion/recaudacion.service');
const recRepo = require('../modules/Administracion/recaudacion.repo');
const permisos = require('../services/permisos');
const push = require('../services/notificacionesPush');

const credAntes = process.env.CRED_KEY;
const enviar = push.enviar;
before(() => { process.env.CRED_KEY = 'clave-de-pruebas-de-remesas'; push.enviar = async () => ({}); });
after(() => { if (credAntes === undefined) delete process.env.CRED_KEY; else process.env.CRED_KEY = credAntes; push.enviar = enviar; });

test('del Excel: el conductor por todas sus palabras (y solo si es uno), el estado y los importes', () => {
  const gente = [
    { id: 1, paraCasar: 'Edison Roman Vera Farfan' },
    { id: 2, paraCasar: 'Hamza Amatat' },
    { id: 3, paraCasar: 'Luis Andres Huerfano Mahecha' },
    { id: 4, paraCasar: 'Luis Garcia' },
  ];
  assert.equal(remesas._casarConductor('Edison vera farfan ', gente).id, 1, 'sin el segundo nombre, también');
  assert.equal(remesas._casarConductor('HAMZA AMATAT', gente).id, 2);
  assert.equal(remesas._casarConductor('Luis', gente), null, 'dos Luis: no se adivina');
  assert.equal(remesas._casarConductor('Camilo Jaromillo', gente), null);

  const e = (estado, medio, observaciones) => remesas._estadoDelExcel({ estado, medio, observaciones });
  assert.equal(e('Pagado', 'ES45 0073 0100 5308 4466 9975'), 'cuenta');
  assert.equal(e('Pagado', 'Devolución en nómina por lavado y aspirado'), 'nomina');
  assert.equal(e('Pagado', null, 'REMESA EFECTIVO'), 'efectivo_bolt');
  assert.equal(e('Pendiente/Aprobado', 'Devolución en nómina'), 'pendiente_pago');
  assert.equal(e(null, 'Devolución en nómina'), 'pendiente_aprobacion');

  assert.deepEqual(['24,50', '4.95', 10.14, '1.234,5', 'x'].map(remesas._aCentimos), [2450, 495, 1014, 123450, null]);
  assert.equal(remesas._ibanLimpio(' es14 0182 1233 3702 0165 1266 '), 'ES1401821233370201651266');
  assert.throws(() => remesas._ibanLimpio('12345'), /IBAN/);
});

async function escenario({ fabrica, consulta }) {
  const jefe = await fabrica.usuario({ nombre: 'Aprueba' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/recaudacion'), ($1, '/recaudacion/remesas/aprobar')`, [jefe.id]);
  const caja = await fabrica.usuario({ nombre: 'Ventanilla' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/recaudacion')`, [caja.id]);
  permisos.invalidar(jefe.id); permisos.invalidar(caja.id);
  const c = await fabrica.conductor({ nombre: 'Hamza', apellidos: 'Amatat Prueba' });
  // La caja con 150 € de otro (para que el cambio salga de algún sitio) y él debe 100 € (el cambio que se le dio cuenta como deuda, igual que lo de BOLT).
  const otro = await fabrica.conductor({ nombre: 'Otro' });
  await consulta(`INSERT INTO recaudacion_movimiento (conductor_id, fecha, tipo, importe, usuario_id) VALUES ($1, CURRENT_DATE, 'presencial', 150, $2)`, [otro.id, jefe.id]);
  await consulta(`INSERT INTO recaudacion_movimiento (conductor_id, fecha, tipo, importe, usuario_id) VALUES ($1, CURRENT_DATE, 'cambio', 100, $2)`, [c.id, jefe.id]);
  return {
    c, jefe: { usuario: { rol: 'oficina' }, usuarioId: jefe.id }, caja: { usuario: { rol: 'oficina' }, usuarioId: caja.id },
    debe: async () => (await recRepo.cuadro()).filas.find(f => f.conductorId === String(c.id)).aRecaudar,
    efectivo: async () => (await recRepo.cuadre()).efectivo,
  };
}

test('con la base: pagada con su efectivo de BOLT baja lo que debe entregar (no toca el cajón); cambiar de estado o anular lo deshace', () => conBase(async h => {
  const p = await escenario(h);
  assert.equal(await p.debe(), 100);
  const cajon = await p.efectivo();

  // Quien aprueba, sin elegir estado: tiene efectivo por entregar → con él («sí o sí»).
  const r = await remesas.crear({ conductorId: p.c.id, importe: '30,50', concepto: 'Combustible', fechaDocumento: '2026-11-10', numeroDocumento: 'FS80', cif: 'B85509669' }, p.jefe);
  assert.equal(r.estado, 'efectivo_bolt');
  assert.equal(await p.debe(), 69.5, 'debe 30,50 € menos');
  assert.equal(await p.efectivo(), cajon, 'el cajón no se mueve');
  const mov = (await h.consulta(`SELECT id, tipo, importe FROM recaudacion_movimiento WHERE tipo = 'remesa' AND anulado_at IS NULL`)).rows;
  assert.equal(mov.length, 1);
  await assert.rejects(recaudacion.anular(mov[0].id, p.jefe.usuarioId, 'a mano'), /Remesas/, 'el movimiento no se anula desde la ficha');
  { const malas = (await recaudacion.comprobar()).pruebas.filter(x => !x.ok); assert.deepEqual(malas.map(x => `${x.titulo}: ${x.detalle}`), [], 'las comprobaciones de la caja, en verde'); }

  // Editar el importe rehace el descuento.
  await remesas.editar(r.id, { importe: '40' }, p.jefe);
  assert.equal(await p.debe(), 60);

  // A nómina: el descuento se anula y vuelve a deber.
  await remesas.cambiarEstado(r.id, { estado: 'nomina' }, p.jefe);
  assert.equal(await p.debe(), 100);
  // Otra vez con su efectivo, y anulada: vuelve a deber.
  await remesas.cambiarEstado(r.id, { estado: 'efectivo_bolt' }, p.jefe);
  assert.equal(await p.debe(), 60);
  await remesas.anular(r.id, { motivo: 'Mal apuntada' }, p.jefe);
  assert.equal(await p.debe(), 100);
  assert.equal((await remesas.lista(p.jefe)).filas.length, 0, 'la anulada ya no sale');
}));

test('con la base: quien no aprueba la deja pendiente de aprobación y no la aprueba; en su cuenta hace falta un IBAN', () => conBase(async h => {
  const p = await escenario(h);
  const r = await remesas.crear({ conductorId: p.c.id, importe: 12, concepto: 'Parking', estado: 'efectivo_bolt' }, p.caja);
  assert.equal(r.estado, 'pendiente_aprobacion', 'aunque pida otro estado');
  assert.equal(await p.debe(), 100, 'esperando aprobación no baja nada');
  await assert.rejects(remesas.cambiarEstado(r.id, { estado: 'pendiente_pago' }, p.caja), e => e.status === 403);
  const lista = await remesas.lista(p.caja);
  assert.deepEqual([lista.puedeAprobar, lista.filas[0].estado, lista.filas[0].puedeTocar], [false, 'pendiente_aprobacion', true]);
  await assert.rejects(remesas.cambiarEstado(r.id, { estado: 'cuenta' }, p.jefe), /IBAN/);
  await remesas.editar(r.id, { iban: 'ES14 0182 1233 3702 0165 1266' }, p.jefe);
  await remesas.cambiarEstado(r.id, { estado: 'cuenta' }, p.jefe);
  const f = (await remesas.lista(p.jefe)).filas[0];
  assert.deepEqual([f.estado, f.iban, f.aprobadaPor != null], ['cuenta', '•••• 1266', true]);
  assert.equal((await remesas.iban(r.id, p.jefe)).iban, 'ES1401821233370201651266');
  await assert.rejects(remesas.iban(r.id, p.caja), e => e.status === 403, 'el IBAN entero, solo quien aprueba');
  const cifrado = (await h.consulta('SELECT iban_cifrado FROM recaudacion_remesa WHERE id = $1', [r.id])).rows[0].iban_cifrado;
  assert.doesNotMatch(cifrado, /0182/, 'en la base va cifrado');
}));

test('con la base: el Excel entra una vez, con su estado, su conductor y sin tocar la recaudación', () => conBase(async h => {
  const p = await escenario(h);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Remesas');
  ws.addRow(['Fecha', 'Nombre y Apellido Beneficiario', 'IBAN', 'Fecha Documento', 'CIF', 'Numero Documento (FAS)', 'Monto a reintegrar', 'Estado', 'OBSERVACIONES']);
  ws.addRow([new Date(Date.UTC(2026, 7, 3)), 'HAMZA AMATAT', 'ES7315830001189021991655', new Date(Date.UTC(2026, 6, 10)), 'A65371171', '2625242165', 20, 'Pagado', null]);
  ws.addRow([new Date(Date.UTC(2026, 9, 1)), 'Hamza amatat', 'Devolución en nómina ( lavado de coche )', null, null, null, 5.8, 'Pendiente/Aprobado', null]);
  ws.addRow([null, null, 'DEVOLUCIONES EN NOMINA POR TIBUS', null, null, null, null, null, null]);
  ws.addRow([new Date(Date.UTC(2026, 9, 2)), 'Persona Que No Esta', null, null, null, null, 7, 'Pagado', 'REMESA EFECTIVO']);
  const base64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');

  await assert.rejects(remesas.importar({ base64 }, p.caja), e => e.status === 403);
  const previa = await remesas.importar({ base64 }, p.jefe);
  assert.equal(previa.hecho, false);
  assert.deepEqual([previa.resumen.leidas, previa.resumen.nuevas, previa.resumen.conConductor], [3, 3, 2]);
  assert.equal(previa.resumen.sinConductor.length, 1);
  const hecho = await remesas.importar({ base64, confirmar: true }, p.jefe);
  assert.equal(hecho.hecho, true);
  const filas = (await remesas.lista(p.jefe)).filas;
  assert.deepEqual(filas.map(f => [f.importe, f.estado, !!f.conductorId]).sort((a, b) => a[0] - b[0]),
    [[5.8, 'pendiente_pago', true], [7, 'efectivo_bolt', false], [20, 'cuenta', true]]);
  assert.equal(filas.find(f => f.importe === 20).iban, '•••• 1655');
  assert.equal(filas.find(f => f.importe === 5.8).concepto.toLowerCase().includes('lavado'), true, 'el concepto, del paréntesis');
  assert.equal(await p.debe(), 100, 'lo del Excel no toca la recaudación');
  assert.equal((await remesas.importar({ base64, confirmar: true }, p.jefe)).resumen.nuevas, 0, 'dos veces, no se repite');
}));
