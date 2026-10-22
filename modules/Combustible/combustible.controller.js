// ============================================================
// COMBUSTIBLE — las rutas
// ============================================================
// Se monta en `/combustible`. Dos llaves, como Inspección de vehículos:
//
//   '/combustible'        mirar los repostajes y el estado de la lectura
//   '/combustible/leer'   «Leer el buzón ahora»
//
// La segunda está marcada `escribir` en el catálogo: cualquier petición que no
// sea un GET a /combustible la exige sola (`controlAcceso`), así que un endpoint
// nuevo nace cerrado. Aquí se vuelve a comprobar, porque el botón escondido en
// la vista no es un candado.

const express = require('express');
const router = express.Router();
const combustible = require('./combustible.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Combustible]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

async function puedeLeer(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await quienEs(req);
    return id ? (await permisos.clavesDe(id)).has('/combustible/leer') : false;
  } catch (_) { return false; }
}

router.get('/', async (req, res) => {
  res.render('combustible', {
    titulo: 'Combustible',
    seccion: 'combustible',
    layout: 'layout-gestion',
    puedeLeer: await puedeLeer(req),
    // La sede de la sesión (`sede`) ya la pone services/sesion en res.locals.
  });
});

router.get('/api/lista', responde(req => combustible.lista({ desde: req.query.desde, hasta: req.query.hasta })));

// `ficha`: es la clave que busca el componente Listado.
router.get('/api/repostaje/:id', responde(async req => ({ ficha: await combustible.ficha(req.params.id) })));

router.get('/api/lecturas', responde(async () => ({ lecturas: await combustible.lecturas(30) })));

// Lee el buzón ahora. Tarda lo que tarde el servidor de correo (unos segundos):
// la pantalla tapa con la carga de la casa mientras tanto. Si no puede entrar,
// no es un 400: la pasada queda escrita con su error y se devuelve tal cual.
router.post('/api/leer', responde(async req => {
  if (!await puedeLeer(req)) throw new Error('No tienes permiso para leer el buzón');
  return { lectura: await combustible.leerBuzon({ origen: 'manual', usuarioId: await quienEs(req) }) };
}));

module.exports = router;
