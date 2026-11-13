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
//               despliegue, así que en producción sin R2 NO HAY almacén y la
//               subida lo dice, en vez de guardar algo que se va a perder.
// ALMACEN=disco o ALMACEN=r2 fuerzan uno.
//
// EN EL SERVIDOR DE PRUEBAS (MODO_PRUEBAS=1) las rutas empiezan por «pruebas/»:
// aunque se le ponga el bucket de producción, lo suyo no se mezcla.
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const PARTE = 8 * 1024 * 1024;   // los trozos de la subida a R2: 8 MB

const r2Configurado = () => !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET && (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT));

/** El almacén que toca: 'r2', 'disco' o null (en producción sin R2). */
function cual() {
  const forzado = String(process.env.ALMACEN || '').toLowerCase();
  if (forzado === 'disco' || forzado === 'r2') return forzado;
  if (r2Configurado()) return 'r2';
  return process.env.NODE_ENV === 'production' ? null : 'disco';
}

/** Lo que se puede enseñar del almacén, sin secretos. */
function estado() {
  const a = cual();
  return {
    almacen: a,
    r2: r2Configurado(),
    bucket: a === 'r2' ? process.env.R2_BUCKET || null : null,
    prefijo: prefijo(),
    endpointPropio: a === 'r2' && !!process.env.R2_ENDPOINT,
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
  if (!r2Configurado()) throw conEstado(new Error('El almacén de ficheros (R2) no está configurado en el servidor'), 503);
  const { S3Client } = require('@aws-sdk/client-s3');
  s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    // Las sumas de comprobación que el cliente manda por defecto desde 2025 no
    // las admite todo S3 compatible: solo cuando hacen falta. La huella de
    // verdad (sha256) la calcula services/adjuntos.js al subir.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return s3;
}

const r2 = {
  async subir(ruta, cuerpo, { mime } = {}) {
    const { Upload } = require('@aws-sdk/lib-storage');
    const subida = new Upload({
      client: cliente(),
      params: { Bucket: process.env.R2_BUCKET, Key: ruta, Body: cuerpo, ContentType: mime || 'application/octet-stream' },
      partSize: PARTE,
      queueSize: 2,
      leavePartsOnError: false,   // si se corta, no deja trozos sueltos pagando
    });
    await subida.done();
  },
  async leer(ruta, { desde, hasta } = {}) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const r = await cliente().send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: ruta,
      Range: desde != null ? `bytes=${desde}-${hasta}` : undefined,
    }));
    return r.Body;
  },
  async borrar(ruta) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await cliente().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: ruta }));
  },
};

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
    await fsp.mkdir(path.dirname(f), { recursive: true });
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

module.exports = { cual, estado, rutaNueva, de, r2Configurado, olvidar, PARTE };
