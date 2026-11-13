// ============================================================
// LOS ADJUNTOS (pieza A6 de la hoja de ruta, db/249)
// ============================================================
// Un fichero de cualquier dueño: se sube por trozos con su huella y su tope, se
// sirve entero o por rangos con cabeceras que no dejan correr código, y se
// anula con motivo (nada se borra). Con el almacén de disco; el de R2 se prueba
// contra un S3 de mentira si se le da su dirección:
//
//   S3_PRUEBAS=http://127.0.0.1:9090 npm test        (docker: adobe/s3mock, bucket telecab-adjuntos)
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

// El almacén de disco, en una carpeta de este fichero de pruebas.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'telecab-adjuntos-test-'));
process.env.ALMACEN = 'disco';
process.env.ALMACEN_DIR = DIR;

const adjuntos = require('../services/adjuntos');
const almacen = require('../services/almacen');
const libro = require('../services/libro');
const parametros = require('../services/parametros');

// Un dueño de pruebas: lo ven y adjuntan quien esté en su lista.
const PUEDEN = new Set();
adjuntos.registrarDueno('test_tarea', {
  etiqueta: 'Tarea',
  ver: async q => PUEDEN.has(q.id),
  adjuntar: async q => PUEDEN.has(q.id),
});

const bytesAlAzar = n => crypto.randomBytes(n);
/** Un stream que llega a trozos, como una subida de verdad. */
const aTrozos = (buf, trozo = 64 * 1024) => Readable.from((function* () {
  for (let i = 0; i < buf.length; i += trozo) yield buf.subarray(i, i + trozo);
}()));
const leerTodo = async s => { const t = []; for await (const c of s) t.push(c); return Buffer.concat(t); };
const ficherosEn = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(f => fs.statSync(path.join(dir, f)).isFile()) : []);

async function persona(fabrica, nombre) {
  const u = await fabrica.usuario({ nombre });
  PUEDEN.add(u.id);
  return { id: u.id, rol: 'oficina' };
}

test('sube por trozos con su huella, y se sirve entero, por rangos y con 304', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const datos = bytesAlAzar(3 * 1024 * 1024 + 17);
  const a = await adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'parte.pdf', mime: 'application/pdf', cuerpo: aTrozos(datos), quien: ana });
  assert.deepEqual([a.tipo, a.dueno, a.nombre, a.mime, a.clase, a.bytes, a.creadoPor], ['test_tarea', '7', 'parte.pdf', 'application/pdf', 'pdf', datos.length, 'Ana De Prueba']);

  const entero = await adjuntos.servir(a.id, ana, {});
  assert.equal(entero.estado, 200);
  assert.equal(entero.cabeceras['Content-Length'], String(datos.length));
  assert.equal(entero.cabeceras['Content-Type'], 'application/pdf');
  assert.match(entero.cabeceras['Content-Disposition'], /^inline; filename="parte\.pdf"/);
  assert.equal(entero.cabeceras.ETag, `"${crypto.createHash('sha256').update(datos).digest('hex')}"`);
  assert.ok((await leerTodo(entero.cuerpo)).equals(datos));

  const trozo = await adjuntos.servir(a.id, ana, { rango: 'bytes=1000-1999' });
  assert.deepEqual([trozo.estado, trozo.cabeceras['Content-Range'], trozo.cabeceras['Content-Length']],
    [206, `bytes 1000-1999/${datos.length}`, '1000']);
  assert.ok((await leerTodo(trozo.cuerpo)).equals(datos.subarray(1000, 2000)));

  const final = await adjuntos.servir(a.id, ana, { rango: 'bytes=-5' });
  assert.ok((await leerTodo(final.cuerpo)).equals(datos.subarray(datos.length - 5)));
  assert.equal((await adjuntos.servir(a.id, ana, { rango: `bytes=${datos.length}-` })).estado, 416);
  assert.equal((await adjuntos.servir(a.id, ana, { siNoCoincide: entero.cabeceras.ETag })).estado, 304);
  // If-Range con otra huella: entero, no el trozo.
  assert.equal((await adjuntos.servir(a.id, ana, { rango: 'bytes=0-9', siRango: '"otra"' })).estado, 200);
}));

