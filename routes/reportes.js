const express = require('express');
const router = express.Router();
const { reporteHorasEttAyer, generarExcelEttAyer } = require('../services/reportes');
const correo = require('../services/correo');
const configApp = require('../services/configApp');

const ETT_POR_DEFECTO = 'camilobedoya9985@gmail.com';   // pruebas; se guarda el que elija el usuario
const esEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const nombreFichero = fecha => `Horas_ETT_${String(fecha).replace(/\//g, '-')}.xlsx`;

router.get('/', (req, res) => {
  res.render('reportes', { titulo: 'Reportes', seccion: 'reportes', layout: 'layout-gestion' });
});

// Datos del reporte (para la vista previa) + el destinatario ETT guardado.
router.get('/api/horas-ett-ayer', async (req, res) => {
  try {
    const [reporte, cfg] = await Promise.all([
      reporteHorasEttAyer(),
      configApp.leerConfig().catch(() => ({}))
    ]);
    res.json({ status: 'ok', ...reporte, destinatario: cfg.correo_ett || ETT_POR_DEFECTO, correoListo: (await correo.estadoCorreo().catch(() => ({}))) });
  } catch (e) {
    console.error('❌ [Reportes] horas-ett-ayer:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Descargar el Excel.
router.get('/horas-ett-ayer/excel', async (req, res) => {
  try {
    const reporte = await reporteHorasEttAyer();
    const buffer = await generarExcelEttAyer(reporte);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero(reporte.fecha)}"`);
    res.send(buffer);
  } catch (e) {
    console.error('❌ [Reportes] excel:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Enviar el Excel a la ETT por correo, DESDE el correo del usuario en sesión.
router.post('/horas-ett-ayer/enviar', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    const to = String((req.body || {}).to || '').trim();
    if (!esEmail(to)) throw new Error('El correo de la ETT no es válido');

    const reporte = await reporteHorasEttAyer();
    if (!reporte.filas.length) throw new Error('No hay conductores ETT para reportar');
    const buffer = await generarExcelEttAyer(reporte);

    const r = await correo.enviarComoUsuario(req.usuario.email, {
      to,
      subject: `Horas ETT — ${reporte.diaSemana} ${reporte.fecha}`,
      text: `Buenas,\n\nAdjunto el reporte de horas de los conductores ETT del ${reporte.diaSemana} ${reporte.fecha}.\n\nUn saludo.`,
      attachments: [{ filename: nombreFichero(reporte.fecha), content: buffer }]
    });
    if (!r.enviado) throw new Error(r.motivo || 'No se pudo enviar');

    // Recuerda el destinatario para la próxima vez.
    await configApp.guardarConfig({ correo_ett: to }).catch(() => {});
    console.log(`📧 [Reportes] Horas ETT ${reporte.fecha} enviadas por ${req.usuario.email} → ${to}`);
    res.json({ status: 'ok', from: r.from, to, total: reporte.totalHoras, conductores: reporte.filas.length });
  } catch (e) {
    console.error('❌ [Reportes] enviar:', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
