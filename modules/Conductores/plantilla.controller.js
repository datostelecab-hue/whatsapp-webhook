// ============================================================
// PLANTILLA — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
// Mismo contrato que vehículos, para que el componente `Listado` no tenga que
// aprender nada nuevo:
//   · /api/lista       → { filas, resumen }
//   · /api/ficha/:id   → la ficha entera

const express = require('express');
const router = express.Router();
const plantilla = require('./plantilla.service');
const fantasma = require('./fantasma.service');
const actor = require('../../services/repo/actor');

// Los archivos llegan en base64 dentro del JSON. El parser global es de 2 MB y
// un DNI escaneado se pasa de largo, así que aquí va su propio límite.
router.use('/api/documento', express.json({ limit: '30mb' }));

/** Quién hace el cambio y con qué rol. Todo lo que escribe pasa por aquí. */
const quien = async req => ({
  usuarioId: await actor.idDe(req),
  rol: (req.usuario || {}).rol || '',
});

/** Envoltorio: recoge el error y lo devuelve legible, sin repetirlo diez veces. */
const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [PLANTILLA] ${req.method} ${req.path}: ${e.message}`);
    // `conflicto` viaja con el error: dice QUIÉN es la persona que ya existe y
    // si está de alta. Sin eso, la pantalla solo puede enseñar un mensaje y
    // dejar a quien lo lee sin saber qué hacer.
    res.status(400).json({ status: 'error', msg: e.message, conflicto: e.conflicto });
  }
};

// `momento` deja mirar la plantilla de una fecha pasada. Se valida aquí porque
// es lo que llega por la URL; lo que significa, lo sabe el servicio.
const momentoDe = req => (/^\d{4}-\d{2}-\d{2}$/.test(req.query.momento || '') ? req.query.momento : null);

router.get('/', async (req, res) => {
  res.render('plantilla', {
    titulo: 'Plantilla', seccion: 'plantilla', layout: 'layout-gestion',
    ...(await plantilla.paraLaPantalla()),
  });
});

// ── Lectura ────────────────────────────────────────────────────────────────

// Sin `status: 'ok'` a propósito en las dos primeras: la pantalla lleva desde
// siempre leyendo `{ filas, resumen }` y la ficha en la raíz de la respuesta.
router.get('/api/lista', async (req, res) => {
  try {
    res.json(await plantilla.lista({ momento: momentoDe(req), soloVigentes: req.query.vigentes === '1' }));
  } catch (e) {
    console.error('❌ [PLANTILLA] /api/lista:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

router.get('/api/ficha/:id', async (req, res) => {
  try {
    res.json(await plantilla.ficha(req.params.id, { momento: momentoDe(req) }));
  } catch (e) {
    const noExiste = /No existe/.test(e.message);
    if (!noExiste) console.error('❌ [PLANTILLA] /api/ficha:', e.message);
    res.status(noExiste ? 404 : 500).json({ status: 'error', msg: e.message });
  }
});

router.get('/api/ficha360/:id', responde(req => plantilla.hoja(req.params.id)));

router.get('/api/catalogos', async (req, res) => {
  try { res.json(await plantilla.catalogos()); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.get('/api/campos', responde(req => plantilla.campos((req.usuario || {}).rol)));

// ── BOLT ───────────────────────────────────────────────────────────────────

router.get('/api/bolt-libres', responde(async req =>
  ({ cuentas: await plantilla.boltLibres(req.query.q) })));

router.get('/api/bolt-sugerencias', responde(async req =>
  ({ sugerencias: await plantilla.boltSugerencias(req.query.todos) })));

router.post('/api/bolt-auto', responde(async req =>
  plantilla.boltAuto((req.body || {}).todos, (await quien(req)).usuarioId)));

router.get('/api/alta-bolt', responde(async req =>
  ({ conductores: await plantilla.altaEnBolt({ todos: req.query.todos, situacion: req.query.situacion }) })));

router.get('/api/bolt-estado', responde(async () => ({ estado: await plantilla.boltEstado() })));

// RRHH NO llama a BOLT. Ni aquí ni en ninguna pantalla: los datos los trae la
// ingesta cada pocos minutos y aquí solo se lee de PostgreSQL. Lo único que se
// ofrece es saber DE CUÁNDO son, que es lo que sustituye a preguntar.
router.get('/api/frescura', responde(() => plantilla.frescura()));

// ── Escritura ──────────────────────────────────────────────────────────────

router.post('/api/conductor', responde(async req =>
  plantilla.crear(req.body || {}, await quien(req))));

router.put('/api/conductor/:id', responde(async req =>
  plantilla.actualizar(req.params.id, req.body || {}, await quien(req))));

router.post('/api/conductor/:id/situacion', responde(async req =>
  plantilla.cambiarSituacion(req.params.id, req.body || {}, await quien(req))));

router.post('/api/conductor/:id/ausencia', responde(async req =>
  plantilla.anadirAusencia(req.params.id, req.body || {}, await quien(req))));

router.put('/api/conductor/:id/situacion/:filaId', responde(async req =>
  plantilla.editarAusencia(req.params.id, req.params.filaId, req.body || {}, await quien(req))));

router.delete('/api/conductor/:id/situacion/:filaId', responde(async req =>
  plantilla.borrarAusencia(req.params.id, req.params.filaId, await quien(req))));

router.post('/api/conductor/:id/turno', responde(async req =>
  plantilla.cambiarTurno(req.params.id, req.body || {}, await quien(req))));

router.post('/api/conductor/:id/libranza', responde(async req =>
  plantilla.guardarLibranza(req.params.id, req.body || {}, await quien(req))));

router.post('/api/conductor/:id/telefono', responde(async req =>
  plantilla.guardarTelefono(req.params.id, (req.body || {}).e164, await quien(req))));

router.post('/api/conductor/:id/bolt', responde(async req =>
  plantilla.enlazarBolt(req.params.id, (req.body || {}).cuentaId, await quien(req))));

router.delete('/api/conductor/:id/bolt/:cuentaId', responde(async req =>
  plantilla.soltarBolt(req.params.id, req.params.cuentaId, await quien(req))));

// ── Cuentas fantasma ────────────────────────────────────────────────────────
// Cuando a alguien le suspenden su cuenta y sale a trabajar con la de otro. Ver
// modules/Conductores/fantasma.service.js.
router.get('/api/conductor/:id/fantasma', responde(req => fantasma.listar(req.params.id)
  .then(enlaces => ({ enlaces }))));

router.get('/api/fantasma/prestables', responde(req => fantasma.prestables(req.query.q)
  .then(cuentas => ({ cuentas }))));

router.post('/api/conductor/:id/fantasma', responde(async req =>
  fantasma.enlazar({ ...(req.body || {}), conductorId: req.params.id }, await quien(req))));

router.put('/api/fantasma/:enlaceId', responde(async req =>
  fantasma.cambiarFechas({ ...(req.body || {}), id: req.params.enlaceId }, await quien(req))));

router.post('/api/fantasma/:enlaceId/cerrar', responde(async req =>
  fantasma.cerrarHoy(req.params.enlaceId, await quien(req))));

router.delete('/api/fantasma/:enlaceId', responde(async req =>
  fantasma.anular({ id: req.params.enlaceId, motivo: (req.body || {}).motivo }, await quien(req))));

router.post('/api/conductor/:id/alta', responde(async req =>
  plantilla.darDeAlta(req.params.id, req.body || {}, await quien(req))));

router.post('/api/conductor/:id/baja', responde(async req =>
  plantilla.darDeBaja(req.params.id, req.body || {}, await quien(req))));

router.post('/api/conductor/:id/a-propia', responde(async req =>
  plantilla.aPropia(req.params.id, req.body || {}, await quien(req))));

router.post('/api/conductor/:id/jornada', responde(async req =>
  plantilla.cambiarJornada(req.params.id, req.body || {}, await quien(req))));

router.get('/api/conductor/:id/cambios', responde(req => plantilla.cambios(req.params.id)));

// La misma persona en dos coches el mismo día.
router.get('/api/conflictos', responde(req => plantilla.conflictos(req.query.momento)));

// ── El Excel de la gestoría ────────────────────────────────────────────────
// Con el punto en la ruta a propósito: así el navegador nombra bien la descarga.
router.get('/api/gestoria.xlsx', async (req, res) => {
  try {
    const { bytes, nombre } = await plantilla.excelGestoria(req.query.estado);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    console.error('❌ [PLANTILLA] gestoría:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// ── Documentos ─────────────────────────────────────────────────────────────

router.get('/api/tipos-documento', responde(async () => ({ tipos: await plantilla.tiposDocumento() })));

router.get('/api/conductor/:id/documentos', responde(async req =>
  ({ documentos: await plantilla.documentosDe(req.params.id, req.query.historico) })));

router.post('/api/documento', responde(async req =>
  plantilla.subirDocumento(req.body || {}, await quien(req))));

router.put('/api/documento/:id', responde(async req =>
  plantilla.actualizarDocumento(req.params.id, req.body || {}, await quien(req))));

router.delete('/api/documento/:id', responde(async req =>
  plantilla.retirarDocumento(req.params.id, req.query.archivo, await quien(req))));

// Sirve el archivo. Va por aquí y no por un enlace de Drive para que respete
// los permisos del ERP: quien no puede entrar, no puede descargarlo.
router.get('/api/documento/:id/descargar', async (req, res) => {
  try {
    const d = await plantilla.descargarDocumento(req.params.id);
    res.setHeader('Content-Type', d.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.nombre)}"`);
    res.send(d.bytes);
  } catch (e) {
    console.error(`❌ [PLANTILLA] descargar: ${e.message}`);
    res.status(404).send('No se encontró el documento');
  }
});

// Lo que caduca pronto, de personas y de coches. Alimenta los avisos.
router.get('/api/documentos/vencen', responde(async req =>
  ({ documentos: await plantilla.documentosQueVencen(req.query.dias) })));

module.exports = router;
