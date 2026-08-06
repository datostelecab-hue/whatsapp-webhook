// ============================================================
// BODA — panel oculto para disparar los envíos (solo superadmin)
// ============================================================
// Módulo "oculto": no está en el menú ni en el mapa de ACCESO. Se llega por su URL
// (la de montaje en app.js) y exige sesión de superadmin. El amigo de la boda tiene
// ese rol en Telecab, así que entra con sus credenciales normales.

const express = require('express');
const router = express.Router();
const { requiereSuperadmin } = require('../services/sesion');
const boda = require('../services/boda');

router.use(requiereSuperadmin);

// Panel (página independiente, sin el menú de gestión).
router.get('/', async (req, res) => {
  let resumen = null, opciones = null, error = null;
  try {
    [resumen, opciones] = await Promise.all([boda.estadoResumen(), boda.opcionesLista()]);
  } catch (e) { error = e.message; }
  res.render('boda', {
    titulo: 'Boda · Confirmaciones',
    resumen, opciones, error, progreso: boda.progresoActual(),
    layout: false
  });
});

// Alta de un invitado (individual o pareja) desde el formulario.
router.post('/agregar', async (req, res) => {
  try {
    const r = await boda.agregarInvitado(req.body || {});
    res.json({ status: 'ok', ...r });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Estado + progreso (el panel lo sondea para refrescar la barra).
router.get('/estado', async (req, res) => {
  try {
    res.json({ status: 'ok', resumen: await boda.estadoResumen(), progreso: boda.progresoActual() });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Dispara el envío en SEGUNDO PLANO (mandar ~250 plantillas tarda minutos, no cabe
// en una petición HTTP). Responde enseguida; el panel sondea /estado para la barra.
router.post('/enviar', (req, res) => {
  if (boda.enviando()) return res.status(409).json({ status: 'error', msg: 'Ya hay un envío en marcha' });
  const b = req.body || {};
  const opciones = {
    tipo: ['individual', 'pareja', 'todos'].includes(b.tipo) ? b.tipo : 'todos',
    test: b.test === true || b.test === 'true',
    reenviar: b.reenviar === true || b.reenviar === 'true',
    limite: Number(b.limite) || 0
  };
  boda.enviarInvitaciones(opciones).catch(e => console.error('❌ [BODA] envío:', e.message));
  res.json({ status: 'ok', msg: 'Envío iniciado', opciones });
});

module.exports = router;
