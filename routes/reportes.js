// ============================================================
// /reportes — el parte diario a la ETT, y una redirección
// ============================================================
// AQUÍ NO ESTÁN LOS INFORMES. Los informes son de Control y viven en
// `/control/reportes`: horas del día, reporte por turnos, parrilla del
// planificador, asistencia, Sankey. Todo lo que se saca ahí es de tráfico.
//
// Esta ruta renderizaba UNA COPIA de esa misma pantalla, y eso era un problema
// de verdad y no de orden: la entrada del menú llevaba el permiso "Reportes
// RRHH", que va en el paquete de RRHH, mientras que TODOS los botones de la
// pantalla apuntan a `/control/*`. Quien tuviera ese permiso y no el de Control
// veía la pantalla entera y le fallaba cada botón, sin saber por qué. Ahora
// redirige: hay UNA pantalla de informes y es la de Control.
//
// Lo que sí es de esta ruta es el PARTE DIARIO A LA ETT: las horas de ayer de
// los conductores de la agencia, en Excel y por correo. No es un informe de
// tráfico —es de la ETT— y su sitio natural es Nóminas, junto al parte mensual.
// Y desde el 15/09/2026 ya vive ahí: el reporte lo arma
// `modules/RRHH/reporteEtt`, sobre PostgreSQL. Lo que queda en esta ruta es la
// cáscara —quien lo pide, a quién se lo manda y con qué correo—.

const express = require('express');
const router = express.Router();
const ett = require('../modules/RRHH/reporteEtt.service');
const correo = require('../services/correo');
const configApp = require('../services/configApp');

const ETT_POR_DEFECTO = 'camilobedoya9985@gmail.com';   // pruebas; se guarda el que elija el usuario
const esEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const nombreFichero = fecha => `Horas_ETT_${String(fecha).replace(/\//g, '-')}.xlsx`;

// 302 y no 301: un permanente se queda cacheado en el navegador para siempre y
// ata las manos si mañana esta URL vuelve a tener pantalla propia.
router.get('/', (req, res) => res.redirect(302, '/control/reportes'));

// Datos del reporte (para la vista previa) + el destinatario ETT guardado.
router.get('/api/horas-ett-ayer', async (req, res) => {
  try {
    const [reporte, cfg] = await Promise.all([
      ett.reporte(),
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
    const reporte = await ett.reporte();
    const buffer = await ett.excel(reporte);
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

    const reporte = await ett.reporte();
    if (!reporte.filas.length) throw new Error('No hay conductores ETT para reportar');
    // SIN DATOS NO SE MANDA. El reporte se pinta igual de bien con las horas a
    // cero, así que un envío a ciegas llega a la ETT con la misma cara de
    // siempre diciendo que no trabajó nadie. Es la pantalla la que avisa; aquí
    // se cierra la puerta, que es lo que sale del edificio.
    if (!reporte.conHoras) {
      throw new Error(`Ningún conductor de ETT tiene horas el ${reporte.fecha}: el reporte saldría `
        + 'entero a cero. Revisa que la ingesta de BOLT esté al día antes de mandarlo.');
    }
    const buffer = await ett.excel(reporte);

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
