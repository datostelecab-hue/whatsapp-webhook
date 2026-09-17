const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const cron = require('node-cron');
const app = express();

// ── DETRÁS DE UN PROXY: la IP de verdad ─────────────────────────────────────
// Render pone su proxy delante, así que la IP del socket es siempre la suya y
// la del cliente viaja en `X-Forwarded-For`. Sin esto, quien quisiera leerla
// tenía que abrir la cabecera a mano y quedarse con el PRIMER valor — que es
// justamente el que puede escribir el propio cliente: basta con mandar tu
// `X-Forwarded-For` para aparecer con la IP que te dé la gana.
//
// Con `trust proxy = 1` Express cuenta UN salto de confianza (el de Render) y
// `req.ip` devuelve el que de verdad entró, ignorando lo que el cliente haya
// metido delante. Son dos cosas las que dependen de ello y las dos importan:
//
//   · el freno de fuerza bruta del login, que cuenta fallos POR IP y hasta
//     ahora se esquivaba cambiando esa cabecera en cada intento;
//   · el libro de las cuentas fantasma, que apunta desde dónde se mueven las
//     horas de una persona a otra.
//
// SON DOS SALTOS, NO UNO. Se puso 1 y se comprobó contra la realidad: una
// acción hecha desde la oficina —IP pública 80.103.26.249— quedó apuntada como
// 188.114.111.197, que es el proxy de delante. Con 1 se estaba guardando la IP
// de ese proxy, la misma para todo el mundo, y eso convertía el libro en un
// campo inútil y el freno del login en un contador compartido por la empresa
// entera.
//
// No es `true`: eso se fía de la cadena entera, que es lo mismo que no fiarse de
// nada, porque el cliente puede escribir por delante lo que quiera. Con un
// número, Express cuenta desde la derecha —donde solo escriben los proxies— y lo
// que el cliente se invente se queda siempre más a la izquierda.
//
// Si mañana cambia la infraestructura, el libro de cuentas fantasma guarda la
// cadena entera (db/136): se mira ahí y se ajusta este número, sin adivinar.
app.set('trust proxy', 2);
// Parser JSON global (2mb). Las rutas que suben archivos en base64 (documentos de
// conductores y adjuntos de soporte) se SALTAN este parser y aplican su propio
// límite mayor dentro de su router; si no, este 2mb las capaba silenciosamente.
const jsonGlobal = express.json({ limit: '2mb' });
// Rutas que suben archivos en base64 y ponen su PROPIO limite mas alto dentro
// de su router. Tienen que saltarse este parser: si corre antes, rechaza la
// peticion por tamano y el limite de dentro no llega a aplicarse nunca.
const SUBEN_ARCHIVOS = ['/documentos', '/soporte', '/plantilla/api/documento', '/facturas/api/pdf'];
app.use((req, res, next) => {
  if (SUBEN_ARCHIVOS.some(p => req.path.startsWith(p))) return next();
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
// DOS raices de vistas, no una. Express busca en orden, asi que un modulo ya
// mudado puede llevarse su .ejs dentro (modules/Vehiculos/vistas/) sin que
// `res.render('vehiculos')` cambie ni una letra, y el layout comun sigue
// encontrandose en views/. Durante la Fase 2 conviven las dos casas.
const RAICES_VISTAS = [path.join(__dirname, 'views')];
for (const m of require('fs').readdirSync(path.join(__dirname, 'modules'), { withFileTypes: true })) {
  if (!m.isDirectory()) continue;
  const v = path.join(__dirname, 'modules', m.name, 'vistas');
  if (require('fs').existsSync(v)) RAICES_VISTAS.push(v);
}
app.set('views', RAICES_VISTAS);
app.set('layout', 'layout');

// Marca de version para los estaticos. Los archivos de /assets se cachean un
// dia; sin esto, un despliegue que cambia el CSS o un script deja a la gente
// con la copia vieja hasta el dia siguiente, y "no funciona" sin que se vea por
// que. En Render cada despliegue trae un commit distinto, asi que la URL cambia
// sola y el navegador vuelve a pedir el archivo.
app.locals.v = (process.env.RENDER_GIT_COMMIT || '').slice(0, 8) || String(Date.now());

// `est()` pone esa marca. Las vistas lo usan para TODO lo que pueda cambiar
// (hojas de estilo y scripts); el logo y el video se quedan sin ella porque no
// cambian nunca y asi se siguen cacheando de verdad.
app.locals.est = ruta => ruta + (ruta.indexOf('?') === -1 ? '?v=' : '&v=') + app.locals.v;

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
// Planificador legacy (Google Sheets) ELIMINADO. /planificador sirve ahora el
// tablero PostgreSQL (modules/Planificacion), el mismo que /planificador-v2.
const coberturaRoutes = require('./modules/Planificacion/cobertura.controller');
const vehiculosRoutes = require('./modules/Vehiculos/vehiculos.controller');
const plantillaRoutes = require('./routes/plantilla');
const documentosRoutes = require('./modules/Documentos/documentos.controller');
const controlRoutes = require('./modules/Control/control.controller');
const vacantesRoutes = require('./routes/vacantes');
const generadorRoutes = require('./routes/generador');
const seleccionRoutes = require('./routes/seleccion');
const ettRoutes = require('./routes/ett');
const rrhhRoutes = require('./routes/rrhh');
const administracionRoutes = require('./routes/administracion');
const soporteRoutes = require('./routes/soporte');
const ticketsTelecabRoutes = require('./routes/ticketsTelecab');
const reportesRoutes = require('./routes/reportes');
const nominasRoutes = require('./modules/Nominas/nominas.controller');
const convenioRoutes = require('./modules/RRHH/convenio.controller');
const bitacoraRoutes = require('./modules/Operaciones/bitacora.controller');
const configuracionRoutes = require('./routes/configuracion');
const notificacionesRoutes = require('./routes/notificaciones');
const pendientesRoutes = require('./modules/RRHH/pendientes.controller');
const operacionesRoutes = require('./modules/Operaciones/operaciones.controller');
const sancionesRoutes = require('./modules/Operaciones/sanciones.controller');
const bodaRoutes = require('./routes/boda');
const authRoutes = require('./modules/Usuarios/auth.controller');
const usuariosRoutes = require('./modules/Usuarios/usuarios.controller');
const sesion = require('./services/sesion');

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

  // Si no es verificación de Meta, a la app: con sesión al INICIO, si no al login.
  //
  // Antes iba a /pendientes tuviera uno permiso o no, y quien no lo tenía se
  // comía un "Sin permiso" nada más entrar: más de uno creyó que la web se había
  // caído. /inicio no se bloquea nunca; ya decide él qué enseñar.
  return res.redirect(req.usuario ? '/inicio' : '/login');
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
app.use(sesion.cargarPermisos);
app.use('/inicio', require('./routes/inicio'));
app.use('/justificantes', require('./modules/Control/justificantes.controller'));
app.use('/recaudacion', require('./modules/Administracion/recaudacion.controller'));
app.use('/usuarios', usuariosRoutes);

app.use('/planificador', require('./modules/Planificacion/tablero.controller'));
app.use('/planificador-v2', require('./modules/Planificacion/tablero.controller'));   // alias (el front llama a /planificador-v2/api/*)
app.use('/cobertura', coberturaRoutes);
app.use('/vehiculos', vehiculosRoutes);
app.use('/taller', require('./modules/Vehiculos/taller.controller'));
app.use('/facturas', require('./modules/Vehiculos/facturas.controller'));
app.use('/fichaje', require('./modules/Fichaje/fichaje.controller'));
app.use('/plantilla', plantillaRoutes);
// La pantalla se llamo /conductores mientras se construia. Quien tenga ese
// enlace guardado no se encuentra un 404.
app.get('/conductores', (req, res) => res.redirect(301, '/plantilla'));
app.use('/documentos', documentosRoutes);
app.use('/control', controlRoutes);
app.use('/visibilidad', require('./routes/visibilidad'));
app.use('/alertas', require('./modules/Control/alertas.controller'));
app.use('/bi', require('./routes/bi'));   // inteligencia de negocio (solo dirección)
app.use('/vacantes', vacantesRoutes);
app.use('/generador', generadorRoutes);
app.use('/seleccion', seleccionRoutes);
app.use('/ett', ettRoutes);
app.use('/rrhh', rrhhRoutes);
app.use('/administracion', administracionRoutes);
// La exportacion a Excel de la Plantilla vieja no se perdio: se generalizo aqui
// y ahora la usa cualquier listado.
app.use('/exportar', require('./routes/exportar'));
// ── LA TICKETERA: cinco bandejas, un solo módulo ────────────────────────────
// Lo que piden los conductores por el formulario, repartido por áreas. Cada
// bandeja cuelga del módulo al que pertenece el trabajo, así que el permiso sale
// del prefijo y no hace falta ninguna clave nueva.
//
// La de OPERACIONES es la que no existía: el Apps Script mandaba a RRHH todo lo
// que no encajaba con ninguna regla y ahí se perdía entre trescientos tickets.
// Son justo los que hay que mirar.
const ticketera = require('./modules/Ticketera/ticketera.controller');
app.use('/ticketera', ticketera.para('RRHH', {
  titulo: 'Ticketera RRHH', seccion: 'ticketera',
  subtitulo: 'Vacaciones, bajas, permisos, nóminas, cuentas y papeles. Al aplicar una ausencia se abre el tramo en la ficha de la persona.' }));
app.use('/administracion/tickets', ticketera.para('ADMIN', {
  titulo: 'Tickets de Administración', seccion: 'administracion',
  subtitulo: 'Ballenoil y reintegros de gastos.' }));
app.use('/planificador/tickets', ticketera.para('TRAFICO', {
  titulo: 'Tickets de Tráfico', seccion: 'planificador',
  subtitulo: 'Cambios de libranza que piden los conductores.' }));
app.use('/taller/tickets', ticketera.para('TALLER', {
  titulo: 'Tickets del taller', seccion: 'taller',
  subtitulo: 'Incidencias del vehículo que avisan los conductores.' }));
app.use('/operaciones/sin-traza', ticketera.para('OPERACIONES', {
  titulo: 'Tickets sin traza', seccion: 'operaciones',
  subtitulo: 'Los que el reparto automático no supo clasificar. Cada uno es o algo que no habíamos previsto, o una regla que se quedó corta: al moverlo a su bandeja se ve cuál de las dos.' }));
app.use('/soporte', soporteRoutes);
app.use('/tickets-telecab', ticketsTelecabRoutes);
app.use('/reportes', reportesRoutes);
app.use('/nominas', nominasRoutes);
app.use('/convenio', convenioRoutes);
app.use('/bitacora', bitacoraRoutes);
// El módulo /incorporaciones se ELIMINÓ: su alerta vive en el planificador
// (banner de incorporaciones, tabla `incorporacion`) y en Pendientes.
app.use('/configuracion', configuracionRoutes);
app.use('/notificaciones', notificacionesRoutes);
app.use('/pendientes', pendientesRoutes);
app.use('/operaciones', operacionesRoutes);
app.use('/sanciones', sancionesRoutes);
app.use('/callcenter', require('./modules/Control/callcenter.controller'));
app.use('/migraciones', require('./routes/migraciones'));
app.use('/explorador', require('./routes/explorador'));

// Diagnóstico del servidor de pruebas: qué se ha bloqueado y qué crons no corren.
app.get('/modo-pruebas', (req, res) => {
  res.json({ status: 'ok', ...pruebas.estado(), cronsOmitidos: _cronsOmitidos });
});

// ── ¿DESDE DÓNDE ME VE EL SISTEMA? ──────────────────────────────────────────
// Para saber con qué IP entra un dispositivo hay que preguntárselo AL PROPIO
// SISTEMA, no a una página de fuera: son dos conexiones distintas y pueden
// salir por caminos distintos —pasó con un móvil que en ipinfo daba la IP de la
// oficina y aquí llegaba con la del operador—. Abriendo esto en el mismo
// navegador y en el mismo momento, no hay nada que interpretar.
//
// Sirve además para dar de alta una red nueva: se abre desde allí, se copia la
// IP y se añade a REDES_EMPRESA.
//
// No lleva permiso: no enseña nada que quien está dentro no pueda ver de sí
// mismo, y el día que haga falta comprobarlo siempre es con prisa.
app.get('/mi-red', (req, res) => {
  const red = require('./services/redEmpresa');
  const ip = req.ip || req.socket.remoteAddress || null;
  res.json({
    status: 'ok',
    ip,
    enLaEmpresa: ip ? red.esDeLaEmpresa(ip) : null,
    // La prueba, no solo la conclusión: si el número de saltos de `trust proxy`
    // se quedara corto otra vez, aquí se ve en la cadena.
    cadena: req.headers['x-forwarded-for'] || null,
    ipCliente: req.headers['cf-connecting-ip'] || null,
    // El valor de verdad, no uno escrito a mano: si alguien lo cambia, aquí se ve.
    saltosDeConfianza: app.get('trust proxy'),
    redesDeLaEmpresa: red.REDES,
    equipo: /Android|iPhone|iPad|Mobile/i.test(req.headers['user-agent'] || '') ? 'móvil' : 'ordenador',
    agente: req.headers['user-agent'] || null,
    quien: (req.usuario || {}).nombre || null,
  });
});

// ── FLOTA VIVA: qué está haciendo ahora mismo cada coche de BOLT ────────────
// Módulo nuevo y aparte. Todo lo suyo vive en services/flotaViva/, sus tablas
// empiezan por `fv_` y su conexión es propia (FLOTA_VIVA_DB_URL). Aquí solo se
// engancha.
app.use('/flota-viva', require('./modules/Control/flota.controller'));

// ── BODA (favor aparte, módulo OCULTO): panel solo-superadmin para enviar las
//    invitaciones por WhatsApp. No está en el menú ni en ACCESO. El webhook (POST /)
//    ya enruta por phone_number_id lo que llega al número de la boda. ──────────────
app.use('/boda-igna-cruz', bodaRoutes);

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

// (Aquí vivían los crons que rellenaban la hoja Datos_API y el libro de resumen
// de flotas, con su interruptor HOJAS_CRONS. La tubería entera se borró el
// 15/09/2026: las horas están en PostgreSQL y las miran Visibilidad, la
// Bitácora y el reporte de Control.)

// (Aquí corría cada media hora un cron que cruzaba los tickets «Pendiente en
// BOLT» con el padrón. Se borró el 15/09/2026 al pasar Selección a PostgreSQL:
// ese estado está marcado OBSOLETO en el catálogo —`cat_estado_candidatura`— y
// el enlace con la cuenta de BOLT lo hace ya `pasarARRHH`, que la busca por
// teléfono y la ata sola, más la pasada del padrón de la ingesta. El cron
// vigilaba un paso del embudo que ya no existe.)

// ── LA INGESTA ──────────────────────────────────────────────────────────────
// El latido: cada 5 minutos se mira qué toca traer de BOLT y de Mapon.
//
// Es la UNICA puerta por la que entran datos externos. Ninguna pantalla llama a
// una API para pintarse: leen de PostgreSQL, que es lo que las hace rapidas y
// lo que hace que una caida de Mapon no se note en RRHH.
//
// Cada tarea decide cada cuanto tiene sentido repetirla (services/ingesta.js):
// el padron de conductores no cambia cada cinco minutos y pedirlo asi son
// cientos de paginas por hora. El latido es de 5; la cadencia, de cada tarea.
programar('*/5 * * * *', async () => {
  try {
    await require('./services/ingesta').latido();
  } catch (error) {
    console.error(`❌ [INGESTA] El latido falló entero: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// La ingesta se poda A DIARIO a las 00:00. Lo que pesa es el PAYLOAD CRUDO en JSON
// de cada descarga (ingesta_descarga.payload): con ventanas que se solapan a
// propósito (state_logs 2h/10min, orders 48h/60min) el mismo dato se re-guarda
// docenas de veces → ~90-250 MB/día. Nadie RE-LEE ese crudo (la maduración de una
// orden se RE-DESCARGA de BOLT, no se lee del JSON viejo), así que vaciarlo pronto
// es seguro. El dato bueno (bolt_state_log, bolt_order, mapon_zona_evento, fv_*) NO
// se toca: son tablas aparte, idempotentes. Retención del crudo configurable con
// INGESTA_CRUDO_DIAS (1 por defecto; súbela a 2 si el disco lo permite, para cubrir
// la ventana de 48h de maduración de órdenes en depuración manual).
programar('0 0 * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const crudoDias = Number(process.env.INGESTA_CRUDO_DIAS) || 1;
    const d = await bd.consulta('SELECT purgar_descargas($1) AS n', [crudoDias]);
    if (d.rows[0].n) console.log(`🧹 [INGESTA] Vaciado el crudo de ${d.rows[0].n} descarga(s) (>${crudoDias}d)`);
    // El registro de ejecuciones (ingesta_ejecucion) es metadato ligero, no presiona
    // disco: se conservan 7 días (28 los fallos). Sin agresividad aquí.
    const r = await bd.consulta('SELECT purgar_ingesta(7) AS n');
    if (r.rows[0].n) console.log(`🧹 [INGESTA] Purgadas ${r.rows[0].n} filas del registro`);
    // VACUUM normal (NO bloquea lecturas/escrituras, al contrario que VACUUM FULL):
    // acelera reutilizar el hueco muerto del TOAST que deja el vaciado, para que la
    // marca de agua de la tabla no suba en un plan pequeño. Encoger el fichero de
    // verdad es VACUUM FULL (con lock), que solo hace falta una vez tras un backlog.
    try { await bd.consulta('VACUUM ingesta_descarga'); } catch (e) { /* no crítico */ }
  } catch (error) {
    console.error(`⚠️  [INGESTA] Purga: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// ── VISIBILIDAD ─────────────────────────────────────────────────────────────
// Foto diaria de horas de flota para el visor (reemplaza al "VISOR EN VIVO" de la
// hoja). Solo LEE del núcleo, así que es barato: refresca hoy+ayer cada 20 min (el
// pasado ya está sellado) y sana el mes entero una vez al día, ya cerrada la jornada.
programar('8,28,48 * * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    await require('./services/visibilidad').capturaCorriente();
  } catch (error) {
    console.error(`⚠️  [Visibilidad] captura hoy/ayer: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// ── BI ──────────────────────────────────────────────────────────────────────
// Los hechos del cuadro de mando (horas, ingresos, km) son vistas materializadas:
// se refrescan cada hora, en el minuto 15 para no pisarse con la captura de
// Visibilidad. Tarda unos segundos y no bloquea a nadie (CONCURRENTLY).
programar('15 * * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const r = await require('./services/bi').refrescar();
    console.log('📊 [BI] refresco: ' + r.vistas.map(v => v.vista.replace('bi_hecho_', '') + ' ' + v.ms + ' ms').join(' · '));
  } catch (error) {
    console.error(`⚠️  [BI] refresco: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// A LAS 05:30, NO A LAS 03:25. La jornada va de 05:00 a 05:00, así que a las 03:25
// el turno de noche todavía está rodando: sellar ahí guardaba la foto a medias.
programar('30 5 * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const r = await require('./services/visibilidad').backfillMesActual();
    console.log(`📸 [Visibilidad] Backfill del mes: ${r.dias} día(s)`);
  } catch (error) {
    console.error(`⚠️  [Visibilidad] backfill del mes: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// ── RENDIMIENTO ─────────────────────────────────────────────────────────────
// EL CUADRANTE VUELVE A LA NORMALIDAD DESPUÉS DE UN EVENTO.
//
// Cada apaño de evento ya nace con fecha de fin y con la vuelta del desalojado
// puesta, así que el cuadrante se recompone solo. Esto es el REPASO: cerrar el
// evento y reconciliar contra la foto de antes por si algo quedó torcido. A las
// 05:10, justo después de que muera el último turno de noche (05:00) y antes de
// que nadie mire el tablero.
programar('10 5 * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const r = await require('./modules/Planificacion/tablero.service').repasarEventos();
    if (r.devueltos) {
      console.log(`🎪 [Eventos] ${r.devueltos} evento(s) devueltos a la normalidad ` +
        `(${r.hechos.reduce((n, h) => n + h.arreglos.length, 0)} plaza(s) recolocadas)`);
    }
  } catch (error) {
    console.error(`⚠️  [Eventos] repaso diario: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// Dos cosas que se calculan juntas porque dependen de lo mismo: el promedio de
// horas del mes corrido (`conductor_rendimiento`, que usa el reporte de
// asistencia) y la CALIFICACIÓN A-D del MES CORRIDO (`conductor_calificacion`), que
// es la letra que se pinta al lado del nombre en el planificador y en Control. A las 05:40, DESPUÉS de que
// la bitácora selle la jornada (05:35): si se calculara antes, el último día
// entraría a medias.
programar('40 5 * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const r = await require('./services/repo/rendimiento').recalcular();
    console.log(`⭐ [Rendimiento] ${r.filas} persona(s) · mes ${r.mes} hasta ${r.hasta}`);
    const cal = require('./services/repo/calificacion');
    const c = await cal.recalcular();
    console.log(`⚖️  [Calificación] ${c.guardadas} persona(s) · ${c.periodoInicio} → ${c.periodoFin}` +
      (c.telemetria.completa ? '' : ` · OJO: telemetría incompleta, ${c.telemetria.dias} día(s) con datos`));
  } catch (error) {
    console.error(`⚠️  [Rendimiento] recálculo diario: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// Y A LAS 12:00 OTRA VEZ, ahora TODOS.
//
// Antes aquí solo se recalculaban los TodoTurno, porque su jornada no cierra a
// las 05:00 sino al mediodía. Pero al turno de NOCHE le pasa lo mismo: a las
// 05:40 lo suyo aún se está cerrando, y salían con horas de menos. Al mediodía
// la jornada anterior está cerrada para TODO EL MUNDO, sin excepciones, así que
// esta pasada deja el promedio bueno para todos.
//
// La de las 05:40 se queda: da una cifra utilizable a primera hora, cuando
// Tráfico empieza a colocar gente. Esta la corrige. Son 200 filas sobre
// histórico ya sellado: no le cuesta nada al servidor y es idempotente.
programar('0 12 * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const r = await require('./services/repo/rendimiento').recalcular();
    console.log(`⭐ [Rendimiento] mediodía (todos): ${r.filas} persona(s) · mes ${r.mes} hasta ${r.hasta}`);
    const c = await require('./services/repo/calificacion').recalcular();
    console.log(`⚖️  [Calificación] mediodía: ${c.guardadas} persona(s) · ${c.periodoInicio} → ${c.periodoFin}`);
  } catch (error) {
    console.error(`⚠️  [Rendimiento] recálculo del mediodía: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// ── CONVENIO: EL REGISTRO DE JORNADA DEL ART. 18.9 ──────────────────────────
// A las 05:50 se deriva AYER: los cambios de estado de BOLT se convierten en
// asientos del convenio (art. 18.6) y en el registro diario de jornada, que es
// una obligación legal literal y no un informe nuestro.
//
// AYER Y NO HOY: la jornada de hoy no ha terminado, y la de un turno de noche ni
// siquiera ha empezado a cerrarse. Derivar un día a medias no rompe nada —es
// idempotente— pero deja un registro que dice menos horas de las que hubo.
//
// Va DESPUÉS del sellado de la bitácora (05:35) a propósito: las dos leen lo
// mismo y no hay razón para que se pisen en el pool.
//
// El primer día de cada mes, además, se abren los contratos que falten y se
// publican los objetivos del mes que entra. Los objetivos se COMUNICAN por
// anticipado (art. 18.1), así que tienen que existir el día 1, no el 30.
programar('50 5 * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const convenio = require('./modules/RRHH/convenio.service');

    const hoy = new Intl.DateTimeFormat('en-CA',
      { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (hoy.slice(8, 10) === '01') {
      await convenio.sincronizarContratos({});
      await convenio.publicarObjetivos({ anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) });
    }

    const r = await convenio.derivarAyer();
    if (r && r.nuevos) {
      console.log(`[CRON Convenio] ${r.desde}: ${r.conductores} conductor(es) · ${r.nuevos} asiento(s) nuevo(s)`);
    }
  } catch (error) {
    console.error(`[Convenio] derivación diaria: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// ── BITÁCORA ────────────────────────────────────────────────────────────────
// Al cerrar la jornada se SELLAN las horas de los días que ya terminaron
// (bitacora_horas). A partir de ahí la bitácora los lee de ahí y no vuelve a
// calcularlos: el pasado no se mueve porque hoy se enlace una cuenta de BOLT o
// se cambie una plaza. Se sellan los TRES últimos días cerrados, no solo uno,
// porque BOLT entrega tramos con retraso y el de anteayer puede haber crecido.
programar('35 5 * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const bit = require('./modules/Operaciones/bitacora.service');
    const enCurso = require('./services/repo/llamadas').diaOperativoHoy();
    const menos = n => new Date(Date.parse(enCurso + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
    const r = await bit.sellarHoras(menos(3), menos(1));
    console.log(`📒 [Bitácora] Selladas ${r.filas} fila(s) de horas · ${r.desde} → ${r.hasta}`);
  } catch (error) {
    console.error(`⚠️  [Bitácora] sellado de horas: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

// (Los odometros de Mapon ya no tienen cron propio: son una tarea mas de la
// ingesta, con su cadencia y su registro de si funciono.)

// ── LO QUE VINO DE PRODUCCION ───────────────────────────────────────────────
// Estos dos crons nacieron en `main` con `cron.schedule` directo. Aqui van por
// `programar()` como todo lo demas, y NO es cosmetico: `programar` es lo que los
// apaga con MODO_PRUEBAS=1.
//
// Importa sobre todo para el segundo. El repaso de bloqueos INMOVILIZA COCHES
// de verdad; un modo pruebas que no lo detuviera seria peor que no tener modo
// pruebas, porque da falsa confianza.

// Flota viva: cada 5 minutos, que dice BOLT del conductor y Mapon del coche.
//
// No arranca sin `FLOTA_VIVA_DB_URL`: sin base no tiene donde guardar los tramos,
// y sin tramos no puede contestar "cuanto lleva asi", que es todo el modulo.
if (process.env.FLOTA_VIVA_DB_URL || process.env.DATABASE_URL) {
  programar('*/5 * * * *', async () => {
    try {
      await require('./services/flotaViva/motor').pasada();
    } catch (error) {
      console.error(`❌ [FLOTA VIVA] La vuelta falló: ${error.message}`);
    }
  }, { timezone: 'Europe/Madrid' });
} else {
  console.log('⏸️  [FLOTA VIVA] Sin FLOTA_VIVA_DB_URL: el módulo no arranca');
}

// Repaso del corte de motor: deja bloqueado todo coche que nadie este usando.
//
// No sobra por tener el bloqueo al terminar turno. Ese falla a veces —el coche
// iba rodando, o estaba sin cobertura— y no hay quien lo reintente; y un coche
// que nunca ha tenido un turno no se bloquearia jamas. Este repaso cierra los
// dos agujeros, y no hace NADA mientras FICHAJE_BLOQUEO_MOTOR no este a 1.
//
// Cada diez minutos y no cada uno: un coche que acaba de parar tiene que
// esperar de todas formas a llevar un buen rato quieto, asi que correr no sirve
// de nada y si gasta cuota de Mapon.
programar('*/10 * * * *', async () => {
  try {
    const r = await require('./services/fichaje').repasarBloqueos();
    if (r.bloqueados && r.bloqueados.length) {
      console.log(`🔒 [CRON FICHAJE] ${r.bloqueados.length} coche(s) bloqueado(s): ` +
        r.bloqueados.map(x => x.matricula).join(', '));
    }
  } catch (error) {
    console.error(`❌ [CRON FICHAJE] El repaso de bloqueos falló: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

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

// ── LA DEUDA DE EFECTIVO, AL DÍA ────────────────────────────────────────────
// Cada media hora se vuelve a medir lo que BOLT dice que cobró en mano cada
// conductor, desde el corte hasta hoy.
//
// POR QUÉ EXISTE ESTE CRON. La deuda solo se recalculaba cuando alguien pulsaba
// el botón de la pantalla, y eso se hizo por última vez el 10 de septiembre. El
// día 14, Elián Fernando Bonilla vino a entregar dinero y la pantalla le pedía
// 289,05 € cuando debía 773,75: le faltaban los 484,70 € que había cobrado en
// efectivo del 10 al 14, porque la quincena EN CURSO sigue viva y nadie la
// volvía a mirar. No era el único: 44 personas y 6.140,40 € sin apuntar.
//
// Las quincenas ya cerradas estaban perfectas al céntimo, así que el cálculo
// nunca estuvo mal; lo que faltaba era que alguien lo ejecutara. La ingesta trae
// los pedidos cada 5 minutos y la deuda no los seguía.
//
// ES SEGURO AUTOMATIZARLO, y esa es la razón de poder hacerlo sin supervisión:
//   · No toca nada anterior al corte, donde la verdad es el Excel y no BOLT:
//     `calcularDesdeBolt` se niega en redondo.
//   · No pisa JAMÁS los ajustes hechos a mano, que viven en otra columna y
//     llevan su motivo escrito. Solo reescribe el importe medido por BOLT.
//   · Es idempotente: dos pasadas seguidas dejan lo mismo.
//   · Las cuentas sin ficha que se parecen a alguien de la plantilla se quedan
//     fuera, para no apuntarle la deuda dos veces a la misma persona.
//
// CADA MEDIA HORA. La ingesta trae los pedidos cada cinco minutos, pero no hay
// ninguna prisa en que un viaje tarde media hora en convertirse en deuda: quien
// viene a la ventanilla ve, como mucho, media hora de retraso.
//
// Y solo mira LAS QUINCENAS QUE PUEDEN CAMBIAR —la de hoy y la anterior—, no
// todas desde el corte como hace el boton. Eso no es por la frecuencia sino
// porque la lista de quincenas crece para siempre: recorrerla entera costaria
// 42 s por pasada dentro de un ano y 83 s dentro de dos, rehaciendo una cuenta
// que ya estaba hecha. Mirando solo lo vivo cuesta 3 s, hoy y siempre.
programar('7,37 * * * *', async () => {
  try {
    const bd = require('./services/db');
    if (!bd.HAY_BD) return;
    const r = await require('./modules/Administracion/recaudacion.service').recalcularReciente({});
    // Solo se escribe cuando algo se movió: un cron que habla cada media hora
    // para decir "nada" es ruido que acaba tapando el aviso que sí importa.
    const cambios = (r.cambios || []).length, nuevos = (r.nuevos || []).length;
    if (cambios || nuevos) {
      console.log(`💶 [CRON Recaudación] Deuda al día: ${nuevos} nuevo(s), ${cambios} cambio(s)`);
    }
    // Esto sí se dice siempre que pase: es una cuenta de BOLT sin enlazar que se
    // llama como alguien de la plantilla, y hasta que alguien la enlace esa
    // deuda no se le está reclamando a nadie.
    if ((r.sospechosas || []).length) {
      console.warn(`⚠️  [CRON Recaudación] ${r.sospechosas.length} cuenta(s) de BOLT sin enlazar que ` +
        'se parecen a gente de la plantilla: ' +
        r.sospechosas.slice(0, 5).map(x => `${x.nombre} ≈ ${x.pareceA}`).join(' · '));
    }
  } catch (error) {
    console.error(`❌ [CRON Recaudación] No se pudo poner la deuda al día: ${error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

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
// Es la tarea más cara que hay —una llamada a Mapon por coche, unos 20 segundos—
// y por eso va una sola vez al día.
//
// El cron solo pone la HORA: el trabajo lo hace la ingesta, que es quien lleva
// la cuenta de lo que corrió, cuánto tardó y si falló. Antes esto era un cron
// mudo, y si dejaba de funcionar nadie se enteraba hasta que alguien echaba en
// falta un día en la pantalla. Si a las 5 falla, el latido lo reintenta solo
// —con una hora de espera entre intentos, que para 144 llamadas a Mapon es la
// diferencia entre reintentar y machacar.
programar('0 5 * * *', async () => {
  console.log('⏰ [CRON Auditoría] lanzando la tarea de ingesta...');
  await require('./services/ingesta').ejecutar('auditoria_flota', { forzar: true });
}, { timezone: 'Europe/Madrid' });

// SANCIONES DE VELOCIDAD: cada 15 min (con desfase) busca excesos en Mapon, resuelve el
// conductor y registra/avisa. APAGADO por defecto: se activa con SANCIONES_CRON=on cuando
// esté verificado (y SANCIONES_MODO=live para que envíe de verdad; si no, solo simula).
if (process.env.SANCIONES_CRON === 'on') {
  programar('3,18,33,48 * * * *', async () => {
    try {
      const sanciones = require('./modules/Operaciones/sanciones.service');
      const r = await sanciones.procesar();
      if (r && r.nuevas) console.log(`🚦 [CRON Velocidad] ${JSON.stringify({ modo: r.modo, nuevas: r.nuevas, avisos: r.avisos, sinConductor: r.sinConductor, dudosas: r.dudosas, errores: r.errores })}`);
    } catch (error) {
      console.error(`❌ [CRON Sanciones] ${error.stack || error.message}`);
    }
  });
  console.log('🚦 [Sanciones] Cron de velocidad ACTIVADO (cada 15 min)');
}

// ALERTAS DE CONTROL: cada 5 minutos DENTRO de las franjas de vigilancia
// (08:00-13:00 y 20:00-01:00, más el margen de cortesía). Fuera de ellas el
// propio módulo no hace nada, pero no se programa a todas horas para no
// preguntar 288 veces al día lo que solo importa en diez.
//
// Nace en modo PRUEBAS (registra las alertas y no manda nada) y sin
// destinatarios: hasta que no se elija a alguien en /alertas, no sale un solo
// WhatsApp por mucho que alguien rechace.
programar('*/5 8-13,20-23,0-1 * * *', async () => {
  try {
    const r = await require('./modules/Control/alertas.service').revisar({});
    if (r && r.nuevas) {
      console.log(`🔔 [CRON Alertas] franja ${r.franja} · ${r.pasan} por encima del umbral · ` +
        `${r.nuevas} nueva(s) · ${r.enviadas} envío(s)${r.modo !== 'live' ? ' (PRUEBAS)' : ''}` +
        `${r.cortadas ? ` · ${r.cortadas} cortadas por el tope` : ''}`);
    }
  } catch (error) {
    console.error(`❌ [CRON Alertas] ${error.stack || error.message}`);
  }
}, { timezone: 'Europe/Madrid' });

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

  // Comprobaciones de arranque. Las dos existían con un comentario que decía
  // "se llama al arrancar" y NADIE las llamaba: un mapa desalineado no daba la
  // cara hasta que alguien abría la pantalla concreta que lo usaba.
  const bd = require('./services/db');
  if (bd.HAY_BD) {
    // ¿Sigue cuadrando el mapa de vigencias con las tablas reales?
    require('./services/repo/vigencia').comprobarMapa().catch(e =>
      console.error('⚠️  [VIGENCIA] No se pudo comprobar: ' + e.message));
    // (Aquí se comprobaba que el constructor de filas de la agenda cubriera
    //  todas las columnas de la hoja. Ese constructor murió con el motor viejo
    //  el 15/09/2026: ya no hay filas de hoja que construir.)
  }
});