test('los rangos: los raros se sirven enteros y los imposibles dan 416', () => {
  assert.equal(adjuntos.rangoDe(undefined, 100), null);
  assert.equal(adjuntos.rangoDe('bytes=0-9,20-29', 100), null, 'varios a la vez: entero');
  assert.equal(adjuntos.rangoDe('items=0-9', 100), null);
  assert.deepEqual(adjuntos.rangoDe('bytes=90-', 100), { desde: 90, hasta: 99 });
  assert.deepEqual(adjuntos.rangoDe('bytes=90-500', 100), { desde: 90, hasta: 99 });
  assert.deepEqual(adjuntos.rangoDe('bytes=-500', 100), { desde: 0, hasta: 99 });
  assert.equal(adjuntos.rangoDe('bytes=100-', 100), 'fuera');
  assert.equal(adjuntos.rangoDe('bytes=9-3', 100), 'fuera');
  assert.equal(adjuntos.rangoDe('bytes=-0', 100), 'fuera');
  assert.equal(adjuntos.rangoDe('bytes=0-', 0), 'fuera');
});

test('lo que pasa del tope se corta según llega, y no queda ni fila ni fichero', () => conBase(async ({ fabrica, consulta }) => {
  const ana = await persona(fabrica, 'Ana');
  await parametros.cambiar('adjuntos.max_mb', 1, { usuarioId: ana.id, motivo: 'Prueba del tope' });
  const antes = ficherosEn(DIR).length;
  await assert.rejects(
    adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'grande.mp4', mime: 'video/mp4', cuerpo: aTrozos(bytesAlAzar(2 * 1024 * 1024)), quien: ana }),
    e => e.status === 413 && /pasa de 1 MB/.test(e.message));
  assert.equal((await consulta('SELECT count(*)::int AS n FROM adjunto')).rows[0].n, 0);
  assert.equal(ficherosEn(DIR).length, antes, 'ni un fichero a medias en el almacén');
}));

test('un fichero vacío no se apunta', () => conBase(async ({ fabrica, consulta }) => {
  const ana = await persona(fabrica, 'Ana');
  await assert.rejects(adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'nada.txt', mime: 'text/plain', cuerpo: Readable.from([]), quien: ana }),
    e => e.status === 400 && /vacío/.test(e.message));
  assert.equal((await consulta('SELECT count(*)::int AS n FROM adjunto')).rows[0].n, 0);
}));

test('sin permiso del dueño no se sube, ni se lista, ni se sirve; un tipo que no existe tampoco', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const otro = { id: (await fabrica.usuario({ nombre: 'Otro' })).id, rol: 'superadmin' };
  const a = await adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'foto.jpg', mime: 'image/jpeg', cuerpo: aTrozos(bytesAlAzar(100)), quien: ana });
  await assert.rejects(adjuntos.exigirAdjuntar('test_tarea', '7', otro), e => e.status === 403);
  await assert.rejects(adjuntos.lista('test_tarea', '7', otro), e => e.status === 403);
  await assert.rejects(adjuntos.servir(a.id, otro, {}), e => e.status === 403, 'ni el superadmin por su rol: lo decide el dueño');
  await assert.rejects(adjuntos.lista('no_existe', '7', ana), e => e.status === 404);
  await assert.rejects(adjuntos.lista('test_tarea', '../7', ana), e => e.status === 400);
}));

test('solo se abren en la página fotos, PDF, vídeo y audio: un HTML o un SVG se descargan siempre', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const sube = (nombre, mime) => adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre, mime, cuerpo: aTrozos(Buffer.from('<script>alert(1)</script>')), quien: ana });
  for (const [nombre, mime] of [['x.html', 'text/html'], ['x.svg', 'image/svg+xml'], ['foto.png', 'text/html']]) {
    const a = await sube(nombre, mime);
    const r = await adjuntos.servir(a.id, ana, {});
    if (nombre === 'foto.png') {
      // Dijo text/html, pero se llama .png: se sirve como PNG, y con nosniff el navegador no lo lee como HTML.
      assert.equal(r.cabeceras['Content-Type'], 'image/png');
    } else {
      assert.equal(r.cabeceras['Content-Type'], 'application/octet-stream', nombre);
      assert.match(r.cabeceras['Content-Disposition'], /^attachment;/, nombre);
    }
    assert.equal(r.cabeceras['X-Content-Type-Options'], 'nosniff');
    assert.match(r.cabeceras['Content-Security-Policy'], /default-src 'none'.*sandbox/);
    r.cuerpo.resume();
  }
  // ?descargar=1: hasta un PDF se baja.
  const pdf = await sube('a.pdf', 'application/pdf');
  assert.match((await adjuntos.servir(pdf.id, ana, { descargar: true })).cabeceras['Content-Disposition'], /^attachment;/);
}));

