const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const cron = require('node-cron');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurar EJS con layouts
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// Importar rutas
const botPuertas = require('./routes/botPuertas');
const boltHoras = require('./routes/boltHoras');
const dashboardRoutes = require('./routes/dashboard');  // ← AÑADIR ESTA LÍNEA
const { procesarYUnificar } = require('./services/boltHorasCore');

// ============================================================
// VERIFICACIÓN DEL WEBHOOK (Meta)
// ============================================================
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// Redirigir raíz al visor
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.redirect('/dashboard/visor');  // ← Redirigir al visor
  }
});

// ============================================================
// RUTAS
// ============================================================
app.post('/', botPuertas);
app.use('/horas', boltHoras);
app.use('/dashboard', dashboardRoutes);  // ← AÑADIR ESTA LÍNEA

// ============================================================
// CRON
// ============================================================
cron.schedule('0 * * * *', async () => {
  const ahora = new Date();
  const mes = ahora.getMonth() + 1;
  const ano = ahora.getFullYear();
  console.log(`⏰ [CRON] Ejecutando procesarYUnificar(${mes}, ${ano})...`);
  try {
    const result = await procesarYUnificar(mes, ano);
    console.log(`✅ [CRON] Completado: ${result.conductores} conductores`);
  } catch (error) {
    console.error(`❌ [CRON] Error: ${error.message}`);
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
  console.log(`   Cron: Cada hora (minuto 0)`);
});