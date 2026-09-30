// ============================================================
// CICLO DE BLOQUEO DE MOTOR — rutas
// ============================================================
// Mirarlo es '/bloqueo-motor'; soltar un coche es '/bloqueo-motor/soltar', que va
// marcada `escribir` en el catálogo: cualquier petición que no sea un GET la
// exige sola (services/permisos.js). Se vuelve a mirar aquí por si acaso.

const express = require('express');
const router = express.Router();
const ciclo = require('./bloqueoMotor.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Bloqueo de motor]', req.method, req.path + ':', e.message);
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
const puedeSoltar = req => tiene(req, '/bloqueo-motor/soltar');

router.get('/', async (req, res) => {
  res.render('bloqueoMotor', {
    titulo: 'Ciclo de bloqueo de motor',
    seccion: 'bloqueo-motor',
    layout: 'layout-gestion',
    puedeSoltar: await puedeSoltar(req),
  });
});

router.get('/api/lista', responde(() => ciclo.lista()));

// `ficha`: es la clave que busca el componente Listado.
router.get('/api/coche/:matricula', responde(async req => ({ ficha: await ciclo.ficha(req.params.matricula) })));

router.post('/api/soltar', responde(async req => {
  if (!await puedeSoltar(req)) throw new Error('No tienes permiso para soltar el motor de un coche');
  const b = req.body || {};
  return await ciclo.soltar({ matricula: b.matricula, motivo: b.motivo }, { usuarioId: await quienEs(req) });
}));

module.exports = router;
