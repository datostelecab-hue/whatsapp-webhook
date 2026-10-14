// ============================================================
// VACACIONES — rutas
// ============================================================
// Mirar los saldos es '/vacaciones'. Poner, corregir o borrar unas vacaciones
// sigue siendo de Plantilla, con la llave de aprobar (una sola persona, db/189):
// desde aquí solo se va a la ficha.

const express = require('express');
const router = express.Router();
const vacaciones = require('./vacaciones.service');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Vacaciones]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', (req, res) => {
  res.render('vacaciones', {
    titulo: 'Vacaciones', seccion: 'vacaciones', layout: 'layout-gestion',
    reglas: { tasa: vacaciones.TASA, desde: vacaciones.DESDE_HISTORICO, umbralHoras: vacaciones.UMBRAL_FESTIVO / 3600 },
  });
});

router.get('/api/lista', responde(() => vacaciones.lista()));

// `ficha`: es la clave que busca el componente Listado.
router.get('/api/ficha/:id', responde(async req => ({ ficha: await vacaciones.ficha(req.params.id) })));

module.exports = router;
