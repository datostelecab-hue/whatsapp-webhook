const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const cron = require('node-cron');
const app = express();
// Parser JSON global (2mb). Las rutas que suben archivos en base64 (documentos de
// conductores y adjuntos de soporte) se SALTAN este parser y aplican su propio
// límite mayor dentro de su router; si no, este 2mb las capaba silenciosamente.
const jsonGlobal = express.json({ limit: '2mb' });
app.use((req, res, next) => {
  if (req.path.startsWith('/documentos') || req.path.startsWith('/soporte')) return next();
  return jsonGlobal(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// Cabeceras de seguridad en todas las respuestas (anti-clickjacking, anti MIME-sniffing…).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

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
const ettRoutes = require('./routes/ett');
const pendientesBoltRoutes = require('./routes/pendientesBolt');
const rrhhRoutes = require('./routes/rrhh');
const administracionRoutes = require('./routes/administracion');
const plantillaRoutes = require('./routes/plantilla');
const fichasRoutes = require('./routes/fichas');
const ticketeraRoutes = require('./routes/ticketera');
const soporteRoutes = require('./routes/soporte');
const ticketsTelecabRoutes = require('./routes/ticketsTelecab');
const reportesRoutes = require('./routes/reportes');
const nominasRoutes = require('./routes/nominas');
const bitacoraRoutes = require('./routes/bitacora');
const incorporacionesRoutes = require('./routes/incorporaciones');
const configuracionRoutes = require('./routes/configuracion');
const notificacionesRoutes = require('./routes/notificaciones');
const pendientesRoutes = require('./routes/pendientes');
const peticionesRoutes = require('./routes/peticiones');
const operacionesRoutes = require('./routes/operaciones');
const sancionesRoutes = require('./routes/sanciones');
const bodaRoutes = require('./routes/boda');
const authRoutes = require('./routes/auth');
const usuariosRoutes = require('./routes/usuarios');
const sesion = require('./services/sesion');
const { procesarYUnificar } = require('./services/boltHorasCore');

// Carga la sesión (si hay cookie) en req.usuario / res.locals para todas las peticiones.
app.use(sesion.cargarSesion);

// ============================================================
// VERIFICACIÓN DEL WEBHOOK (Meta) + ENTRADA A LA APP
// ============================================================
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    return res.status(200).send(challenge);
  }

  // Si no es verificación de Meta, a la app: con sesión al inicio, si no al login.
  return res.redirect(req.usuario ? '/pendientes' : '/login');
});

// ============================================================
// RUTAS
// ============================================================
app.post('/', botPuertas);

// ── Autenticación (rutas públicas): login, logout, cambio y recuperación ──────
app.use('/', authRoutes);

// ── A partir de aquí TODO exige sesión + rol (el webhook y /assets quedan arriba,
//    públicos). Sin sesión → redirige a /login; API → 401. ─────────────────────
app.use(sesion.protegido);
app.use(sesion.forzarCambio);
app.use(sesion.controlAcceso);
app.use('/usuarios', usuariosRoutes);

app.use('/horas', boltHoras);
app.use('/resumen', resumenRoutes);
app.use('/planificador', planificadorRoutes);
app.use('/planificador-v2', require('./routes/tablero'));
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
app.use('/ett', ettRoutes);
app.use('/pendientes-bolt', pendientesBoltRoutes);
app.use('/rrhh', rrhhRoutes);
app.use('/administracion', administracionRoutes);
app.use('/plantilla', plantillaRoutes);
app.use('/fichas', fichasRoutes);
app.use('/ticketera', ticketeraRoutes);
app.use('/soporte', soporteRoutes);
app.use('/tickets-telecab', ticketsTelecabRoutes);
app.use('/reportes', reportesRoutes);
app.use('/nominas', nominasRoutes);
app.use('/bitacora', bitacoraRoutes);
app.use('/incorporaciones', incorporacionesRoutes);
app.use('/configuracion', configuracionRoutes);
app.use('/notificaciones', notificacionesRoutes);
app.use('/pendientes', pendientesRoutes);
app.use('/peticiones', peticionesRoutes);
app.use('/operaciones', operacionesRoutes);
app.use('/sanciones', sancionesRoutes);
app.use('/callcenter', require('./routes/callCenter'));
app.use('/migraciones', require('./routes/migraciones'));

