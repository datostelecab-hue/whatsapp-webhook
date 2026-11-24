// ============================================================
// REVISIÓN DE FOTOS — las rutas (db/282)
// ============================================================
// Se monta en `/revision-fotos`. Dos llaves, como Inspección de vehículos:
//
//   '/revision-fotos'            mirar las parejas de lotes y sus fotos
//   '/revision-fotos/calificar'  aprobar o marcar con daños
//
// La segunda va marcada `escribir` en el catálogo: cualquier petición que no
// sea un GET a /revision-fotos la exige sola (`controlAcceso`). Aquí se vuelve
// a comprobar, porque el botón escondido en la vista no es un candado.
// Quién califica sale de la sesión, nunca del cuerpo de la petición.

const express = require('express');
const router = express.Router();
const revision = require('./revisionFotos.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Revisión de fotos]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

async function puedeCalificar(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await quienEs(req);
    return id ? (await permisos.clavesDe(id)).has(revision.CLAVE_CALIFICAR) : false;
  } catch (_) { return false; }
}

router.get('/', async (req, res) => {
  res.render('revisionFotos', {
    titulo: 'Revisión de fotos',
    seccion: 'revision-fotos',
    layout: 'layout-gestion',
    puedeCalificar: await puedeCalificar(req),
  });
});

router.get('/api/lista', responde(() => revision.lista()));
router.get('/api/par/:turno', responde(async req => ({ ficha: await revision.ficha(req.params.turno) })));

router.post('/api/par/:turno/calificar', responde(async req => {
  if (!await puedeCalificar(req)) throw new Error('No tienes permiso para calificar la revisión de fotos');
  const b = req.body || {};
  return revision.calificar(req.params.turno, { resultado: b.resultado, nota: b.nota, fotos: b.fotos },
    { usuarioId: await quienEs(req) });
}));

module.exports = router;
