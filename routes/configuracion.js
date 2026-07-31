const express = require('express');
const router = express.Router();
const sesion = require('../services/sesion');
const configApp = require('../services/configApp');
const cripto = require('../services/cripto');
const correo = require('../services/correo');

// Página de configuración (tema para todos; usuarios y correo solo superadmin).
router.get('/', (req, res) => {
  res.render('configuracion', { titulo: 'Configuración', seccion: 'configuracion', layout: 'layout-gestion' });
});

// ── Correo para procesos (solo superadmin) ───────────────────────────────────
router.get('/correo', sesion.requiereSuperadmin, async (req, res) => {
  try { res.json({ status: 'ok', estado: await correo.estadoCorreo() }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.post('/correo', sesion.requiereSuperadmin, async (req, res) => {
  try {
    const b = req.body || {};
    const cambios = {
      correo_host: (b.host || '').trim(),
      correo_port: String(Number(b.port) || 587),
      correo_user: (b.user || '').trim(),
      correo_from: (b.from || '').trim()
    };
    // La contraseña solo se toca si el superadmin escribe una nueva (va cifrada).
    if (b.pass) {
      if (!cripto.configurada()) throw new Error('Falta CRED_KEY en el servidor para cifrar la contraseña');
      cambios.correo_pass_cifrada = cripto.cifrar(String(b.pass));
    }
    const actual = await configApp.leerConfig();
    const tienePass = !!cambios.correo_pass_cifrada || !!actual.correo_pass_cifrada;
    // El envío se activa solo si están los datos mínimos.
    cambios.correo_activo = (cambios.correo_host && cambios.correo_user && tienePass) ? 'si' : '';
    await configApp.guardarConfig(cambios);
    res.json({ status: 'ok', estado: await correo.estadoCorreo() });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/correo/prueba', sesion.requiereSuperadmin, async (req, res) => {
  try {
    const to = ((req.body && req.body.to) || req.usuario.email || '').trim();
    if (!to) throw new Error('Sin destinatario');
    const r = await correo.enviarCorreo({
      to, subject: 'Prueba de correo — Telecab',
      text: 'Correo de prueba de la plataforma Telecab. Si lo recibes, el envío está bien configurado.'
    });
    res.json({ status: r.enviado ? 'ok' : 'error', enviado: !!r.enviado, msg: r.motivo || '' });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
