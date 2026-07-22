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