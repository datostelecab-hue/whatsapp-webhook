// ============================================================
// EL RECEPTOR DE ESTADOS DE MENSATEK (módulo 9, db/306) — SIN SESIÓN
// ============================================================
// Mensatek llama aquí cada vez que un SMS certificado cambia de estado
// (POST /mensatek/reports) y cada vez que el destinatario hace algo con la
// notificación: la abre con su DNI, la acepta o la rechaza (POST
// /mensatek/eventos). Se configura en su panel (configuración de la API) con
// autenticación básica: el usuario y la contraseña son MENSATEK_WEBHOOK_USUARIO
// y MENSATEK_WEBHOOK_CLAVE del entorno. Sin ellos, no se acepta nada.
//
// Se contesta enseguida y se procesa después: si tardáramos, Mensatek
// reintentaría. Va en app.js ANTES de la sesión.
'use strict';

const express = require('express');
const router = express.Router();
const sms = require('./sms.service');

const recibir = (req, res) => {
  if (!sms.receptorValido(req.get('authorization'))) {
    res.set('WWW-Authenticate', 'Basic realm="mensatek"');
    return res.status(401).json({ ok: false });
  }
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  res.json({ ok: true });
  sms.recibirReport(cuerpo).catch(e => console.error('❌ [SMS] report de Mensatek:', e.message));
};

router.post('/reports', recibir);
router.post('/eventos', recibir);

module.exports = router;
