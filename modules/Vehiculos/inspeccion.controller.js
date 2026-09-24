// ============================================================
// INSPECCIÓN DE VEHÍCULOS — las rutas
// ============================================================
// Se monta en `/inspecciones`. Dos llaves, como Mantenimientos:
//
//   '/inspecciones'           mirar el estado de cada coche y su historial
//   '/inspecciones/apuntar'   apuntar una inspección, anularla e importar el
//                             Excel del taller
//
// La segunda está marcada `escribir` en el catálogo: cualquier petición que no
// sea un GET a /inspecciones la exige sola (`controlAcceso`), así que un
// endpoint nuevo nace cerrado. Aquí se vuelve a comprobar, porque el botón
// escondido en la vista no es un candado.

const express = require('express');
const router = express.Router();
const inspeccion = require('./inspeccion.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Inspección]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message, ...(e.errores ? { errores: e.errores } : {}) });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

async function puedeApuntar(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await quienEs(req);
    return id ? (await permisos.clavesDe(id)).has('/inspecciones/apuntar') : false;
  } catch (_) { return false; }
}

const exigeApuntar = fn => async req => {
  if (!await puedeApuntar(req)) throw new Error('No tienes permiso para apuntar inspecciones');
  return fn(req, { usuarioId: await quienEs(req) });
};

router.get('/', async (req, res) => {
  res.render('inspecciones', {
    titulo: 'Inspección de vehículos',
    seccion: 'inspecciones',
    layout: 'layout-gestion',
    puedeApuntar: await puedeApuntar(req),
    catalogos: await inspeccion.catalogos().catch(() => ({ elementos: [], estados: [], resultados: [] })),
  });
});

router.get('/api/lista', responde(() => inspeccion.lista()));
router.get('/api/ficha/:id', responde(async req => ({ ficha: await inspeccion.ficha(req.params.id) })));

router.post('/api/vehiculo/:id/inspeccion', responde(exigeApuntar((req, quien) =>
  inspeccion.crear(req.params.id, req.body || {}, quien))));

router.post('/api/inspeccion/:id/anular', responde(exigeApuntar((req, quien) =>
  inspeccion.anular(req.params.id, (req.body || {}).motivo, quien))));

// El Excel del taller viaja en base64 dentro del JSON: pesa decenas de KB, pero
// se deja margen por si un día trae imágenes pegadas. Por eso esta ruta está en
// SUBEN_ARCHIVOS de app.js: se salta el parser global de 2 MB y pone el suyo.
router.post('/api/importar', express.json({ limit: '15mb' }), responde(exigeApuntar((req, quien) =>
  inspeccion.importar(req.body || {}, quien))));

module.exports = router;
