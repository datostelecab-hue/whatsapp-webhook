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

// Y otro con los tres permisos por separado: quien ve, quien adjunta y quien
// quita. Con uno solo para todo, una prueba no notaba que anular() dejara de
// mirar su permiso (revisión del 16/11/2026).
const VEN = new Set();
const ADJUNTAN = new Set();
const ANULAN = new Set();
adjuntos.registrarDueno('test_expediente', {
  etiqueta: 'Expediente',
  ver: async q => VEN.has(q.id),
  adjuntar: async q => ADJUNTAN.has(q.id),
  anular: async q => ANULAN.has(q.id),
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
  // If-Range con otra huella: entero, no el trozo. Con la suya: el trozo (un
  // vídeo que se reanuda no vuelve a bajar desde cero).
  assert.equal((await adjuntos.servir(a.id, ana, { rango: 'bytes=0-9', siRango: '"otra"' })).estado, 200);
  const sigue = await adjuntos.servir(a.id, ana, { rango: 'bytes=0-9', siRango: entero.cabeceras.ETag });
  assert.deepEqual([sigue.estado, sigue.cabeceras['Content-Range']], [206, `bytes 0-9/${datos.length}`]);
  sigue.cuerpo.resume();
  // El navegador lo guarda, pero PREGUNTA cada vez: el permiso se mira antes del 304.
  assert.match(entero.cabeceras['Cache-Control'], /^private, no-cache/);
  assert.doesNotMatch(entero.cabeceras['Cache-Control'], /max-age/);
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
  // Según llega: de 16 MB que ofrece el origen, se lee poco más del tope. Una
  // subida que lo leyera todo y mirara el tamaño al final leería los 16.
  let leido = 0;
  const origen = Readable.from((function* () {
    for (let i = 0; i < 256; i++) { leido += 64 * 1024; yield bytesAlAzar(64 * 1024); }
  }()));
  await assert.rejects(
    adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'grande.mp4', mime: 'video/mp4', cuerpo: origen, quien: ana }),
    e => e.status === 413 && /pasa de 1 MB/.test(e.message));
  assert.ok(leido <= 3 * 1024 * 1024, `se cortó según llegaba: leyó ${leido} bytes de 16 MB`);
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
  // Ni los de formato (U+202E le da la vuelta al texto: «foto‮gpj.exe» se leía
  // «fotoexe.jpg») ni los de control C1.
  assert.equal(adjuntos.nombreLimpio('foto\u202Egpj.exe'), 'foto gpj.exe');
  assert.equal(adjuntos.nombreLimpio('\u0085linea\u200B sep.pdf'), 'linea sep.pdf');
  assert.equal(adjuntos.nombreLimpio('\uFEFFacta.pdf'), 'acta.pdf');
  // Un tipo declarado larguísimo no llega a la columna (VARCHAR(120)): se descarga.
  assert.equal(adjuntos.mimeDe('application/vnd.' + 'x'.repeat(120), 'datos.bin'), 'application/octet-stream');
});

test('un id imposible (texto, o más allá de bigint) es un 404, no un error de la base', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  for (const id of ['99999999999999999999', '9223372036854775808', 'abc', '0', '-3']) {
    await assert.rejects(adjuntos.servir(id, ana, {}), e => e.status === 404, `servir ${id}`);
    await assert.rejects(adjuntos.anular(id, 'Por probar', ana), e => e.status === 404, `anular ${id}`);
  }
}));

