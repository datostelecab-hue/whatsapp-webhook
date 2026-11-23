// ============================================================
// PORTAL — DESVINCULAR CON LAS CINCO FOTOS (23/11/2026)
// ============================================================
// «Cuando termine el turno, el sistema le pedirá 5 fotos (…) las fotos tendrán
// que ser obligatorias para cerrar el turno (…) en la app tiene que ser
// obligatorio». Sin las cinco no se desvincula; con ellas, se desvincula y se
// guardan en R2 atadas a ese turno. El motor y R2 son de mentira.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const fichaje = require('../services/fichaje');
const adjuntos = require('../services/adjuntos');
const coche = require('../modules/Portal/portal.coche');

const yo = { id: '87', nombre: 'Camilo', telefono: '612345678' };
const turno = { filaId: 4321, matricula: '1234ABC', inicio: 1795000000, fin: 1795003600, conductorId: '87', nombre: 'Camilo', km: 12 };
const reales = {};
let subidas, terminados;
beforeEach(() => {
  subidas = []; terminados = 0;
  ['participa', 'estado', 'terminar'].forEach(n => { reales[n] = fichaje[n]; });
  reales.subir = adjuntos.subirDelSistema;
  fichaje.participa = async () => ({ tipo: 'conductor', sede: 'madrid' });
  fichaje.estado = async () => ({ abierto: true, turno });
  fichaje.terminar = async () => { terminados++; return { ok: true, turno, bloqueoActivo: false, motor: {} }; };
  adjuntos.subirDelSistema = async o => { subidas.push(o); return { id: subidas.length }; };
});
afterEach(() => { ['participa', 'estado', 'terminar'].forEach(n => { fichaje[n] = reales[n]; }); adjuntos.subirDelSistema = reales.subir; });

const foto = (mimetype = 'image/jpeg') => [{ size: 1000, mimetype, buffer: Buffer.from('jpg') }];
const cinco = () => Object.fromEntries(coche.FOTOS.map(f => [f.campo, foto()]));

test('sin las cinco fotos no se desvincula, y se dice cuáles faltan', async () => {
  const f = cinco();
  delete f.foto_trasera;
  const r = await coche.desvincularConFotos(yo, f);
  assert.equal(r.ok, false);
  assert.match(r.texto[0], /trasera/);
  assert.equal(terminados, 0, 'el coche sigue vinculado');
  const otra = await coche.desvincularConFotos(yo, { ...cinco(), foto_frontal: foto('application/pdf') });
  assert.equal(otra.titulo, 'Eso no es una foto');
  assert.equal(terminados, 0);
});

test('con las cinco: se desvincula y se guardan, en orden, atadas a ese turno', async () => {
  const r = await coche.desvincularConFotos(yo, cinco());
  assert.equal(r.ok, true);
  assert.equal(terminados, 1);
  assert.deepEqual(subidas.map(s => [s.tipo, s.duenoId, s.nombre]), [
    ['turno_fotos', '4321', '1-conductor.jpg'], ['turno_fotos', '4321', '2-frontal.jpg'], ['turno_fotos', '4321', '3-copiloto.jpg'],
    ['turno_fotos', '4321', '4-trasera.jpg'], ['turno_fotos', '4321', '5-asientos.jpg']]);
  assert.match(r.texto.at(-1), /Fotos guardadas/);
});

test('si R2 falla con alguna, el coche ya está desvinculado y se dice', async () => {
  adjuntos.subirDelSistema = async o => { if (o.nombre.startsWith('3-')) throw new Error('R2 caído'); subidas.push(o); return {}; };
  const r = await coche.desvincularConFotos(yo, cinco());
  assert.equal(r.tono, 'aviso');
  assert.match(r.texto.at(-1), /4 de las 5 fotos/);
});

test('en marcha no se desvincula (y las fotos no se suben)', async () => {
  fichaje.terminar = async () => ({ ok: false, motivo: 'coche-en-marcha', velocidad: 30 });
  const r = await coche.desvincularConFotos(yo, cinco());
  assert.equal(r.titulo, 'Estás en marcha');
  assert.equal(subidas.length, 0);
});
