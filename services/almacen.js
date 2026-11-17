// ============================================================
// EL ALMACÉN DE FICHEROS — dónde van los bytes de los adjuntos
// ============================================================
// Pieza A6 de docs/Hoja de ruta.md (13/11/2026). Camilo eligió Cloudflare R2:
// 10 GB gratis, unos céntimos por GB después, sin coste por descargar, y no
// depende del Gmail de 15 GB de Drive. R2 habla el idioma de S3, así que el
// cliente es el oficial de AWS y vale también para un S3 de mentira en local.
//
// Aquí solo los BYTES: subir un fichero que llega a trozos (sin cargarlo entero
// en memoria), leer un trozo (para ver un vídeo sin bajarlo entero) y, solo si
// la subida no llega a apuntarse, quitarlo. Qué es cada fichero, de quién y
// quién lo ve lo lleva services/adjuntos.js.
//
// DOS ALMACENES:
//   · 'r2'    — con R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET y
//               R2_ACCOUNT_ID (o R2_ENDPOINT, que manda: así se apunta a un S3
//               de pruebas). Es el de Render.
//   · 'disco' — una carpeta (ALMACEN_DIR, o la temporal del sistema). Solo en
//               local y en las pruebas: en Render el disco se borra en cada
//               despliegue, así que en Render (o con NODE_ENV=production) sin
//               R2 NO HAY almacén y la subida lo dice, en vez de guardar algo
//               que se va a perder.
// ALMACEN=disco o ALMACEN=r2 fuerzan uno.
//
// EL SERVIDOR DE PRUEBAS lleva SU bucket y SU clave (telecab-adjuntos-pruebas),
// nunca los de producción: el prefijo solo separa lo que escribe este código, no
// lo que la clave deja hacer, y allí se prueban ramas sin revisar. Además, con
// MODO_PRUEBAS=1 sus rutas empiezan por «pruebas/».
//
// SI R2 FALLA, se dice en español qué revisar (`traducir`), y el banco de
// adjuntos tiene «Probar conexión» (`probar`): escribe, lee y borra una sonda.
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// LOS TROZOS DE LA SUBIDA A R2: 5 MB, el mínimo de S3 (salvo la última parte),
// y de uno en uno. Cada subida tiene en memoria lo que lleva el trozo en
// curso y el que se está mandando: unos 10-15 MB. Con 8 MB y dos a la vez eran
// unos 40 MB por subida (revisión del 16/11/2026). Lo lento es el móvil que
// sube, no el viaje del servidor a R2, así que apenas se nota.
const PARTE = 5 * 1024 * 1024;

// Las variables, sin los espacios o el salto de línea que se cuelan al pegarlas.
const env = n => String(process.env[n] || '').trim();

const r2Configurado = () => !!(env('R2_ACCESS_KEY_ID') && env('R2_SECRET_ACCESS_KEY') &&
  env('R2_BUCKET') && (env('R2_ACCOUNT_ID') || env('R2_ENDPOINT')));

// En Render el disco se borra en cada despliegue. Render pone RENDER=true en
// todos sus servicios (también en el servidor de pruebas, que puede no llevar
// NODE_ENV=production): ahí, sin R2, no hay almacén.
const enRender = () => process.env.NODE_ENV === 'production' || !!process.env.RENDER;

/** El almacén que toca: 'r2', 'disco' o null (en Render sin R2). */
function cual() {
  const forzado = env('ALMACEN').toLowerCase();
  if (forzado === 'disco' || forzado === 'r2') return forzado;
  if (r2Configurado()) return 'r2';
  return enRender() ? null : 'disco';
}

