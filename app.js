const express = require('express');
const cron = require('node-cron');
const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// Importar rutas
const botPuertas = require('./routes/botPuertas');
const boltHoras = require('./routes/boltHoras');
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

// ============================================================
// RUTAS
// ============================================================
app.post('/', botPuertas);           // Webhook de WhatsApp (bot puertas)
app.use('/horas', boltHoras);        // Endpoints del sistema de horas

// ============================================================
// CRON: Procesar horas cada hora
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
  console.log(`   Bot puertas: POST /`);
  console.log(`   Horas: GET /horas/procesar`);
  console.log(`   Cron: Cada hora (minuto 0)`);
});