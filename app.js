const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const cron = require('node-cron');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos (logo, vídeo de marca…). Se cachean un día: son
// inmutables en la práctica y no tiene sentido volver a pedirlos en cada página.
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '1d' }));

// Configurar EJS con layouts
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// ============================================================
// RED DE SEGURIDAD
// ============================================================
// Node mata el proceso ante una promesa rechazada sin capturar, y en Render
// eso reinicia la instancia: cualquier tarea larga en marcha (el backfill del
// histórico) moriría sin dejar rastro del motivo. Aquí se registra la causa y
// se deja el proceso vivo.
process.on('unhandledRejection', (motivo) => {
  console.error('❌ PROMESA RECHAZADA SIN CAPTURAR — el proceso sigue vivo');
  console.error(motivo instanceof Error ? motivo.stack : motivo);
});

process.on('uncaughtException', (error) => {
  console.error('❌ EXCEPCIÓN NO CAPTURADA — el proceso sigue vivo');
  console.error(error.stack || error);
});

// Si Render corta el contenedor (memoria, redespliegue), esto queda escrito
// justo antes y sabremos que fue una parada externa y no un fallo del código.
['SIGTERM', 'SIGINT'].forEach(senal => {
  process.on(senal, () => {
    const mb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.error(`🛑 Recibida ${senal}: el contenedor se está deteniendo (RSS ${mb} MB)`);
    process.exit(0);
  });
});

// Importar rutas
const botPuertas = require('./routes/botPuertas');
const boltHoras = require('./routes/boltHoras');
const dashboardRoutes = require('./routes/dashboard');
const resumenRoutes = require('./routes/resumen');
const planificadorRoutes = require('./routes/planificador');
const agendaRoutes = require('./routes/agenda');
const matchingRoutes = require('./routes/matching');
const coberturaRoutes = require('./routes/cobertura');
const vehiculosRoutes = require('./routes/vehiculos');
const documentosRoutes = require('./routes/documentos');
const libranzasRoutes = require('./routes/libranzas');
const controlRoutes = require('./routes/control');
const vacantesRoutes = require('./routes/vacantes');
const generadorRoutes = require('./routes/generador');
const seleccionRoutes = require('./routes/seleccion');
const pendientesBoltRoutes = require('./routes/pendientesBolt');
const rrhhRoutes = require('./routes/rrhh');
const administracionRoutes = require('./routes/administracion');
const plantillaRoutes = require('./routes/plantilla');
const notificacionesRoutes = require('./routes/notificaciones');
const pendientesRoutes = require('./routes/pendientes');
const peticionesRoutes = require('./routes/peticiones');
const { procesarYUnificar } = require('./services/boltHorasCore');

// ============================================================
// VERIFICACIÓN DEL WEBHOOK (Meta) + REDIRECCIÓN AL VISOR
// ============================================================
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    return res.status(200).send(challenge);
  }
  
  // Si no es verificación de Meta, redirigir al visor
  res.redirect('/dashboard/visor');
});

// ============================================================
// RUTAS
// ============================================================
app.post('/', botPuertas);
app.use('/horas', boltHoras);
app.use('/dashboard', dashboardRoutes);
app.use('/resumen', resumenRoutes);
app.use('/planificador', planificadorRoutes);
app.use('/agenda', agendaRoutes);
app.use('/matching', matchingRoutes);
app.use('/cobertura', coberturaRoutes);
app.use('/vehiculos', vehiculosRoutes);
app.use('/documentos', documentosRoutes);
app.use('/libranzas', libranzasRoutes);
app.use('/control', controlRoutes);
app.use('/vacantes', vacantesRoutes);
app.use('/generador', generadorRoutes);
app.use('/seleccion', seleccionRoutes);
app.use('/pendientes-bolt', pendientesBoltRoutes);
app.use('/rrhh', rrhhRoutes);
app.use('/administracion', administracionRoutes);
app.use('/plantilla', plantillaRoutes);
app.use('/notificaciones', notificacionesRoutes);
app.use('/pendientes', pendientesRoutes);
app.use('/peticiones', peticionesRoutes);

