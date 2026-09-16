// ============================================================
// FACTURAS DE TALLER — las rutas
// ============================================================
// Tres permisos, y cada uno contesta a una pregunta distinta:
//
//   '/facturas'          entrar y mirar lo que se gasta en la flota
//   '/facturas/apuntar'  meter facturas y anularlas — lo de Óscar
//   '/vehiculos/sedes'   ver TAMBIÉN Barcelona; sin él se ve solo Madrid
//
// Mirar el gasto lo quiere dirección; meterlo es del taller. Y Barcelona es otra
// operación: Óscar lleva Madrid, y enseñarle coches que no controla solo sirve
// para que los confunda con los suyos.
//
// Quién hace cada cosa sale de la sesión, nunca del cuerpo de la petición.

const express = require('express');
const router = express.Router();

// El PDF llega en base64 dentro del JSON, y una factura escaneada pasa de largo
// los 2 MB del parser global — que por eso se salta esta ruta en app.js.
router.use('/api/pdf', express.json({ limit: '30mb' }));
// Por el SERVICIO, que es la puerta. El repositorio no se toca desde aquí.
const facturas = require('./facturas.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Facturas]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

/** ¿Tiene esta persona esa clave? Ante un fallo, NO. */
async function tiene(req, clave) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await quienEs(req);
    return id ? (await permisos.clavesDe(id)).has(clave) : false;
  } catch (_) { return false; }
}

const puedeApuntar = req => tiene(req, '/facturas/apuntar');
const todasLasSedes = req => tiene(req, '/vehiculos/sedes');

/** El contexto de sedes que se le pasa al servicio en CADA petición. */
const quien = async req => ({
  usuarioId: await quienEs(req),
  todasLasSedes: await todasLasSedes(req),
});

const exigeApuntar = fn => async req => {
  if (!await puedeApuntar(req)) throw new Error('Tu rol no puede meter ni anular facturas');
  return await fn(req, await quien(req));
};

// ── La pantalla ─────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  res.render('facturas', {
    titulo: 'Facturas de taller',
    seccion: 'facturas',
    layout: 'layout-gestion',
    puedeApuntar: await puedeApuntar(req),
    verTodasLasSedes: await todasLasSedes(req),
    sedes: facturas.SEDES,
    exigeMatriculaDesde: facturas.EXIGE_MATRICULA_DESDE,
  });
});

// ── Lo que lee la pantalla ──────────────────────────────────────────────────

router.get('/api/lista', responde(async req => ({
  filas: await facturas.listar({
    desde: req.query.desde, hasta: req.query.hasta,
    proveedorId: req.query.proveedor, texto: req.query.q,
    soloNN: req.query.nn === '1',
    incluirAnuladas: req.query.anuladas === '1',
  }, await quien(req)),
})));

// La clave se llama `ficha` porque es la que busca el componente de listado
// (`datos.ficha ? datos.ficha : datos`). Con otro nombre le llegaría la
// respuesta entera, con su `status` dentro, y pintaría una ficha vacía.
router.get('/api/ficha/:id', responde(async req => ({
  ficha: await facturas.ver(req.params.id, await quien(req)),
})));

router.get('/api/proveedores', responde(async () => ({ proveedores: await facturas.proveedores() })));

/** El cuadro de gasto por coche: para lo que existe todo esto. */
router.get('/api/gasto', responde(async req => (
  await facturas.gasto({ desde: req.query.desde, hasta: req.query.hasta }, await quien(req))
)));

/** Lo gastado en UN coche, para su ficha en /vehiculos. */
router.get('/api/gasto/:vehiculoId', responde(async req => (
  await facturas.gastoDeCoche(req.params.vehiculoId)
)));

// ── Lo que escribe ──────────────────────────────────────────────────────────

router.post('/api/factura', responde(exigeApuntar((req, ctx) => facturas.alta(req.body, ctx))));

router.post('/api/anular', responde(exigeApuntar((req, ctx) =>
  facturas.anular(req.body.id, req.body.motivo, ctx))));

router.post('/api/proveedor', responde(exigeApuntar(req => facturas.nuevoProveedor(req.body))));

/** Ponerle coche a una línea NN, cuando el taller por fin dice de cuál era. */
router.post('/api/linea/coche', responde(exigeApuntar((req, ctx) =>
  facturas.asignarCoche(req.body.facturaId, req.body.lineaId, req.body, ctx))));

/** El PDF de la factura: a Drive, y en la base solo dónde quedó. */
router.post('/api/pdf', responde(exigeApuntar((req, ctx) =>
  facturas.subirPdf(req.body.id, req.body, ctx))));

module.exports = router;
