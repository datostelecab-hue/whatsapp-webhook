// ============================================================
// CONDUCTORES — rutas
// ============================================================
// La plantilla, leída de PostgreSQL. Sustituye a `/plantilla`, que cruzaba tres
// hojas por nombre en JavaScript.
//
// Mismo contrato que vehículos, para que el componente `Listado` no tenga que
// aprender nada nuevo:
//   · /api/lista       → { filas, resumen }
//   · /api/ficha/:id   → la ficha entera
//
// Lo ve Tráfico y lo ve RRHH: es la misma plantilla, solo que cada uno mira una
// cosa. Tráfico quién puede conducir hoy; RRHH quién está de alta y con qué.

const express = require('express');
const router = express.Router();
const con = require('../services/repo/conductores');
const docs = require('../services/repo/documentos');
const audit = require('../services/repo/auditoria');
const actor = require('../services/repo/actor');
const bolt = require('../services/cazamientoBolt');

// Los archivos llegan en base64 dentro del JSON. El parser global es de 2 MB y
// un DNI escaneado se pasa de largo, asi que aqui va su propio limite.
router.use('/api/documento', express.json({ limit: '30mb' }));

/** Quien hace el cambio y con que rol. Todo lo que escribe pasa por aqui. */
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
    console.error(`❌ [CONDUCTORES] ${req.method} ${req.path}: ${e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  let catalogos = { situaciones: [], turnos: [], tipos: [] };
  try { catalogos = await con.catalogos(); } catch (e) {
    console.error('❌ [CONDUCTORES] catálogos:', e.message);
  }
  res.render('conductores', {
    titulo: 'Conductores', seccion: 'conductores', layout: 'layout-gestion',
    catalogos,
  });
});

// `momento` deja mirar la plantilla de una fecha pasada: quién estaba de alta,
// en qué turno y en qué coche. Con las hojas esto no se podía preguntar.
const momentoDe = req => (req.query.momento || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.momento : null;

router.get('/api/lista', async (req, res) => {
  try {
    const opciones = {
      momento: momentoDe(req),
      incluirBajas: req.query.bajas === '1',
    };
    const [filas, resumen] = await Promise.all([
      con.listar(opciones),
      con.resumen(opciones),
    ]);
    res.json({ filas, resumen });
  } catch (error) {
    console.error('❌ [CONDUCTORES] /api/lista:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.get('/api/ficha/:id', async (req, res) => {
  try {
    const f = await con.ficha(Number(req.params.id), { momento: momentoDe(req) });
    if (!f) return res.status(404).json({ status: 'error', msg: 'No existe ese conductor' });
    res.json(f);
  } catch (error) {
    console.error('❌ [CONDUCTORES] /api/ficha:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Cuentas de BOLT sin dueño: es la lista que se ofrece para enlazar a mano.
router.get('/api/bolt-libres', async (req, res) => {
  try { res.json({ cuentas: await con.boltLibres(req.query.q) }); }
  catch (error) { res.status(500).json({ status: 'error', msg: error.message }); }
});

// Cuentas libres con dueño propuesto POR EL TELÉFONO. Es lo que convierte el
// enlace en un clic en vez de buscar a mano entre cientos de nombres.
router.get('/api/bolt-sugerencias', responde(async req =>
  ({ sugerencias: await bolt.sugerencias({ soloEmpleados: req.query.todos !== '1' }) })));

// Cómo está cada persona respecto a BOLT: enlazada, en BOLT sin enlazar, sin
// teléfono, o directamente sin dar de alta.
router.get('/api/alta-bolt', responde(async req =>
  ({ conductores: await bolt.altaEnBolt({
    soloEmpleados: req.query.todos !== '1', situacion: req.query.situacion,
  }) })));

router.get('/api/bolt-estado', responde(async () => ({ estado: await bolt.estado() })));

// Pregunta a BOLT quién hay y actualiza el inventario. Sin esta pasada no hay
// cuentas libres: la carga inicial creó cada una ya pegada a una persona.
router.post('/api/bolt/sincronizar', responde(async () => bolt.sincronizarDesdeBolt()));

router.get('/api/catalogos', async (req, res) => {
  try { res.json(await con.catalogos()); }
  catch (error) { res.status(500).json({ status: 'error', msg: error.message }); }
});

// ============================================================
// ESCRITURA
// ============================================================

// Qué campos puede tocar quien está mirando. La pantalla lo usa para enseñar
// unos editables y otros solo de lectura, en vez de dejar intentarlo y fallar.
router.get('/api/campos', responde(async req => ({
  campos: con.CAMPOS,
  editables: con.camposDe((req.usuario || {}).rol || ''),
})));

router.put('/api/conductor/:id', responde(async req =>
  con.actualizar(Number(req.params.id), req.body || {}, await quien(req))));

router.post('/api/conductor/:id/situacion', responde(async req =>
  ({ vigencia: await con.cambiarSituacion(Number(req.params.id), req.body || {}, await quien(req)) })));

router.post('/api/conductor/:id/turno', responde(async req =>
  ({ vigencia: await con.cambiarTurno(Number(req.params.id), req.body || {}, await quien(req)) })));

router.post('/api/conductor/:id/libranza', responde(async req =>
  con.guardarLibranza(Number(req.params.id), (req.body || {}).dias, {
    desde: (req.body || {}).desde, ...(await quien(req)),
  })));

router.post('/api/conductor/:id/telefono', responde(async req =>
  ({ telefono: await con.guardarTelefono(Number(req.params.id), (req.body || {}).e164, await quien(req)) })));

// `cuentaId` es el id de la FILA de conductor_externo, el que dan v_bolt_libres
// y v_bolt_sugerencia. No es el driver_uuid: ese identifica en BOLT, no aquí.
router.post('/api/conductor/:id/bolt', responde(async req =>
  con.enlazarBolt(Number(req.params.id), (req.body || {}).cuentaId, await quien(req))));

router.delete('/api/conductor/:id/bolt/:cuentaId', responde(async req =>
  ({ soltada: await con.soltarBolt(Number(req.params.id), Number(req.params.cuentaId), await quien(req)) })));

router.post('/api/conductor/:id/alta', responde(async req =>
  ({ periodoId: await con.darDeAlta(Number(req.params.id), req.body || {}, await quien(req)) })));

router.post('/api/conductor/:id/baja', responde(async req =>
  ({ dado: await con.darDeBaja(Number(req.params.id), req.body || {}, await quien(req)) })));

// El historial de ediciones de una ficha: quién tocó qué y cuándo.
router.get('/api/conductor/:id/cambios', responde(async req =>
  ({ cambios: await audit.historial('conductor', Number(req.params.id)) })));

// ---------- documentos ----------

router.get('/api/tipos-documento', responde(async () => ({ tipos: await docs.tipos('conductor') })));

router.get('/api/conductor/:id/documentos', responde(async req => ({
  documentos: await docs.listar({
    conductorId: Number(req.params.id),
    incluirReemplazados: req.query.historico === '1',
  }),
})));

router.post('/api/documento', responde(async req => ({
  documento: await docs.subir({ ...(req.body || {}) }, await quien(req)),
})));

router.put('/api/documento/:id', responde(async req =>
  ({ documento: await docs.actualizar(Number(req.params.id), req.body || {}, await quien(req)) })));

// Por omisión solo se retira del índice y el archivo se queda: son papeles
// laborales y borrarlos de verdad no tiene vuelta atrás.
router.delete('/api/documento/:id', responde(async req =>
  ({ retirado: await docs.retirar(Number(req.params.id), {
    borrarArchivo: req.query.archivo === '1', ...(await quien(req)),
  }) })));

// Sirve el archivo. Va por aquí y no por un enlace de Drive para que respete
// los permisos del ERP: quien no puede entrar, no puede descargarlo.
router.get('/api/documento/:id/descargar', async (req, res) => {
  try {
    const d = await docs.descargar(Number(req.params.id));
    res.setHeader('Content-Type', d.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.nombre)}"`);
    res.send(d.bytes);
  } catch (e) {
    console.error(`❌ [CONDUCTORES] descargar: ${e.message}`);
    res.status(404).send('No se encontró el documento');
  }
});

// Lo que caduca pronto, de personas y de coches. Alimenta los avisos.
router.get('/api/documentos/vencen', responde(async req =>
  ({ documentos: await docs.porVencer({ dias: req.query.dias }) })));

// La misma persona en dos coches el mismo día.
router.get('/api/conflictos', responde(async req =>
  ({ conflictos: await con.doblePlaza({ momento: req.query.momento }) })));

module.exports = router;