// Actualización manual del padrón CONDUCTORES_BOLT (para probar sin esperar al cron).
app.get('/conductores-bolt/actualizar', async (req, res) => {
  console.log('🔧 [CONDUCTORES_BOLT] actualizarConductoresBolt() manual...');
  try {
    const { actualizarConductoresBolt } = require('./services/conductoresBolt');
    const r = await actualizarConductoresBolt();
    res.json(r);
  } catch (error) {
    console.error(`❌ [CONDUCTORES_BOLT] Error: ${error.stack || error.message}`);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Procesado manual de ausencias V/B/P (auto-estado + letras) sin esperar al cron.
app.get('/vista-final/ausencias-auto', async (req, res) => {
  console.log('🔧 [VISTA_FINAL] ausencias (auto-estado + letras) manual...');
  try {
    const { aplicarAusenciasAutomaticas, escribirLetrasAusencia } = require('./services/vistaFinal');
    const estado = await aplicarAusenciasAutomaticas();
    const letras = await escribirLetrasAusencia();
    console.log(`✅ [VISTA_FINAL] ausencias: ${JSON.stringify({ estado, letras })}`);
    res.json({ ok: true, estado, letras });
  } catch (error) {
    console.error(`❌ [VISTA_FINAL] Error: ${error.stack || error.message}`);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Reconstrucción manual de VISTA_FINAL (para probar sin esperar al cron).
app.get('/vista-final/reconstruir', async (req, res) => {
  console.log('🔧 [VISTA_FINAL] reconstruirVistaFinal() manual...');
  try {
    const { reconstruirVistaFinal } = require('./services/vistaFinal');
    const r = await reconstruirVistaFinal();
    console.log(`✅ [VISTA_FINAL] ${JSON.stringify(r)}`);
    res.json({ ok: true, ...r });
  } catch (error) {
    console.error(`❌ [VISTA_FINAL] Error: ${error.stack || error.message}`);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================
// CRON
// ============================================================

// Horas de conductores: cada hora en punto
cron.schedule('0 * * * *', async () => {
  const ahora = new Date();
  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  console.log(`⏰ [CRON Horas] procesarYUnificar(${mes}, ${ano})...`);
  try {
    const result = await procesarYUnificar(mes, ano);
    console.log(`✅ [CRON Horas] Completado: ${result.conductores} conductores`);
  } catch (error) {
    console.error(`❌ [CRON Horas] Error: ${error.message}`);
  }
});

// Resumen de flotas: cada hora al minuto 15
cron.schedule('15 * * * *', async () => {
  console.log('⏰ [CRON Resumen] actualizarTodo()...');
  try {
    const { actualizarTodo } = require('./services/boltResumen');
    const result = await actualizarTodo();
    console.log(`✅ [CRON Resumen] Completado: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`❌ [CRON Resumen] Error: ${error.message}`);
  }
});

// Libranzas: AGENDA_V2 → L_Acumuladas, cada hora al minuto 30.
// APAGADO por defecto. Actívalo con LIBRANZAS_CRON=on en Render SOLO después de
// neutralizar acumularLSemanales en el Apps Script, o ambos escribirán
// L_Acumuladas y se pisarán. La ruta POST /libranzas/sync funciona igualmente
// para pruebas manuales aunque el cron esté apagado.
if (process.env.LIBRANZAS_CRON === 'on') {
  cron.schedule('30 * * * *', async () => {
    console.log('⏰ [CRON Libranzas] sincronizarLibranzas()...');
    try {
      const { sincronizarLibranzas } = require('./services/libranzas');
      const result = await sincronizarLibranzas();
      console.log(`✅ [CRON Libranzas] Completado: ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`❌ [CRON Libranzas] Error: ${error.message}`);
    }
  });
  console.log('   Cron Libranzas: ACTIVO (minuto 30)');
} else {
  console.log('   Cron Libranzas: apagado (LIBRANZAS_CRON!=on)');
}

// CONDUCTORES_BOLT: padrón de creación de conductores, cada media hora (:10 y
// :40, para no chocar con los otros crons). Sella el created_at propio.
cron.schedule('10,40 * * * *', async () => {
  console.log('⏰ [CRON CONDUCTORES_BOLT] actualizarConductoresBolt()...');
  try {
    const { actualizarConductoresBolt } = require('./services/conductoresBolt');
    const result = await actualizarConductoresBolt();
    console.log(`✅ [CRON CONDUCTORES_BOLT] ${JSON.stringify(result)}`);

    // Tras refrescar el padrón, cruzar los tickets "Pendiente en BOLT": los que
    // ya aparecen en BOLT pasan a "Aprobado en BOLT" y alertan a RRHH.
    const { conciliarTicketsBolt } = require('./services/tickets');
    const conc = await conciliarTicketsBolt();
    if (conc.total) console.log(`🔔 [CRON CONDUCTORES_BOLT] ${conc.total} conductor(es) detectado(s) en BOLT → RRHH`);
  } catch (error) {
    console.error(`❌ [CRON CONDUCTORES_BOLT] Error: ${error.stack || error.message}`);
  }
});

// VISTA_FINAL: reescribe el mes en curso (horas + libranzas de la semana) cada
// hora al minuto 45, dejando margen tras el refresco de Datos_API (minuto 0).
cron.schedule('45 * * * *', async () => {
  console.log('⏰ [CRON VISTA_FINAL] vacaciones automáticas + reconstruirVistaFinal()...');
  try {
    const { reconstruirVistaFinal, aplicarAusenciasAutomaticas, escribirLetrasAusencia } = require('./services/vistaFinal');
    // 1) A quien le empieza/corre hoy una ausencia (V/B/P) → estado automático.
    const aus = await aplicarAusenciasAutomaticas();
    if (aus.aplicados) console.log(`🏖️ [CRON VISTA_FINAL] ${aus.aplicados} ausencia(s): ${aus.conductores.join(', ')}`);
    // 2) Con fecha de reincorporación → rellenar las letras del periodo en la bitácora.
    const let2 = await escribirLetrasAusencia();
    if (let2.celdas) console.log(`📝 [CRON VISTA_FINAL] ${let2.celdas} celda(s) de ausencia: ${let2.conductores.join(', ')}`);
    const result = await reconstruirVistaFinal();
    console.log(`✅ [CRON VISTA_FINAL] Completado: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`❌ [CRON VISTA_FINAL] Error: ${error.stack || error.message}`);
  }
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en puerto ${port}`);
  console.log(`   Dashboard: http://localhost:${port}/dashboard`);
  console.log(`   Bot puertas: POST /`);
  console.log(`   Horas: GET /horas/procesar`);
  console.log(`   Resumen: POST /resumen/todo`);
  console.log(`   Cron: Cada hora (minuto 0)`);
});