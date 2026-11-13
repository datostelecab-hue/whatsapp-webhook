// ============================================================
// LOS ADJUNTOS — las rutas de todos (/adjuntos, db/249)
// ============================================================
// Las mismas para cualquier dueño (una tarea, un mensaje, un siniestro…). Quién
// puede ver o adjuntar lo dice el módulo dueño al registrarse en
// services/adjuntos.js, no esta ruta: por eso /adjuntos no está en el catálogo
// de permisos (entra cualquiera con sesión, y cada fichero se comprueba).
//
//   POST /adjuntos/api/:tipo/:dueno       sube UN fichero (multipart, por trozos)
//   GET  /adjuntos/api/:tipo/:dueno       los adjuntos de ese dueño
//   POST /adjuntos/api/:id/anular         quitarlo, con motivo (nada se borra)
//   GET  /adjuntos/:id/fichero            el fichero (con Range; ?descargar=1 lo baja)
//   GET  /adjuntos/banco                  el banco de pruebas (solo el desarrollador)
//
// Quién lo hace sale de la sesión, nunca del cuerpo de la petición.
'use strict';

const express = require('express');
const busboy = require('busboy');
const router = express.Router();
const sesion = require('../../services/sesion');
const actor = require('../../services/repo/actor');
const adjuntos = require('../../services/adjuntos');
const almacen = require('../../services/almacen');

// EL BANCO DE PRUEBAS: el desarrollador adjunta a su propio «dueño de pruebas»
// (su id de usuario). Sirve para ver que el almacén funciona en cada sitio
// (local, servidor de pruebas, Render) antes de que lo use un módulo de verdad.
const esSuyo = async (quien, id) => quien.rol === 'desarrollador' && String(quien.id) === String(id);
adjuntos.registrarDueno('prueba', { etiqueta: 'Banco de pruebas', ver: esSuyo, adjuntar: esSuyo });

const quienEs = async req => {
  const id = (req.usuario && req.usuario.id) || await actor.idDe(req);
  return { id: id ? Number(id) : null, rol: req.usuario ? req.usuario.rol : null };
};

const conEstado = (e, status) => { e.status = status; return e; };

function fallo(res, e, que) {
  if (!e.status || e.status >= 500) console.error(`❌ [Adjuntos] ${que}:`, e.stack || e.message);
  if (res.headersSent) return res.destroy();
  res.status(e.status || 500).json({ status: 'error', msg: e.message });
}

/**
 * El primer fichero del formulario, en cuanto empieza a llegar: { nombre, mime,
 * cuerpo }. El cuerpo es un stream que se va llenando; no se espera a tenerlo
 * entero. Si la conexión se corta a medias, el stream se rompe con un error y
 * la subida se tira.
 */
function primerFichero(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      // `defParamCharset`: el navegador manda el nombre del fichero en UTF-8, y
      // busboy, si no se le dice, lo lee como latin1 («vÃ­deo» en vez de «vídeo»).
      bb = busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: 1, fields: 5, fieldSize: 1024, parts: 6 } });
    } catch (_) {
      return reject(conEstado(new Error('La subida tiene que llegar como formulario (multipart/form-data)'), 400));
    }
    let cuerpo = null;
    bb.on('file', (_campo, stream, info) => {
      if (cuerpo) { stream.resume(); return; }   // solo uno por subida
      cuerpo = stream;
      resolve({ nombre: info.filename, mime: info.mimeType, cuerpo: stream });
    });
    bb.on('error', e => {
      if (cuerpo) cuerpo.destroy(conEstado(e, 400));
      else reject(conEstado(e, 400));
    });
    bb.on('close', () => { if (!cuerpo) reject(conEstado(new Error('No ha llegado ningún fichero'), 400)); });
    req.on('close', () => {
      if (!req.complete && cuerpo && !cuerpo.destroyed) cuerpo.destroy(conEstado(new Error('La subida se cortó a medias'), 400));
    });
    req.pipe(bb);
  });
}

