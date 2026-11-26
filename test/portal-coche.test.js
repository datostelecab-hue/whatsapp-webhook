// ============================================================
// PORTAL DE CONDUCTORES — EL COCHE (20/11/2026)
// ============================================================
// «Créales el módulo de vincular coche, ahí podrán abrir y cerrar coches, solo
// luego de vincularse, sino no». Lo que se prueba aquí es lo del portal: que va
// con el teléfono de la ficha, que las puertas solo se tocan con un coche
// vinculado (y solo el suyo), y que cada respuesta de services/fichaje.js se
// convierte en el mensaje que toca. La lógica del motor es la del bot y tiene
// sus propias pruebas: aquí se sustituye por una de mentira.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const fichaje = require('../services/fichaje');
const puertas = require('../services/puertasBot');
const coche = require('../modules/Portal/portal.coche');

const reales = {};
const FUNCIONES = ['participa', 'estado', 'iniciar', 'terminar'];
let llamadas;
const yo = { id: '87', nombre: 'Camilo', telefono: '612345678' };
const turno = { matricula: '1234ABC', inicio: 1795000000, fin: 1795003600, conductorId: '87', nombre: 'Camilo', unitId: 'u1', tipo: 'turno', relevo: 0, km: 12 };

beforeEach(() => {
  llamadas = [];
  FUNCIONES.forEach(n => { reales[n] = fichaje[n]; });
  reales.ejecutar = puertas.ejecutar;
  fichaje.participa = async tel => (tel === yo.telefono ? { tipo: 'conductor', sede: 'madrid' } : null);
  fichaje.estado = async () => ({ abierto: false, turno: null });
  puertas.ejecutar = async o => { llamadas.push(o); return { ok: true }; };
});
afterEach(() => { FUNCIONES.forEach(n => { fichaje[n] = reales[n]; }); puertas.ejecutar = reales.ejecutar; });

test('va con el teléfono de su ficha: sin teléfono, o sin el uso de coches, no se hace nada', async () => {
  assert.equal((await coche.vincular({ ...yo, telefono: null }, '1234ABC')).titulo, 'Tu ficha no tiene teléfono');
  assert.equal((await coche.estado({ ...yo, telefono: '699000000' })).puede, false);
  assert.equal((await coche.moverPuertas({ ...yo, telefono: '699000000' }, true)).titulo, 'No tienes activado el uso de coches');
  assert.equal(llamadas.length, 0);
});

test('vincular: la matrícula limpia, con el motor desbloqueado; y los «no» del bot, con su mensaje', async () => {
  let pedida = null;
  fichaje.iniciar = async o => { pedida = o; return { ok: true, turno, bloqueoActivo: true, motor: { hecho: true } }; };
  const r = await coche.vincular(yo, ' 1234-abc ');
  assert.deepEqual(pedida, { telefono: yo.telefono, matricula: '1234ABC' });
  assert.deepEqual([r.ok, r.tono, r.titulo, r.texto], [true, 'ok', '1234ABC vinculado', ['Motor desbloqueado: ya puedes arrancar.']]);
  fichaje.iniciar = async () => ({ ok: true, turno, bloqueoActivo: true, motor: { hecho: false, motivo: 'sin respuesta' } });
  assert.equal((await coche.vincular(yo, '1234ABC')).tono, 'error', 'si el motor no se suelta, en rojo');
  fichaje.iniciar = async () => ({ ok: false, motivo: 'ocupado-encendido', turno: { matricula: '1234ABC', nombre: 'Ana' } });
  assert.equal((await coche.vincular(yo, '1234ABC')).titulo, 'El 1234ABC tiene el contacto puesto');
  fichaje.iniciar = async () => ({ ok: false, motivo: 'sin-matricula' });
  assert.equal((await coche.vincular(yo, '9999ZZZ')).titulo, 'No encuentro la matrícula 9999ZZZ');
  assert.equal((await coche.vincular(yo, 'ab')).titulo, 'Escribe la matrícula');
});

test('las puertas, solo con un coche vinculado, y del suyo', async () => {
  const sin = await coche.moverPuertas(yo, true);
  assert.deepEqual([sin.ok, sin.titulo], [false, 'Primero vincula el coche']);
  assert.equal(llamadas.length, 0, 'sin coche vinculado no se manda ninguna orden');
  fichaje.estado = async () => ({ abierto: true, turno });
  const r = await coche.moverPuertas(yo, false);
  assert.deepEqual([r.ok, r.titulo], [true, 'Orden de cerrar enviada'], 'una orden enviada, no un coche cerrado (Mapon solo la acepta)');
  assert.deepEqual([llamadas[0].matricula, llamadas[0].unitId, llamadas[0].abrir, llamadas[0].telefono, llamadas[0].sede],
    ['1234ABC', 'u1', false, yo.telefono, 'madrid'], 'el coche de su turno, con su teléfono y su sede');
  puertas.ejecutar = async () => ({ ok: false, sinMapon: true });
  assert.equal((await coche.moverPuertas(yo, true)).titulo, 'No se pueden mover las puertas');
});

