// ============================================================
// SELECCIÓN — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
// Mismo contrato que Vehículos y Plantilla, para que el componente `Listado` no
// tenga que aprender nada nuevo:
//   · /api/lista      → { filas, resumen }
//   · /api/ficha/:id  → la ficha entera

const express = require('express');
const multer = require('multer');
const router = express.Router();
const seleccion = require('./seleccion.service');
const actor = require('../../services/repo/actor');

// Los archivos llegan como multipart (no JSON), así que esquivan el límite
// global de 2 MB de app.js. En memoria; hasta 25 MB por archivo.
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** Quién hace el cambio. Todo lo que escribe pasa por aquí. */
const quien = async req => ({
  usuarioId: await actor.idDe(req),
  rol: (req.usuario || {}).rol || '',
});

/** Recoge el error y lo devuelve legible, sin repetirlo diez veces. */
const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [SELECCIÓN] ${req.method} ${req.path}: ${e.message}`);
    // `conflicto` y `situacion` viajan con el error: dicen de QUIÉN se trata y
    // qué se puede hacer. Sin eso la pantalla solo puede enseñar un mensaje y
    // dejar a quien lo lee sin salida.
    res.status(400).json({ status: 'error', msg: e.message, conflicto: e.conflicto, situacion: e.situacion });
  }
};

router.get('/', async (req, res) => {
  res.render('seleccion', {
    titulo: 'Selección', seccion: 'seleccion', layout: 'layout-gestion',
    ...(await seleccion.paraLaPantalla()),
  });
});

// ── Lectura ────────────────────────────────────────────────────────────────

router.get('/api/lista', responde(req =>
  seleccion.lista({ incluirCerradas: req.query.cerradas === '1' })));

router.get('/api/ficha/:id', responde(req => seleccion.ficha(req.params.id)));

router.get('/api/catalogos', responde(() => seleccion.catalogos()));

// Qué hay detrás de un teléfono ANTES de abrir nada: si hay proceso vivo, si
// tenemos ficha suya y si está en BOLT, con qué número. Es lo que deja decidir
// entre continuar, restaurar o empezar de cero.
router.get('/api/telefono/:tel', responde(req => seleccion.porTelefono(req.params.tel)));

// ── Escritura ──────────────────────────────────────────────────────────────

router.post('/api/candidatura', responde(async req =>
  seleccion.abrir((req.body || {}).telefono, req.body || {}, await quien(req))));

router.put('/api/candidatura/:id', responde(async req =>
  seleccion.guardar(req.params.id, req.body || {}, await quien(req))));

router.post('/api/candidatura/:id/estado', responde(async req => {
  const b = req.body || {};
  return seleccion.cambiarEstado(req.params.id, b.estado, b.motivo, await quien(req));
}));

// Selección termina: se le abre el contrato y pasa a RRHH.
router.post('/api/candidatura/:id/rrhh', responde(async req =>
  seleccion.pasarARRHH(req.params.id, req.body || {}, await quien(req))));

// Borrar una candidatura que no debería existir: un teléfono mal tecleado, una
// fila duplicada, una prueba. NO es descartar — descartar deja rastro porque es
// una decisión del proceso. Se niega si la persona ha trabajado aquí.
router.delete('/api/candidatura/:id', responde(async req =>
  seleccion.eliminar(req.params.id, await quien(req))));

// ── Documentos ─────────────────────────────────────────────────────────────
// Van a la tabla `documento`, que es de la PERSONA. Los bytes siguen en Drive;
// lo que cambia es que ahora están indexados, con su tipo y su caducidad, en vez
// de ser un JSON dentro de una celda.

router.post('/api/candidatura/:id/documento', subida.single('archivo'), responde(async req => {
  const b = req.body || {};
  return seleccion.subirDocumento(req.params.id, {
    tipo: b.tipo, emision: b.emision, caduca: b.caduca, archivo: req.file,
  }, await quien(req));
}));

router.delete('/api/documento/:docId', responde(async req =>
  ({ retirado: await seleccion.retirarDocumento(req.params.docId, await quien(req)) })));

// ── La FICHA DE ALTA en PDF ────────────────────────────────────────────────
router.post('/api/candidatura/:id/ficha-pdf', responde(req => seleccion.fichaPDF(req.params.id)));

// ── Geocodificación ────────────────────────────────────────────────────────
router.post('/api/geocodificar', responde(req => seleccion.direccion(req.body || {})));


// ── La foto de la persona ──────────────────────────────────────────────────
// OPCIONAL. Se sirve por el ERP con sus permisos, y la pantalla la pide con el
// id del documento en la URL (?v=): puede guardarse un dia en el navegador sin
// miedo, porque una foto nueva es otra URL.
router.get('/api/candidatura/:id/foto', async (req, res) => {
  try {
    const f = await seleccion.foto(req.params.id);
    if (!f) return res.status(404).send('Sin foto');
    res.setHeader('Content-Type', f.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(f.bytes);
  } catch (e) {
    res.status(404).send('Sin foto');
  }
});

router.post('/api/candidatura/:id/foto', express.json({ limit: '6mb' }), responde(async req =>
  seleccion.subirFoto(req.params.id, req.body || {}, await quien(req))));

module.exports = router;