test('ver, adjuntar y quitar son tres permisos: cada uno se mira por separado', () => conBase(async ({ fabrica }) => {
  const lector = (await fabrica.usuario({ nombre: 'Lector' })).id;
  const autor = (await fabrica.usuario({ nombre: 'Autor' })).id;
  const jefe = (await fabrica.usuario({ nombre: 'Jefe' })).id;
  [lector, autor, jefe].forEach(id => VEN.add(id));
  ADJUNTAN.add(autor);
  ANULAN.add(jefe);
  const q = id => ({ id, rol: 'oficina' });
  const sube = quien => adjuntos.subir({ tipo: 'test_expediente', duenoId: '3', nombre: 'carta.pdf', mime: 'application/pdf', cuerpo: aTrozos(bytesAlAzar(300)), quien });

  await assert.rejects(adjuntos.exigirAdjuntar('test_expediente', '3', q(lector)), e => e.status === 403, 'quien solo ve no adjunta');
  await assert.rejects(sube(q(lector)), e => e.status === 403);
  await assert.rejects(adjuntos.exigirAdjuntar('test_expediente', '3', q(jefe)), e => e.status === 403, 'quitar no es adjuntar');
  const a = await sube(q(autor));
  assert.equal((await adjuntos.lista('test_expediente', '3', q(lector))).length, 1, 'quien ve, lo ve');
  (await adjuntos.servir(a.id, q(lector), {})).cuerpo.resume();
  await assert.rejects(adjuntos.anular(a.id, 'No lo quiero', q(lector)), e => e.status === 403, 'quien solo ve no quita');
  await assert.rejects(adjuntos.anular(a.id, 'No lo quiero', q(autor)), e => e.status === 403, 'adjuntar no es quitar si el dueño dice otra cosa');
  const quitado = await adjuntos.anular(a.id, 'Repetido', q(jefe));
  assert.equal(quitado.anulado.motivo, 'Repetido');
}));

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
  // Y en producción (sin MODO_PRUEBAS), sin el prefijo. Síncrona: nada se cruza
  // con ella mientras falta la variable.
  const antes = process.env.MODO_PRUEBAS;
  delete process.env.MODO_PRUEBAS;
  try {
    assert.match(almacen.rutaNueva(new Date('2026-11-13T10:00:00Z')), /^adjuntos\/2026\/11\/[0-9a-f-]{36}$/);
  } finally {
    process.env.MODO_PRUEBAS = antes;
  }
});

test('un PDF se abre en la página: sin scripts y solo dentro de nuestras páginas', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const a = await adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'parte.pdf', mime: 'application/pdf', cuerpo: aTrozos(bytesAlAzar(200)), quien: ana });
  const r = await adjuntos.servir(a.id, ana, {});
  r.cuerpo.resume();
  assert.match(r.cabeceras['Content-Disposition'], /^inline;/);
  assert.equal(r.cabeceras['Content-Security-Policy'], "default-src 'none'; frame-ancestors 'self'");
}));

test('en Render sin R2 no hay almacén, aunque no lleve NODE_ENV=production', () => {
  const antes = { ALMACEN: process.env.ALMACEN, RENDER: process.env.RENDER };
  delete process.env.ALMACEN;
  process.env.RENDER = 'true';
  try {
    if (!almacen.r2Configurado()) assert.equal(almacen.cual(), null);
  } finally {
    process.env.ALMACEN = antes.ALMACEN;
    if (antes.RENDER === undefined) delete process.env.RENDER; else process.env.RENDER = antes.RENDER;
  }
});

