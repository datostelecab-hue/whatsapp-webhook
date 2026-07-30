const express = require('express');
const router = express.Router();

// Página del buzón de pendientes. Los datos salen de /notificaciones (cliente).
router.get('/', (req, res) => {
  res.render('pendientes', {
    titulo: 'Pendientes',
    seccion: 'pendientes',
    layout: 'layout-gestion'
  });
});

module.exports = router;