test('los nombres raros se limpian y la cabecera aguanta tildes y comillas', () => {
  assert.equal(adjuntos.nombreLimpio('../../etc/passwd'), 'passwd');
  assert.equal(adjuntos.nombreLimpio('C:\\Users\\ana\\Factura "nº 3".pdf'), 'Factura nº 3 .pdf');
  assert.equal(adjuntos.nombreLimpio('línea\r\nrota.txt'), 'línea rota.txt');
  assert.equal(adjuntos.nombreLimpio(''), 'adjunto');
  const d = adjuntos.disposicion('Café "fuerte".pdf', true);
  assert.equal(d, `inline; filename="Cafe _fuerte_.pdf"; filename*=UTF-8''${encodeURIComponent('Café "fuerte".pdf')}`);
  assert.equal(adjuntos.mimeDe('', 'VIDEO.MOV'), 'video/quicktime');
  assert.equal(adjuntos.mimeDe('application/octet-stream', 'acta.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(adjuntos.mimeDe('x"><script', 'raro'), 'application/octet-stream');
});

test('quitar es anular con motivo: queda en el libro, deja de listarse y servirse, y el fichero se queda', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const a = await adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'multa.pdf', mime: 'application/pdf', cuerpo: aTrozos(bytesAlAzar(500)), quien: ana });
  const enDisco = ficherosEn(DIR).length;
  await assert.rejects(adjuntos.anular(a.id, '', ana), /Di por qué/);
  const q = await adjuntos.anular(a.id, 'Era de otra multa', ana);
  assert.equal(q.anulado.motivo, 'Era de otra multa');
  assert.deepEqual(await adjuntos.lista('test_tarea', '7', ana), []);
  await assert.rejects(adjuntos.servir(a.id, ana, {}), e => e.status === 404);
  await assert.rejects(adjuntos.anular(a.id, 'Otra vez', ana), e => e.status === 409);
  assert.equal(ficherosEn(DIR).length, enDisco, 'el fichero no se borra');
  const h = await libro.historial('adjunto', String(a.id));
  assert.deepEqual(h.map(x => [x.accion, x.quien, x.origen]), [['alta', 'Ana De Prueba', 'adjuntos'], ['anulacion', 'Ana De Prueba', 'adjuntos']]);
  assert.equal(h[1].motivo, 'Era de otra multa');
}));

test('en producción sin R2 no hay almacén: no se guarda nada en un disco que se borra al desplegar', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const antes = { ALMACEN: process.env.ALMACEN, NODE_ENV: process.env.NODE_ENV };
  delete process.env.ALMACEN;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(almacen.cual(), almacen.r2Configurado() ? 'r2' : null);
    if (!almacen.r2Configurado()) {
      await assert.rejects(adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'a.txt', mime: 'text/plain', cuerpo: aTrozos(Buffer.from('hola')), quien: ana }),
        e => e.status === 503 && /R2/.test(e.message));
    }
  } finally {
    process.env.ALMACEN = antes.ALMACEN;
    process.env.NODE_ENV = antes.NODE_ENV === undefined ? '' : antes.NODE_ENV;
    if (antes.NODE_ENV === undefined) delete process.env.NODE_ENV;
  }
}));

test('en el servidor de pruebas las rutas del almacén van aparte y no llevan nombres', () => {
  assert.match(almacen.rutaNueva(new Date('2026-11-13T10:00:00Z')), /^pruebas\/adjuntos\/2026\/11\/[0-9a-f-]{36}$/);
});

