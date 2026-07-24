const express = require('express');
const router = express.Router();
const { tableroControl } = require('../services/control');
const { enviarAtencionHora } = require('../services/whatsapp');

const MAX_ENVIO = 200;

// La interfaz de tráfico.
router.get('/', (req, res) => {
  res.render('control', {
    titulo: 'Control de tráfico',
    seccion: 'control',
    layout: 'layout-gestion'
  });
});

// Datos del tablero (JSON). El front lo refresca solo cada pocos minutos.
router.get('/api/datos', async (req, res) => {
  try {
    const datos = await tableroControl();
    res.json({ status: 'ok', ...datos });
  } catch (error) {
    console.error('❌ [Control] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Envía la plantilla atencion_hora a los conductores seleccionados en la UI.
// Solo actúa sobre la lista que manda el front (el usuario ya eligió y confirmó).
router.post('/enviar-ws', async (req, res) => {
  try {
    const dest = (req.body && req.body.destinatarios) || [];
    if (!Array.isArray(dest) || dest.length === 0) {
      return res.status(400).json({ status: 'error', msg: 'Sin destinatarios' });
    }
    if (dest.length > MAX_ENVIO) {
      return res.status(400).json({ status: 'error', msg: `Demasiados (máx ${MAX_ENVIO})` });
    }

    const detalle = [];
    for (const d of dest) {
      const r = await enviarAtencionHora(d.telefono, d.nombre);
      detalle.push({ nombre: d.nombre, telefono: d.telefono, ...r });
      await new Promise(ok => setTimeout(ok, 150));   // no saturar la API
    }

    const enviados = detalle.filter(x => x.ok).length;
    console.log(`📤 [Control] atencion_hora: ${enviados}/${dest.length} enviados`);
    res.json({ status: 'ok', enviados, fallidos: dest.length - enviados, detalle });
  } catch (error) {
    console.error('❌ [Control] /enviar-ws:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