/** La dirección de R2: la propia (R2_ENDPOINT) o la de la cuenta. */
const direccion = () => env('R2_ENDPOINT') || `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;

/**
 * Lo que está mal puesto en las variables, en español, o null. El Account ID
 * son 32 letras y números (0-9, a-f): con otra cosa (el token, la dirección
 * entera) Cloudflare corta la conexión con un «handshake failure» que no dice
 * nada. Le pasó a Camilo el 16/11/2026.
 */
function problemaConfig() {
  if (cual() !== 'r2') return null;
  if (!r2Configurado()) return 'Faltan variables de R2 en el servidor: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET.';
  if (env('R2_ENDPOINT')) {
    try { new URL(env('R2_ENDPOINT')); } catch (_) { return 'R2_ENDPOINT no es una dirección: tiene que empezar por https://'; }
    return null;
  }
  if (!/^[0-9a-f]{32}$/i.test(env('R2_ACCOUNT_ID'))) {
    return 'R2_ACCOUNT_ID no es un Account ID de Cloudflare: son 32 letras y números, y salen en la página de R2 ' +
      '(«Account Details», o lo que va antes de «.r2.cloudflarestorage.com»). No es el token ni la dirección entera.';
  }
  if (env('R2_ACCOUNT_ID').toLowerCase() === env('R2_ACCESS_KEY_ID').toLowerCase()) {
    return 'R2_ACCOUNT_ID tiene el Access Key ID de la clave: el Account ID es otro, el de la página de R2 («Account Details»).';
  }
  return null;
}

/** Lo que se puede enseñar del almacén, sin secretos (el Account ID no lo es). */
function estado() {
  const a = cual();
  let host = null;
  if (a === 'r2') { try { host = new URL(direccion()).host; } catch (_) { host = null; } }
  return {
    almacen: a,
    r2: r2Configurado(),
    bucket: a === 'r2' ? env('R2_BUCKET') || null : null,
    direccion: host,
    prefijo: prefijo(),
    endpointPropio: a === 'r2' && !!env('R2_ENDPOINT'),
    problema: problemaConfig(),
  };
}

const prefijo = () => (process.env.MODO_PRUEBAS === '1' ? 'pruebas/' : '');

/**
 * Una ruta nueva: «adjuntos/2026/11/<al azar>». Sin nombres ni DNI: en un
 * almacén no se busca por nombre, y lo que va en la ruta no se puede anular.
 */
function rutaNueva(ahora = new Date()) {
  const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0');
  return `${prefijo()}adjuntos/${ahora.getUTCFullYear()}/${mes}/${crypto.randomUUID()}`;
}

// ── R2 (o cualquier S3) ─────────────────────────────────────────────────────
let s3 = null;
function cliente() {
  if (s3) return s3;
  const mal = problemaConfig();
  if (mal || !r2Configurado()) throw conEstado(new Error(mal || 'El almacén de ficheros (R2) no está configurado en el servidor'), 503);
  const { S3Client } = require('@aws-sdk/client-s3');
  s3 = new S3Client({
    region: 'auto',
    endpoint: direccion(),
    forcePathStyle: true,
    credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
    // Las sumas de comprobación que el cliente manda por defecto desde 2025 no
    // las admite todo S3 compatible: solo cuando hacen falta. La huella de
    // verdad (sha256) la calcula services/adjuntos.js al subir.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // Ninguna conexión con R2 se queda colgada para siempre: 10 s para conectar
    // y 2 minutos sin moverse un byte. Un vídeo en pausa más rato pierde su
    // conexión y el navegador la vuelve a pedir con Range, sin que se note.
    requestHandler: { connectionTimeout: 10000, requestTimeout: 120000 },
  });
  return s3;
}

const bucket = () => env('R2_BUCKET');

/**
 * El error de R2 (o de la conexión con R2) en español, con qué revisar. Lo que
 * ya trae su estado (el tope, una subida cortada) o es un corte nuestro se deja
 * como está. → el error, con `status` 503 (404 si el fichero no está).
 */
function traducir(e) {
  if (!e || e.status || e.name === 'AbortError') return e;
  const codigo = String(e.code || e.Code || '');
  const nombre = String(e.name || '');
  const http = e.$metadata && e.$metadata.httpStatusCode;
  const texto = String(e.message || '');
  let msg = null;
  let status = 503;
  if (nombre === 'NoSuchKey') { msg = 'El fichero no está en el almacén'; status = 404; }
  else if (codigo === 'EPROTO' || /handshake failure|alert number 40|ERR_SSL/i.test(codigo + ' ' + texto)) {
    msg = 'Cloudflare no reconoce la dirección de R2: revisa R2_ACCOUNT_ID (32 letras y números, el de la página de R2) o R2_ENDPOINT.';
  } else if (['ENOTFOUND', 'EAI_AGAIN'].includes(codigo)) {
    msg = 'No se encuentra la dirección de R2: revisa R2_ACCOUNT_ID o R2_ENDPOINT.';
  } else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(codigo) || /TimeoutError|RequestTimeout/.test(nombre)) {
    msg = 'R2 no contesta ahora mismo. Inténtalo de nuevo en un momento.';
  } else if (nombre === 'InvalidAccessKeyId' || (nombre === 'Unauthorized' && http === 401)) {
    msg = 'Cloudflare no conoce esa clave de R2: revisa R2_ACCESS_KEY_ID (el «Access Key ID» del token).';
  } else if (nombre === 'SignatureDoesNotMatch') {
    msg = 'El secreto de R2 no casa con la clave: revisa R2_SECRET_ACCESS_KEY (el «Secret Access Key» del token).';
  } else if (nombre === 'NoSuchBucket' || (nombre === 'NotFound' && http === 404)) {
    msg = `No existe el bucket «${bucket()}» en esa cuenta de Cloudflare: revisa R2_BUCKET.`;
  } else if (nombre === 'AccessDenied' || nombre === 'Forbidden' || http === 403) {
    msg = `La clave de R2 no tiene permiso sobre el bucket «${bucket()}»: en Cloudflare, dale «Object Read & Write» a ese bucket.`;
  }
  if (!msg) return e;
  const t = conEstado(new Error(msg), status);
  t.causa = e;
  if (status === 404) t.name = 'NoSuchKey';
  return t;
}

const r2 = {
  async subir(ruta, cuerpo, { mime } = {}) {
    const { Upload } = require('@aws-sdk/lib-storage');
    const subida = new Upload({
      client: cliente(),
      params: { Bucket: bucket(), Key: ruta, Body: cuerpo, ContentType: mime || 'application/octet-stream' },
      partSize: PARTE,
      queueSize: 1,
      leavePartsOnError: false,   // si se corta, no deja trozos sueltos pagando
    });
    try { await subida.done(); } catch (e) { throw traducir(e); }
  },
  /** `senal`: si se aborta (el navegador se fue), se deja de esperar a R2. */
  async leer(ruta, { desde, hasta, senal } = {}) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    try {
      const r = await cliente().send(new GetObjectCommand({
        Bucket: bucket(), Key: ruta,
        Range: desde != null ? `bytes=${desde}-${hasta}` : undefined,
      }), senal ? { abortSignal: senal } : undefined);
      return r.Body;
    } catch (e) { throw traducir(e); }
  },
  async borrar(ruta) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    try { await cliente().send(new DeleteObjectCommand({ Bucket: bucket(), Key: ruta })); } catch (e) { throw traducir(e); }
  },
};

/**
 * «Probar conexión» del banco: escribe una sonda pequeña, la lee y la borra.
 * Prueba lo mismo que una subida (la dirección, la clave, el secreto, el
 * bucket y el permiso de escribir y borrar) sin que quede nada.
 *   → { ok, almacen, pasos: [{ paso, ok, ms }], msg }
 */
async function probar() {
  const a = cual();
  if (!a) return { ok: false, almacen: null, pasos: [], msg: 'No hay almacén: faltan las variables de R2 en el servidor.' };
  const mal = problemaConfig();
  if (mal) return { ok: false, almacen: a, pasos: [], msg: mal };
  const ruta = `${prefijo()}sonda/${crypto.randomUUID()}`;
  const contenido = Buffer.from(`sonda del banco de adjuntos ${new Date().toISOString()}`);
  const pasos = [];
  const paso = async (nombre, fn) => {
    const t0 = Date.now();
    try { await fn(); pasos.push({ paso: nombre, ok: true, ms: Date.now() - t0 }); }
    catch (e) { pasos.push({ paso: nombre, ok: false, ms: Date.now() - t0 }); throw e; }
  };
  try {
    const al = de(a);
    await paso('escribir', () => al.subir(ruta, Readable.from([contenido]), { mime: 'text/plain' }));
    await paso('leer', async () => {
      const t = [];
      for await (const c of await al.leer(ruta)) t.push(c);
      if (!Buffer.concat(t).equals(contenido)) throw conEstado(new Error('Lo leído no es lo escrito: el almacén devuelve otra cosa'), 503);
    });
    await paso('borrar', () => al.borrar(ruta));
    return { ok: true, almacen: a, pasos, msg: null };
  } catch (e) {
    const t = traducir(e);
    if (!t.status) console.error('❌ [Almacén] probar:', e.stack || e.message);
    return { ok: false, almacen: a, pasos, msg: t.status ? t.message : `Falló sin un motivo conocido: ${String(e.name || '')} ${String(e.message || '').slice(0, 200)}` };
  }
}

// ── Disco (local y pruebas) ─────────────────────────────────────────────────
const raizDisco = () => path.resolve(process.env.ALMACEN_DIR || path.join(os.tmpdir(), 'telecab-almacen'));

/** El fichero de una ruta, sin salirse de la carpeta del almacén. */
function ficheroDe(ruta) {
  const raiz = raizDisco();
  const f = path.resolve(raiz, ...String(ruta).split('/'));
  if (!f.startsWith(raiz + path.sep)) throw new Error('Ruta de almacén no válida');
  return f;
}

const disco = {
  async subir(ruta, cuerpo) {
    const f = ficheroDe(ruta);
    // Si el cuerpo se rompe mientras se crea la carpeta, que no salte como un
    // error sin dueño (tumbaría el proceso): lo recoge el pipeline de abajo.
    const guardia = () => {};
    cuerpo.on('error', guardia);
    try { await fsp.mkdir(path.dirname(f), { recursive: true }); } finally { cuerpo.off('error', guardia); }
    // Primero a un fichero a medias y luego se renombra: un corte no deja un
    // fichero cortado con el nombre bueno.
    const parcial = `${f}.parcial-${crypto.randomUUID()}`;
    try {
      await pipeline(cuerpo, fs.createWriteStream(parcial));
      await fsp.rename(parcial, f);
    } catch (e) {
      await fsp.rm(parcial, { force: true }).catch(() => {});
      throw e;
    }
  },
  async leer(ruta, { desde, hasta } = {}) {
    const f = ficheroDe(ruta);
    await fsp.access(f);
    return fs.createReadStream(f, desde != null ? { start: desde, end: hasta } : {});
  },
  async borrar(ruta) {
    await fsp.rm(ficheroDe(ruta), { force: true });
  },
};

const ALMACENES = { r2, disco };

/** El almacén por su nombre (el que guarda cada adjunto en su fila). */
function de(nombre) {
  const a = ALMACENES[nombre];
  if (!a) throw new Error(`No existe el almacén «${nombre}»`);
  return a;
}

function conEstado(e, status) { e.status = status; return e; }

/** Para las pruebas: que el cliente de R2 se vuelva a crear con el entorno nuevo. */
function olvidar() { s3 = null; }

module.exports = { cual, estado, rutaNueva, de, r2Configurado, olvidar, probar, traducir, problemaConfig, PARTE };