// ── Por HTTP, con las rutas de verdad ───────────────────────────────────────
test('por HTTP: subida multipart por trozos, Range para el vídeo, HEAD, y los errores en JSON', () => conBase(async ({ fabrica }) => {
  const express = require('express');
  const ana = await persona(fabrica, 'Ana');
  const otro = (await fabrica.usuario({ nombre: 'Otro' })).id;
  let yo = ana.id;
  const app = express();
  app.use((req, _res, next) => { req.usuario = { id: yo, rol: 'oficina' }; next(); });
  app.use(express.json());
  app.use('/adjuntos', require('../modules/Adjuntos/adjuntos.controller'));
  const servidor = await new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}/adjuntos`;
  try {
    const datos = bytesAlAzar(2 * 1024 * 1024 + 3);
    const form = new FormData();
    form.append('fichero', new Blob([datos], { type: 'video/mp4' }), 'vídeo del siniestro nº 3.mp4');
    const r = await fetch(`${base}/api/test_tarea/7`, { method: 'POST', body: form });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    // El nombre llega en UTF-8: con tildes y «nº» tal cual (busboy, si no se le dice, lo leía como latin1).
    assert.deepEqual([j.adjunto.nombre, j.adjunto.clase, j.adjunto.bytes], ['vídeo del siniestro nº 3.mp4', 'video', datos.length]);

    const lista = await (await fetch(`${base}/api/test_tarea/7`)).json();
    assert.deepEqual([lista.adjuntos.length, lista.maxMb], [1, 90]);

    const parcial = await fetch(`${base}/${j.adjunto.id}/fichero`, { headers: { Range: 'bytes=0-1023' } });
    assert.equal(parcial.status, 206);
    assert.equal(parcial.headers.get('content-range'), `bytes 0-1023/${datos.length}`);
    assert.equal(parcial.headers.get('accept-ranges'), 'bytes');
    assert.match(parcial.headers.get('cache-control'), /no-transform/);
    assert.ok(Buffer.from(await parcial.arrayBuffer()).equals(datos.subarray(0, 1024)));

    const cabeza = await fetch(`${base}/${j.adjunto.id}/fichero`, { method: 'HEAD' });
    assert.deepEqual([cabeza.status, cabeza.headers.get('content-length')], [200, String(datos.length)]);

    const sinFichero = await fetch(`${base}/api/test_tarea/7`, { method: 'POST', body: new FormData() });
    assert.equal(sinFichero.status, 400);
    assert.match((await sinFichero.json()).msg, /ningún fichero/);

    // Anuncia 200 MB y manda cuatro bytes: el servidor contesta 413 sin esperar al resto.
    const grande = await new Promise(ok => {
      const rq = require('http').request(`${base}/api/test_tarea/7`, {
        method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(200 * 1024 * 1024) },
      }, res => {
        let t = '';
        res.on('data', c => { t += c; });
        res.on('end', () => { rq.destroy(); ok({ status: res.statusCode, cuerpo: t }); });
      });
      rq.on('error', () => {});
      rq.write('--x\r\n');
    });
    assert.equal(grande.status, 413);
    assert.match(JSON.parse(grande.cuerpo).msg, /pasa de 90 MB/);

    yo = otro;
    const ajeno = await fetch(`${base}/${j.adjunto.id}/fichero`);
    assert.equal(ajeno.status, 403);
    const sinPermiso = await fetch(`${base}/api/test_tarea/7`, { method: 'POST', body: form });
    assert.equal(sinPermiso.status, 403);
  } finally {
    await new Promise(ok => servidor.close(ok));
  }
}));

// ── R2, contra un S3 de mentira ─────────────────────────────────────────────
test('R2: la subida grande va por partes y se lee por rangos (S3 de pruebas)', { skip: !process.env.S3_PRUEBAS && 'sin S3_PRUEBAS' }, () => conBase(async ({ fabrica }) => {
  const antes = { ...process.env };
  Object.assign(process.env, {
    ALMACEN: 'r2', R2_ENDPOINT: process.env.S3_PRUEBAS, R2_BUCKET: process.env.S3_PRUEBAS_BUCKET || 'telecab-adjuntos',
    R2_ACCESS_KEY_ID: 'prueba', R2_SECRET_ACCESS_KEY: 'prueba',
  });
  almacen.olvidar();
  try {
    const ana = await persona(fabrica, 'Ana');
    const datos = bytesAlAzar(almacen.PARTE + 1024 * 1024);   // más de una parte: va por partes
    const a = await adjuntos.subir({ tipo: 'test_tarea', duenoId: '9', nombre: 'grande.mov', mime: 'video/quicktime', cuerpo: aTrozos(datos), quien: ana });
    assert.equal(a.bytes, datos.length);
    const t = await adjuntos.servir(a.id, ana, { rango: `bytes=${almacen.PARTE - 10}-${almacen.PARTE + 9}` });
    assert.equal(t.estado, 206);
    assert.ok((await leerTodo(t.cuerpo)).equals(datos.subarray(almacen.PARTE - 10, almacen.PARTE + 10)), 'el trozo que cruza dos partes');
    assert.ok((await leerTodo((await adjuntos.servir(a.id, ana, {})).cuerpo)).equals(datos));
    // Del tope: se corta y la subida a medias no deja nada.
    await parametros.cambiar('adjuntos.max_mb', 1, { usuarioId: ana.id, motivo: 'Prueba del tope' });
    await assert.rejects(adjuntos.subir({ tipo: 'test_tarea', duenoId: '9', nombre: 'g.mp4', mime: 'video/mp4', cuerpo: aTrozos(bytesAlAzar(3 * 1024 * 1024)), quien: ana }),
      e => e.status === 413);
  } finally {
    for (const k of ['ALMACEN', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
      if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k];
    }
    almacen.olvidar();
  }
}));
