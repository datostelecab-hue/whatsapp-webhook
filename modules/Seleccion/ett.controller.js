// ============================================================
// ETT — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
// Mismo contrato que las demás pantallas: /api/lista → { filas, … } y
// /api/ficha/:id. Ya no hay hoja ETT_CANDIDATOS.
//
// LAS DOS DESCARGAS NO PASAN POR `responde`, y no es un descuido: devuelven
// BYTES, no JSON. Una descarga del navegador tampoco sabe enseñar un error —si
// el servidor se niega, el fichero simplemente no aparece—, y por eso existe
// `/api/comprobar`: se pregunta antes, y solo si dice que sí se lanza.

const express = require('express');
const router = express.Router();
const ett = require('./ett.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({
  usuarioId: await actor.idDe(req),
  rol: (req.usuario || {}).rol || '',
});

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [ETT] ${req.method} ${req.path}: ${e.message}`);
    res.status(400).json({ status: 'error', msg: e.message, conflicto: e.conflicto });
  }
};

/** El Excel que pide la pantalla, sea de una tanda o de unos elegidos. */
const descarga = (fn, etiqueta) => async (req, res) => {
  try {
    const { bytes, nombre } = await fn(req);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    console.error(`❌ [ETT] ${etiqueta}:`, e.message);
    // `sinDecidir` viaja con el error: son los que aún no tienen estado, y sin
    // sus nombres la pantalla solo puede decir "no se puede" y dejar ahí a quien
    // lo lee.
    res.status(400).json({ status: 'error', msg: e.message, sinDecidir: e.sinDecidir || null });
  }
};

const solicitudDe = req =>
  (/^\d+$/.test(req.query.solicitud || '') ? Number(req.query.solicitud) : null);

router.get('/', async (req, res) => {
  res.render('ett', {
    titulo: 'ETT · Bolsa de empleo', seccion: 'ett', layout: 'layout-gestion',
    ...(await ett.paraLaPantalla()),
  });
});

// ── Lectura ────────────────────────────────────────────────────────────────

router.get('/api/lista', responde(() => ett.lista()));

router.get('/api/ficha/:id', responde(req => ett.ficha(req.params.id)));

router.get('/api/catalogos', responde(() => ett.catalogos()));

// Vacantes ABIERTAS (las del generador) para elegir al dar de alta.
router.get('/api/vacantes-abiertas', responde(() => ett.vacantesAbiertas()));

// ── Importar la matriz del correo ──────────────────────────────────────────
router.post('/api/importar', responde(async req => {
  const b = req.body || {};
  return ett.importar({
    texto: b.texto, solicitudId: b.solicitudId, referencia: b.referencia, recibida: b.recibida,
  }, await quien(req));
}));

// ── Escritura ──────────────────────────────────────────────────────────────

router.put('/api/candidatura/:id', responde(async req =>
  ett.guardar(req.params.id, req.body || {}, await quien(req))));

router.post('/api/candidatura/:id/estado', responde(async req => {
  const b = req.body || {};
  return ett.cambiarEstado(req.params.id, b.estado, b.motivo, await quien(req));
}));

router.post('/api/candidatura/:id/descartar', responde(async req => {
  const b = req.body || {};
  return ett.descartar(req.params.id,
    { motivoCodigo: b.motivoCodigo, detalle: b.detalle }, await quien(req));
}));

router.post('/api/candidatura/:id/rrhh', responde(async req =>
  ett.pasarARRHH(req.params.id, req.body || {}, await quien(req))));

router.post('/api/alta-rapida', responde(async req =>
  ett.altaRapida(req.body || {}, await quien(req))));

// Borrar una candidatura que no debería existir: un teléfono mal tecleado, una
// fila duplicada, una prueba. NO es descartar — descartar deja rastro porque es
// una decisión del proceso. Se niega si la persona ha trabajado aquí.
router.delete('/api/candidatura/:id', responde(async req =>
  ett.eliminar(req.params.id, await quien(req))));

// ── Lo que se le devuelve a la agencia ─────────────────────────────────────
//
// Las solicitudes NO tienen ruta propia: van dentro de `/api/lista`, que es la
// única llamada que hace la pantalla al entrar. Tenerlas también aparte era un
// segundo sitio del que sacar lo mismo.
//
// Y cerrar una a mano tampoco: se cierra sola al mandar el envío en el que ya
// no queda nadie pendiente.

router.post('/api/solicitud/:id/enviado', responde(async req =>
  ett.registrarEnvio(req.params.id, (req.body || {}).formato, await quien(req))));

router.get('/api/comprobar', responde(req => ett.comprobar(solicitudDe(req))));

// El de la tanda entera: LA respuesta oficial a una petición suya, y por eso va
// completa o no va.
router.get('/api/excel', descarga(req => ett.excelDeTanda(solicitudDe(req)), 'excel'));

// El de unos elegidos a mano. Va por POST y no por GET porque la lista puede ser
// larga y no cabe cómoda en una URL; como una descarga por POST no la sabe hacer
// un enlace, la pantalla lo pide por fetch y guarda el fichero desde el navegador.
router.post('/api/excel-elegidos', descarga(req =>
  ett.excelDeElegidos((req.body || {}).ids), 'excel elegidos'));


// ── La foto de la persona ──────────────────────────────────────────────────
// OPCIONAL. Se sirve por el ERP con sus permisos, y la pantalla la pide con el
// id del documento en la URL (?v=): puede guardarse un dia en el navegador sin
// miedo, porque una foto nueva es otra URL.
router.get('/api/candidatura/:id/foto', async (req, res) => {
  try {
    const f = await ett.foto(req.params.id);
    if (!f) return res.status(404).send('Sin foto');
    res.setHeader('Content-Type', f.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(f.bytes);
  } catch (e) {
    res.status(404).send('Sin foto');
  }
});

router.post('/api/candidatura/:id/foto', express.json({ limit: '6mb' }), responde(async req =>
  ett.subirFoto(req.params.id, req.body || {}, await quien(req))));

module.exports = router;
