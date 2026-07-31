const express = require('express');
const router = express.Router();

// Configuración del sistema (tema, y a futuro más preferencias). Todo lo que hoy
// se guarda es del dispositivo (localStorage); cuando haya login/DB, irá por usuario.
router.get('/', (req, res) => {
  res.render('configuracion', { titulo: 'Configuración', seccion: 'configuracion', layout: 'layout-gestion' });
});

module.exports = router;