test('desvincular: en marcha o con el contacto puesto, no (sigue vinculado); si se puede, el motor queda bloqueado', async () => {
  fichaje.terminar = async () => ({ ok: false, motivo: 'coche-encendido', turno });
  const enc = await coche.desvincular(yo);
  assert.deepEqual([enc.ok, enc.titulo], [false, 'Apaga el coche primero']);
  fichaje.terminar = async () => ({ ok: false, motivo: 'coche-en-marcha', velocidad: 40, turno });
  assert.equal((await coche.desvincular(yo)).titulo, 'Estás en marcha');
  fichaje.terminar = async () => ({ ok: true, turno, bloqueoActivo: true, motor: { hecho: true } });
  const r = await coche.desvincular(yo);
  assert.deepEqual([r.ok, r.titulo], [true, '1234ABC desvinculado']);
  assert.ok(r.texto.some(t => /Motor bloqueado/.test(t)));
  assert.ok(/12 km/.test(r.texto[0]));
});

test('el estado: el coche vinculado y desde cuándo', async () => {
  assert.deepEqual(await coche.estado(yo), { puede: true, vinculado: false });
  fichaje.estado = async () => ({ abierto: true, turno });
  const e = await coche.estado(yo);
  assert.deepEqual([e.vinculado, e.matricula, typeof e.desde], [true, '1234ABC', 'string']);
});

test('entregar coche, «no tengo yo el coche» y el código de lavado: las mismas funciones del bot (26/11/2026)', async () => {
  const relevoReal = fichaje.marcarRelevo, noLoTengoReal = fichaje.noLoTengo;
  const fichajeBot = require('../services/fichajeBot');
  const avisoReal = fichajeBot.avisarAlQueRecibe;
  const lavado = require('../services/lavadoBallenoil');
  const solicitarReal = lavado.solicitar;
  try {
    // Entregar: sin coche, no; con coche, se anota; ya anotado, se dice; y se puede quitar.
    assert.equal((await coche.entregar(yo, true)).titulo, 'No tienes ningún coche vinculado');
    fichaje.estado = async () => ({ abierto: true, turno });
    const pedidas = [];
    fichaje.marcarRelevo = async (tel, si) => { pedidas.push([tel, si]); return { ok: true, turno: { ...turno, relevo: si ? 1795001000 : 0 } }; };
    assert.equal((await coche.entregar(yo, true)).titulo, 'Anotado: sales a entregar el coche');
    assert.equal((await coche.entregar(yo, false)).titulo, 'Quitado');
    assert.deepEqual(pedidas, [[yo.telefono, true], [yo.telefono, false]]);
    fichaje.estado = async () => ({ abierto: true, turno: { ...turno, relevo: 1795001000 } });
    assert.equal((await coche.entregar(yo, true)).titulo, 'Ya lo tenías anotado');

    // No lo tengo: pasa al compañero de BOLT, al que se avisa; o se queda sin nadie, con el porqué.
    const avisos = [];
    fichajeBot.avisarAlQueRecibe = async (tel, r) => { avisos.push([tel, r.pasa.telefono]); };
    fichaje.noLoTengo = async () => ({ ok: true, turno, otro: { nombre: 'Ana' }, bolt: { porque: 'ahora', nombre: 'Ana' },
      pasa: { ok: true, telefono: '611111111', motor: {} } });
    const r = await coche.noLoTengo(yo);
    assert.deepEqual([r.ok, r.titulo], [true, '1234ABC desvinculado']);
    assert.match(r.texto[0], /Ahora lo tiene vinculado Ana, que lo lleva ahora en BOLT/);
    await new Promise(ok => setImmediate(ok));
    assert.deepEqual(avisos, [[yo.telefono, '611111111']], 'al compañero, por WhatsApp');
    fichaje.noLoTengo = async () => ({ ok: true, turno, bolt: null });
    const solo = await coche.noLoTengo(yo);
    assert.equal(solo.tono, 'aviso');
    assert.match(solo.texto.join(' '), /Nadie ha salido en BOLT con este coche/);
    fichaje.noLoTengo = async () => ({ ok: false, motivo: 'lo-llevas-tu', turno, bolt: { situacion: 'viaje' } });
    assert.equal((await coche.noLoTengo(yo)).titulo, 'En BOLT sales tú con el 1234ABC');

    // El lavado: el código, grande, y los pasos sin el formato de WhatsApp.
    lavado.solicitar = async o => ({ codigo: 'ABC123', vence: '31/12/2026', repetido: false, pedido: o });
    const l = await coche.codigoLavado(yo);
    if (lavado.visible()) {
      assert.deepEqual([l.ok, l.codigo], [true, 'ABC123']);
      assert.ok(l.pasos.length >= 2 && l.pasos.every(p => !/[*_]/.test(p)));
    } else assert.equal(l.titulo, 'Ya no hay códigos de lavado');
  } finally {
    fichaje.marcarRelevo = relevoReal; fichaje.noLoTengo = noLoTengoReal;
    fichajeBot.avisarAlQueRecibe = avisoReal; lavado.solicitar = solicitarReal;
  }
});