test('las variables de R2 mal puestas se dicen en español, y los errores de R2 también', () => {
  const claves = ['ALMACEN', 'R2_ENDPOINT', 'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const antes = Object.fromEntries(claves.map(k => [k, process.env[k]]));
  try {
    delete process.env.R2_ENDPOINT;
    Object.assign(process.env, { ALMACEN: 'r2', R2_BUCKET: 'telecab-adjuntos-pruebas', R2_ACCESS_KEY_ID: 'a'.repeat(32), R2_SECRET_ACCESS_KEY: 's' });
    // Pegado con un espacio y un salto de línea: vale igual.
    process.env.R2_ACCOUNT_ID = ' 3781f51dba1aa673545e0f834923654d\n';
    assert.equal(almacen.problemaConfig(), null);
    assert.equal(almacen.estado().direccion, '3781f51dba1aa673545e0f834923654d.r2.cloudflarestorage.com');
    // La dirección entera, o el Access Key ID, en el sitio del Account ID.
    process.env.R2_ACCOUNT_ID = 'https://3781f51dba1aa673545e0f834923654d.r2.cloudflarestorage.com';
    assert.match(almacen.problemaConfig(), /no es un Account ID/);
    process.env.R2_ACCOUNT_ID = 'a'.repeat(32);
    assert.match(almacen.problemaConfig(), /Access Key ID/);
    // Los errores de R2, traducidos (y lo que ya trae estado, como está).
    const tls = Object.assign(new Error('write EPROTO …:ssl3_read_bytes:ssl/tls alert handshake failure:…SSL alert number 40'), { code: 'EPROTO' });
    assert.match(almacen.traducir(tls).message, /R2_ACCOUNT_ID/);
    assert.equal(almacen.traducir(tls).status, 503);
    const s3 = (name, http) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: http } });
    assert.match(almacen.traducir(s3('InvalidAccessKeyId', 403)).message, /R2_ACCESS_KEY_ID/);
    assert.match(almacen.traducir(s3('SignatureDoesNotMatch', 403)).message, /R2_SECRET_ACCESS_KEY/);
    assert.match(almacen.traducir(s3('NoSuchBucket', 404)).message, /telecab-adjuntos-pruebas/);
    assert.match(almacen.traducir(s3('AccessDenied', 403)).message, /Object Read & Write/);
    assert.equal(almacen.traducir(s3('NoSuchKey', 404)).status, 404);
    const tope = Object.assign(new Error('El fichero pasa de 1 MB'), { status: 413 });
    assert.equal(almacen.traducir(tope), tope);
  } finally {
    for (const k of claves) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
    almacen.olvidar();
  }
});

test('«Probar conexión» escribe, lee y borra una sonda, y no deja nada', async () => {
  const antes = ficherosEn(DIR).length;
  const r = await almacen.probar();
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(r.pasos.map(p => [p.paso, p.ok]), [['escribir', true], ['leer', true], ['borrar', true]]);
  assert.equal(ficherosEn(DIR).length, antes);
});

// ── Por HTTP, con las rutas de verdad ───────────────────────────────────────
const http = require('http');
const esperar = ms => new Promise(ok => setTimeout(ok, ms));

/** Las rutas de verdad en un puerto suelto. `como(id)` cambia quién pide. */
async function servidorDePrueba(yoInicial) {
  const express = require('express');
  let yo = yoInicial;
  const app = express();
  app.use((req, _res, next) => { req.usuario = { id: yo, rol: 'oficina' }; next(); });
  app.use(express.json());
  const rutas = require('../modules/Adjuntos/adjuntos.controller');
  app.use('/adjuntos', rutas);
  const servidor = await new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  return {
    base: `http://127.0.0.1:${servidor.address().port}/adjuntos`,
    rutas,
    como: id => { yo = id; },
    cerrar: () => new Promise(ok => { servidor.closeAllConnections(); servidor.close(ok); }),
  };
}

/** Una petición a pelo (para mandar un cuerpo a medias o cortarla). */
function peticion(url, { method = 'POST', headers = {}, trozos = [], terminar = true } = {}) {
  const rq = http.request(url, { method, headers });
  const respuesta = new Promise(ok => {
    rq.on('response', res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => ok({ status: res.statusCode, cuerpo: t })); });
    rq.on('error', e => ok({ status: 0, error: e.code }));
  });
  for (const t of trozos) rq.write(t);
  if (terminar) rq.end();
  return { rq, respuesta };
}

