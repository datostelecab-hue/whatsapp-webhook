// ============================================================
// INVENTARIO DEL TALLER — las rutas (db/241)
// ============================================================
// Dos llaves, como Mantenimientos:
//
//   '/inventario'        mirar lo que hay y su historia
//   '/inventario/mover'  sumar, restar en un coche, ajustar y anular. Va marcada
//                        `escribir` en el catálogo: toda petición que no sea un
//                        GET a /inventario la exige sola.
//
// Quién mueve sale de la sesión, nunca del cuerpo de la petición.

const express = require('express');
const router = express.Router();
const inventario = require('./inventario.service');
const actor = require('../../services/repo/actor');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Inventario]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

async function puedeMover(req) {
  let usuarioId = null;
  try { usuarioId = await quienEs(req); } catch (_) { /* sin id, sin mover */ }
  return inventario.puedeMover({ rol: (req.usuario || {}).rol, usuarioId });
}

/** El candado de verdad: el botón escondido en la vista no lo es. */
const exigeMover = fn => async req => {
  if (!await puedeMover(req)) throw new Error('No tienes permiso para mover el inventario');
  return fn(req, { usuarioId: await quienEs(req) });
};

router.get('/', async (req, res) => {
  res.render('inventario', {
    titulo: 'Inventario',
    seccion: 'inventario',
    layout: 'layout-gestion',
    puedeMover: await puedeMover(req),
    categorias: inventario.CATEGORIAS,
  });
});

router.get('/api/lista', responde(async () => ({ filas: await inventario.lista() })));
router.get('/api/ficha/:id', responde(async req => ({ ficha: await inventario.ficha(req.params.id) })));
router.get('/api/coches', responde(async () => ({ coches: await inventario.coches() })));

router.post('/api/articulo', responde(exigeMover((req, quien) => inventario.crearArticulo(req.body || {}, quien))));
router.post('/api/articulo/:id', responde(exigeMover(req => inventario.editarArticulo(req.params.id, req.body || {}))));
router.post('/api/movimiento', responde(exigeMover((req, quien) => inventario.mover(req.body || {}, quien))));
router.post('/api/movimiento/:id/anular', responde(exigeMover((req, quien) =>
  inventario.anular(req.params.id, (req.body || {}).motivo, quien))));

module.exports = router;
