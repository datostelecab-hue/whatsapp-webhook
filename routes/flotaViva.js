// ============================================================
// FLOTA VIVA — rutas
// ============================================================
// Fichero nuevo y aparte: no toca ninguna ruta existente.

const express = require('express');
const router = express.Router();

const panel = require('../services/flotaViva/panel');
const motor = require('../services/flotaViva/motor');
const db = require('../services/flotaViva/db');

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [FLOTA VIVA] ${req.method} ${req.path}: ${e.message}`);
    res.status(500).json({ status: 'error', msg: e.message });
  }
};

router.get('/', (req, res) => {
  res.render('flotaViva', {
    titulo: 'Flota viva', seccion: 'flota-viva', layout: 'layout-gestion',
  });
});

router.get('/api/estado', responde(async () => {
  await db.preparar();
  return panel.estado();
}));

router.get('/api/historial/:matricula', responde(async req =>
  ({ historial: await panel.historial(req.params.matricula, Number(req.query.dias) || 2) })));

// Fuerza una vuelta sin esperar al cron. Es lo que se pulsa cuando alguien dice
// "acabo de desconectarme y no sale".
router.post('/api/refrescar', responde(async () => {
  const r = await motor.pasada();
  return { ...r, ...(await panel.estado()) };
}));

// Lo que manda Mapon TAL CUAL para una matricula.
//
// Existe porque los km salieron mal y no habia forma de saber si el fallo estaba
// en la cuenta o en lo que llega. Los nombres de los campos de Mapon —`mileage`,
// `last_update`— y sus unidades no estan documentados en ningun sitio nuestro:
// aqui se ven, y se deja de suponer.
router.get('/api/mapon/:matricula', responde(async req => {
  const fuentes = require('../services/flotaViva/fuentes');
  const mat = fuentes.normMat(req.params.matricula);
  const flota = await fuentes.flotaMapon();
  const u = flota.get(mat);
  return {
    matricula: mat,
    encontrado: !!u,
    // Lo que hemos entendido nosotros...
    interpretado: u || null,
    // ...y lo que llega de verdad, para poder comparar.
    crudo: await (async () => {
      const j = await fuentes.crudoDeUnidad(mat);
      return j;
    })(),
  };
}));

module.exports = router;
