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
const dashboardRoutes = require('./routes/dashboard');
const resumenRoutes = require('./routes/resumen');
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