test('por HTTP: subida multipart por trozos, Range para el vídeo, HEAD, y los errores en JSON', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const otro = (await fabrica.usuario({ nombre: 'Otro' })).id;
  const srv = await servidorDePrueba(ana.id);
  const { base } = srv;
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

    // Quitar por HTTP: sin motivo no, de otro no, con motivo sí.
    const quitar = motivo => fetch(`${base}/api/${j.adjunto.id}/anular`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo }),
    });
    const corto = await quitar('no');
    assert.equal(corto.status, 400);
    assert.match((await corto.json()).msg, /al menos 3 letras/);

    srv.como(otro);
    const ajeno = await fetch(`${base}/${j.adjunto.id}/fichero`);
    assert.equal(ajeno.status, 403);
    const sinPermiso = await fetch(`${base}/api/test_tarea/7`, { method: 'POST', body: form });
    assert.equal(sinPermiso.status, 403);
    assert.equal((await quitar('No es suyo')).status, 403);

    srv.como(ana.id);
    const bien = await quitar('Era de otro siniestro');
    assert.equal(bien.status, 200);
    assert.equal((await bien.json()).adjunto.anulado.motivo, 'Era de otro siniestro');
  } finally {
    await srv.cerrar();
  }
}));

test('por HTTP: un formulario mal cerrado da 400 y el servidor sigue en pie', () => conBase(async ({ fabrica, consulta }) => {
  const ana = await persona(fabrica, 'Ana');
  const srv = await servidorDePrueba(ana.id);
  try {
    const antes = ficherosEn(DIR).length;
    // Sin el «--x--» de cierre y con el largo bien dicho: busboy rompe el
    // fichero en el tick siguiente, antes de que subir() lo enganche.
    const cuerpo = '--x\r\nContent-Disposition: form-data; name="fichero"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhola mundo';
    const { respuesta } = peticion(`${srv.base}/api/test_tarea/7`, {
      headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(Buffer.byteLength(cuerpo)) },
      trozos: [cuerpo],
    });
    const r = await respuesta;
    assert.equal(r.status, 400, r.cuerpo);
    assert.equal((await consulta('SELECT count(*)::int AS n FROM adjunto')).rows[0].n, 0);
    assert.equal(ficherosEn(DIR).filter(f => !/\.parcial-/.test(f)).length, antes);
    // Sigue contestando.
    assert.equal((await fetch(`${srv.base}/api/test_tarea/7`)).status, 200);
  } finally {
    await srv.cerrar();
  }
}));

test('por HTTP: un fallo inesperado no enseña el mensaje de la base', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const repo = require('../services/repo/adjuntos');
  const porId = repo.porId;
  repo.porId = async () => { throw new Error('value "100000000000000000000" is out of range for type bigint'); };
  const srv = await servidorDePrueba(ana.id);
  try {
    const r = await fetch(`${srv.base}/123/fichero`);
    assert.equal(r.status, 500);
    const msg = (await r.json()).msg;
    assert.doesNotMatch(msg, /bigint|range/);
    assert.match(msg, /avisa al desarrollador/);
  } finally {
    repo.porId = porId;
    await srv.cerrar();
  }
}));

test('por HTTP: si el navegador se va antes de que conteste el almacén, se suelta', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const a = await adjuntos.subir({ tipo: 'test_tarea', duenoId: '7', nombre: 'v.mp4', mime: 'video/mp4', cuerpo: aTrozos(bytesAlAzar(4 * 1024 * 1024)), quien: ana });
  const disco = almacen.de('disco');
  const leer = disco.leer;
  const vistos = [];
  // El almacén tarda en contestar (como R2 con una petición lenta).
  disco.leer = async (ruta, op) => {
    await esperar(300);
    const s = await leer(ruta, op);
    vistos.push({ s, senal: op.senal });
    return s;
  };
  const srv = await servidorDePrueba(ana.id);
  try {
    const { rq } = peticion(`${srv.base}/${a.id}/fichero`, { method: 'GET', headers: { Range: 'bytes=0-' } });
    await esperar(50);
    rq.destroy();   // cierra el vídeo nada más abrirlo
    await esperar(600);
    assert.equal(vistos.length, 1);
    assert.equal(vistos[0].senal.aborted, true, 'se le avisó al almacén');
    assert.equal(vistos[0].s.destroyed, true, 'y lo que llegó se soltó');
  } finally {
    disco.leer = leer;
    await srv.cerrar();
  }
}));

