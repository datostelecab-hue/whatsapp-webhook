// ============================================================
// PETICIONES — HTTP. No decide nada.
// ============================================================

const express = require('express');
const router = express.Router();
const peticiones = require('./peticiones.service');
const actor = require('../../services/repo/actor');

/**
 * Quién está haciendo esto. Antes no había login y el nombre se tecleaba en cada
 * formulario; ahora se sabe, y se manda al servicio para que la petición quede
 * atada a una persona de verdad y no a lo que alguien escribiera esa tarde.
 * El campo de texto sigue existiendo por si RRHH resuelve en nombre de otro.
 */
const quien = async req => ({
  usuarioId: await actor.idDe(req),
  nombre: [(req.usuario || {}).nombre, (req.usuario || {}).apellidos].filter(Boolean).join(' ').trim(),
  rol: (req.usuario || {}).rol || '',
});

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Peticiones]', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', (req, res) => {
  res.render('peticiones', {
    titulo: 'Peticiones',
    seccion: 'peticiones',
    layout: 'layout-gestion',
    tipos: peticiones.TIPOS,
    // El nombre de quien mira, para no tener que teclearlo cada vez.
    yo: [(req.usuario || {}).nombre, (req.usuario || {}).apellidos].filter(Boolean).join(' ').trim(),
  });
});

router.get('/api/datos', responde(async () => await peticiones.datos()));

router.post('/crear', responde(async req =>
  ({ peticion: await peticiones.crear(req.body || {}, await quien(req)) })));

// RRHH crea y aplica directamente, sin pasar por Tráfico.
router.post('/crear-directa', responde(async req =>
  await peticiones.crearYAplicar(req.body || {}, await quien(req))));

router.post('/aprobar', responde(async req => {
  const b = req.body || {};
  return peticiones.aprobar(b.id, { desde: b.desde, hasta: b.hasta, resuelto_por: b.resuelto_por }, await quien(req));
}));

router.post('/rechazar', responde(async req => {
  const b = req.body || {};
  return peticiones.rechazar(b.id, b.motivo, b.resuelto_por, await quien(req));
}));

module.exports = router;
