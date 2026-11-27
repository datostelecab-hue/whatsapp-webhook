// ============================================================
// PUERTAS DESDE EL ERP — la ruta (27/11/2026)
// ============================================================
// Montada en '/puertas': el candado de rutas la ata a la llave '/puertas'. Se
// vuelve a mirar en el servicio (el desarrollador o la llave, como en el bot).
'use strict';

const express = require('express');
const router = express.Router();
const puertas = require('../../services/puertasOficina');

router.post('/api/orden', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ status: 'ok', ...(await puertas.orden({ matricula: b.matricula, abrir: b.abrir }, req.usuario || {})) });
  } catch (e) {
    console.error('❌ [Puertas · ERP]', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