// ── El banco de pruebas ─────────────────────────────────────────────────────
router.get('/banco', sesion.requiereDesarrollador, (req, res) => {
  res.render('adjuntosBanco', { titulo: 'Banco de adjuntos', seccion: 'adjuntos', layout: 'layout-gestion' });
});

router.get('/api/estado', sesion.requiereDesarrollador, async (req, res) => {
  try {
    res.json({ status: 'ok', ...almacen.estado(), maxMb: (await adjuntos.maxBytes()) / 1048576, yo: (await quienEs(req)).id });
  } catch (e) { fallo(res, e, 'estado'); }
});

// ── Quitar (antes que la de subir: «/api/123/anular» también casaría con ella) ──
router.post('/api/:id(\\d+)/anular', async (req, res) => {
  try {
    res.json({ status: 'ok', adjunto: await adjuntos.anular(req.params.id, (req.body || {}).motivo, await quienEs(req)) });
  } catch (e) { fallo(res, e, `anular ${req.params.id}`); }
});

// ── Los de un dueño ─────────────────────────────────────────────────────────
router.get('/api/:tipo/:dueno', async (req, res) => {
  try {
    const lista = await adjuntos.lista(req.params.tipo, req.params.dueno, await quienEs(req));
    // El tope va con la lista: la pantalla rechaza un fichero grande ANTES de subirlo.
    res.json({ status: 'ok', adjuntos: lista, maxMb: (await adjuntos.maxBytes()) / 1048576 });
  } catch (e) { fallo(res, e, `lista ${req.params.tipo} ${req.params.dueno}`); }
});

// ── Subir ───────────────────────────────────────────────────────────────────
router.post('/api/:tipo/:dueno', async (req, res) => {
  try {
    const quien = await quienEs(req);
    // El permiso y el tamaño, ANTES de leer nada: si no puede, no se sube nada.
    await adjuntos.exigirAdjuntar(req.params.tipo, req.params.dueno, quien);
    const tope = await adjuntos.maxBytes();
    const largo = Number(req.headers['content-length'] || 0);
    if (largo > tope + 1024 * 1024) {
      throw conEstado(new Error(`El fichero pasa de ${Math.round(tope / 1048576)} MB, que es lo máximo que se puede adjuntar`), 413);
    }
    const f = await primerFichero(req);
    const adjunto = await adjuntos.subir({
      tipo: req.params.tipo, duenoId: req.params.dueno, nombre: f.nombre, mime: f.mime, cuerpo: f.cuerpo, quien,
    });
    res.json({ status: 'ok', adjunto });
  } catch (e) {
    // Lo que quede del cuerpo se tira: si no, la petición se queda colgada.
    req.unpipe();
    req.resume();
    fallo(res, e, `subir ${req.params.tipo} ${req.params.dueno}`);
  }
});

// ── El fichero ──────────────────────────────────────────────────────────────
async function fichero(req, res) {
  try {
    const r = await adjuntos.servir(req.params.id, await quienEs(req), {
      rango: req.headers.range,
      siNoCoincide: req.headers['if-none-match'],
      siRango: req.headers['if-range'],
      descargar: req.query.descargar === '1',
      soloCabeceras: req.method === 'HEAD',
    });
    res.status(r.estado).set(r.cabeceras);
    if (!r.cuerpo) return res.end();
    r.cuerpo.on('error', e => {
      console.error(`❌ [Adjuntos] leer ${req.params.id}:`, e.message);
      res.destroy(e);
    });
    // Si el navegador deja de pedir (salta a otro punto del vídeo), se suelta el almacén.
    res.on('close', () => { if (!res.writableFinished && typeof r.cuerpo.destroy === 'function') r.cuerpo.destroy(); });
    r.cuerpo.pipe(res);
  } catch (e) {
    const falta = e.name === 'NoSuchKey' || e.code === 'ENOENT';
    fallo(res, falta ? conEstado(new Error('El fichero no está en el almacén'), 404) : e, `fichero ${req.params.id}`);
  }
}
// Express contesta también los HEAD con esta (sin cuerpo: `soloCabeceras`).
router.get('/:id(\\d+)/fichero', fichero);

module.exports = router;