test('por HTTP: como mucho cuatro subidas a la vez; la quinta espera su turno', () => conBase(async ({ fabrica }) => {
  const ana = await persona(fabrica, 'Ana');
  const srv = await servidorDePrueba(ana.id);
  const abiertas = [];
  try {
    const cabeza = '--x\r\nContent-Disposition: form-data; name="fichero"; filename="lento.bin"\r\nContent-Type: application/octet-stream\r\n\r\n';
    for (let i = 0; i < 4; i++) {
      abiertas.push(peticion(`${srv.base}/api/test_tarea/7`, {
        headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(10 * 1024 * 1024) },
        trozos: [cabeza, bytesAlAzar(1024)], terminar: false,
      }));
    }
    for (let t = 0; t < 100 && srv.rutas.subiendoAhora() < 4; t++) await esperar(20);
    assert.equal(srv.rutas.subiendoAhora(), 4);
    const form = new FormData();
    form.append('fichero', new Blob([Buffer.from('hola')], { type: 'text/plain' }), 'a.txt');
    const quinta = await fetch(`${srv.base}/api/test_tarea/7`, { method: 'POST', body: form });
    assert.equal(quinta.status, 503);
    assert.match((await quinta.json()).msg, /otros ficheros/);
    // Se cortan las cuatro: el contador vuelve a cero y se puede subir.
    abiertas.forEach(a => a.rq.destroy());
    for (let t = 0; t < 100 && srv.rutas.subiendoAhora() > 0; t++) await esperar(20);
    assert.equal(srv.rutas.subiendoAhora(), 0);
    const otra = await fetch(`${srv.base}/api/test_tarea/7`, { method: 'POST', body: form });
    assert.equal(otra.status, 200);
  } finally {
    abiertas.forEach(a => a.rq.destroy());
    await srv.cerrar();
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
    // «Probar conexión» contra el S3 de pruebas.
    const p = await almacen.probar();
    assert.equal(p.ok, true, p.msg);

    // Del tope, con la subida por partes YA abierta (9 MB de tope, 12 de
    // fichero, partes de 5): se aborta y no queda nada en el bucket.
    const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const cuantos = async () => {
      const r = await new S3Client({
        region: 'auto', endpoint: process.env.R2_ENDPOINT, forcePathStyle: true,
        credentials: { accessKeyId: 'prueba', secretAccessKey: 'prueba' },
      }).send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: 'pruebas/' }));
      return r.KeyCount || 0;
    };
    const objetosAntes = await cuantos();
    const enviados = [];
    const send = S3Client.prototype.send;
    S3Client.prototype.send = function (cmd, ...resto) { enviados.push(cmd.constructor.name); return send.call(this, cmd, ...resto); };
    try {
      await parametros.cambiar('adjuntos.max_mb', 9, { usuarioId: ana.id, motivo: 'Prueba del tope' });
      await assert.rejects(adjuntos.subir({ tipo: 'test_tarea', duenoId: '9', nombre: 'g.mp4', mime: 'video/mp4', cuerpo: aTrozos(bytesAlAzar(12 * 1024 * 1024)), quien: ana }),
        e => e.status === 413);
    } finally {
      S3Client.prototype.send = send;
    }
    assert.ok(enviados.includes('CreateMultipartUploadCommand'), enviados.join(' '));
    assert.ok(enviados.includes('AbortMultipartUploadCommand'), 'la subida a medias se aborta: ' + enviados.join(' '));
    assert.equal(await cuantos(), objetosAntes, 'ni un objeto de más en el bucket');
  } finally {
    for (const k of ['ALMACEN', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
      if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k];
    }
    almacen.olvidar();
  }
}));
