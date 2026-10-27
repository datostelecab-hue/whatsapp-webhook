// ============================================================
// AVISO · EFECTIVO ACTIVO Y NUNCA UNA ENTREGA — ruta
// ============================================================
// La pide la tarjeta (public/assets/js/avisoEfectivo.js). Quién la ve no lo
// decide el rol sino la llave '/avisos/efectivo' (ver avisoEfectivo.service).

const express = require('express');
const router = express.Router();
const aviso = require('./avisoEfectivo.service');

router.get('/api', async (req, res) => {
  try {
    const u = req.usuario || {};
    // `permisos` en null es acceso total (superadmin y desarrollador, lo pone
    // sesion.cargarPermisos): esos entran en Recaudación aunque no tengan la clave.
    res.json({ status: 'ok', ...(await aviso.paraLaTarjeta(u.id, { rolTotal: res.locals.permisos === null })) });
  } catch (e) {
    console.error('❌ [Aviso efectivo]', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