// Diagnóstico del servidor de pruebas: qué se ha bloqueado y qué crons no corren.
app.get('/modo-pruebas', (req, res) => {
  res.json({ status: 'ok', ...pruebas.estado(), cronsOmitidos: _cronsOmitidos });
});

// ── BODA (favor aparte, módulo OCULTO): panel solo-superadmin para enviar las
//    invitaciones por WhatsApp. No está en el menú ni en ACCESO. El webhook (POST /)
//    ya enruta por phone_number_id lo que llega al número de la boda. ──────────────
app.use('/boda-igna-cruz', bodaRoutes);

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

// Procesado manual de ausencias V/B/P (auto-estado + reincorporaciones + letras)
// sin esperar al cron.
app.get('/vista-final/ausencias-auto', async (req, res) => {
  console.log('🔧 [VISTA_FINAL] ausencias (auto-estado + reincorporaciones + letras) manual...');
  try {
    const { aplicarAusenciasAutomaticas, aplicarReincorporaciones, escribirLetrasAusencia } = require('./services/vistaFinal');
    const estado = await aplicarAusenciasAutomaticas();
    const reincorporaciones = await aplicarReincorporaciones();
    const letras = await escribirLetrasAusencia();
    console.log(`✅ [VISTA_FINAL] ausencias: ${JSON.stringify({ estado, reincorporaciones, letras })}`);
    res.json({ ok: true, estado, reincorporaciones, letras });
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

// Recuperación ÚNICA: restaura las L borradas de las semanas pasadas del mes en curso
// re-aplicando el patrón vivo de AGENDA_V2 (sin tocar celdas con horas >0). Correcto si
// nadie cambió su libranza desde entonces. Después, el cron ya las conserva congeladas.
app.get('/vista-final/recuperar-libranzas', async (req, res) => {
  console.log('🩹 [VISTA_FINAL] recuperar libranzas pasadas (re-aplicando patrón)...');
  try {
    const { reconstruirVistaFinal } = require('./services/vistaFinal');
    const r = await reconstruirVistaFinal({ recuperarLibranzas: true });
    console.log(`✅ [VISTA_FINAL] libranzas recuperadas: ${JSON.stringify(r)}`);
    res.json({ ok: true, recuperado: true, ...r });
  } catch (error) {
    console.error(`❌ [VISTA_FINAL] Error: ${error.stack || error.message}`);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Auditoría EN VIVO: vigila cada pocos minutos los coches planificados que
//    ruedan estando en descanso. Se apaga con VIVO_ACTIVO=off. ────────────────
if (require('./services/modoPruebas').ACTIVO) {
  // OJO: esta arranca con setInterval, NO con cron.schedule, así que el
  // envoltorio `programar` no la alcanza y hay que frenarla aquí.
  console.log('🧪 [PRUEBAS] Auditoría en vivo NO se arranca');
} else if (process.env.VIVO_ACTIVO !== 'off') {
  require('./services/auditoriaVivo').arrancar();
} else {
  console.log('⏸️  [VIVO] Auditoría en vivo desactivada (VIVO_ACTIVO=off)');
}

// ============================================================
// CRON
// ============================================================
// `programar` sustituye a cron.schedule: en el servidor de pruebas no arranca
// ninguno. Los crons escriben en las hojas de PRODUCCIÓN y comparten con el
// servidor real la cuota de Sheets (60/min), que ya tumbó el ERP una vez.
const pruebas = require('./services/modoPruebas');
pruebas.instalarCortafuegos();

function programar(expresion, tarea, opciones) {
  if (pruebas.ACTIVO) { _cronsOmitidos.push(expresion); return null; }
  return cron.schedule(expresion, tarea, opciones);
}
const _cronsOmitidos = [];
if (pruebas.ACTIVO) {
  // Se imprime al final del arranque, cuando ya se sabe cuántos se omitieron.
  process.nextTick(() => console.log(
    `🧪 [PRUEBAS] MODO_PRUEBAS=1 — ${_cronsOmitidos.length} cron(s) NO arrancados, ` +
    'escrituras de Sheets/WhatsApp/Mapon bloqueadas. Detalle en /modo-pruebas'));
}

// Horas de conductores — DOS carriles:
//
//  · Cada hora en punto, pasada COMPLETA del mes. Es la de reparación: si una
//    pasada corta se comió una lectura a medias de Bolt, o si alguien tocó la
//    agenda, aquí se corrige solo en menos de una hora. No se quita nunca.
//  · Cada 10 minutos, pasada INCREMENTAL que rehace solo ayer y hoy. Es la que
//    hace que el control de tráfico esté fresco sin machacar la API de Bolt.
//
// Las dos escriben la misma hoja (Datos_API), así que da igual cuál llegue
// última. Se desfasan del minuto 0 para no solaparse con la completa.
programar('0 * * * *', async () => {
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
}, { timezone: 'Europe/Madrid' });

if (process.env.HORAS_INCREMENTAL !== 'off') {
  let enMarcha = false;
  programar('5,15,25,35,45,55 * * * *', async () => {
    // Una pasada corta que se alargue no debe pisar a la siguiente.
    if (enMarcha) return console.log('⏭️  [CRON Horas⚡] La anterior sigue en marcha, se salta');
    enMarcha = true;
    try {
      const { refrescarHorasIncremental } = require('./services/boltHorasCore');
      const r = await refrescarHorasIncremental();
      console.log(`⚡ [CRON Horas⚡] ${r.modo}${r.dias ? ' días ' + r.dias.join(',') : ''} · ${r.conductores} conductores`);
    } catch (error) {
      // Que falle una pasada corta no es grave: la completa de la hora repara.
      console.error(`⚠️  [CRON Horas⚡] ${error.message}`);
    } finally { enMarcha = false; }
  }, { timezone: 'Europe/Madrid' });
  if (!pruebas.ACTIVO) console.log('⚡ [Horas] Refresco incremental ACTIVADO (cada 10 min)');
}

// Resumen de flotas: cada hora al minuto 15
programar('15 * * * *', async () => {
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
  programar('30 * * * *', async () => {
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
programar('10,40 * * * *', async () => {
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

// Cada día de madrugada: borra los códigos de lavado Ballenoil NO usados que ya
// vencieron (los usados se conservan siempre, como histórico).
programar('20 4 * * *', async () => {
  try {
    const { purgarVencidos } = require('./services/codigosBallenoil');
    const r = await purgarVencidos();
    if (r.borrados) console.log(`💧 [CRON Ballenoil] Purgados ${r.borrados} código(s) vencidos sin usar`);
  } catch (error) {
    console.error(`❌ [CRON Ballenoil] Error: ${error.message}`);
  }
});

// Diagnóstico de plantillas de WhatsApp: nombre, IDIOMA y estado exactos tal como los
// tiene Meta. Es lo que resuelve el error #132001 ("Template name does not exist in the
// translation"), que casi siempre es un idioma distinto del que se pide (es vs es_ES).
app.get('/whatsapp/plantillas', async (req, res) => {
  try {
    const { listarPlantillas, estadoCuenta } = require('./services/whatsapp');
    // ?cuenta=1 → estado del número y de la empresa propietaria (límites de mensajes).
    if (req.query.cuenta) return res.json(await estadoCuenta());
    res.json(await listarPlantillas((req.query.nombre || '').toString().trim() || undefined));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Auditoría de flota: a las 5:00 (poco tráfico) procesa el día de AYER, ya cerrado.
// Es pesado (una llamada a Mapon por coche), por eso va una sola vez al día y deja el
// resultado en el Sheet; el panel de Operaciones solo lee de ahí.
programar('0 5 * * *', async () => {
  try {
    const auditoria = require('./services/auditoriaFlota');
    const dia = auditoria.diaMenos(auditoria.hoyMadrid(), 1);
    console.log(`⏰ [CRON Auditoría] procesando ${dia}...`);
    const r = await auditoria.procesarDia(dia);
    console.log(`✅ [CRON Auditoría] ${dia}: ${r.filas} matrículas, ${r.eventos} repostajes`);
  } catch (error) {
    console.error(`❌ [CRON Auditoría] Error: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// VISTA_FINAL: reescribe el mes en curso (horas + libranzas de la semana) cada
// hora al minuto 45, dejando margen tras el refresco de Datos_API (minuto 0).
programar('45 * * * *', async () => {
  console.log('⏰ [CRON VISTA_FINAL] vacaciones automáticas + reconstruirVistaFinal()...');
  try {
    const { reconstruirVistaFinal, aplicarAusenciasAutomaticas, aplicarReincorporaciones, escribirLetrasAusencia } = require('./services/vistaFinal');
    // 1) A quien le empieza/corre hoy una ausencia (V/B/P) → estado automático.
    const aus = await aplicarAusenciasAutomaticas();
    if (aus.aplicados) console.log(`🏖️ [CRON VISTA_FINAL] ${aus.aplicados} ausencia(s): ${aus.conductores.join(', ')}`);
    // 1bis) La inversa: a quien se le ACABARON las letras (hoy ya no hay V/B/P) se le
    //       reincorpora solo → Activo si su semana está cubierta, si no Pendiente Asignar.
    const rein = await aplicarReincorporaciones();
    if (rein.reincorporados) console.log(`🎉 [CRON VISTA_FINAL] ${rein.reincorporados} reincorporación(es): ${rein.conductores.join(', ')}`);
    // 2) Con fecha de reincorporación → rellenar las letras del periodo en la bitácora.
    const let2 = await escribirLetrasAusencia();
    if (let2.celdas) console.log(`📝 [CRON VISTA_FINAL] ${let2.celdas} celda(s) de ausencia: ${let2.conductores.join(', ')}`);
    const result = await reconstruirVistaFinal();
    console.log(`✅ [CRON VISTA_FINAL] Completado: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`❌ [CRON VISTA_FINAL] Error: ${error.stack || error.message}`);
  }
});

// SANCIONES DE VELOCIDAD: cada 15 min (con desfase) busca excesos en Mapon, resuelve el
// conductor y registra/avisa. APAGADO por defecto: se activa con SANCIONES_CRON=on cuando
// esté verificado (y SANCIONES_MODO=live para que envíe de verdad; si no, solo simula).
if (process.env.SANCIONES_CRON === 'on') {
  programar('3,18,33,48 * * * *', async () => {
    try {
      const sanciones = require('./services/sanciones');
      const r = await sanciones.procesar();
      if (r && r.nuevas) console.log(`🚦 [CRON Sanciones] ${JSON.stringify({ modo: r.modo, nuevas: r.nuevas, advertencias: r.advertencias, reincidencias: r.reincidencias, sinConductor: r.sinConductor })}`);
    } catch (error) {
      console.error(`❌ [CRON Sanciones] ${error.stack || error.message}`);
    }
  });
  console.log('🚦 [Sanciones] Cron de velocidad ACTIVADO (cada 15 min)');
}

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
  // Siembra el primer superadmin si SUPERADMIN_EMAIL está definido y aún no existe.
  sesion.sembrarSuperadmin();
});