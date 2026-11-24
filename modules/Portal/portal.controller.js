// ============================================================
// PORTAL DE CONDUCTORES — rutas, por su dominio
// ============================================================
// El portal no es una sección del ERP: es OTRO sitio, en otro dominio
// (conductorestelecab.es), servido por el mismo servidor. `porDominio` va en
// app.js antes que todo lo del ERP y se queda con las peticiones de ese
// dominio: lo que el portal no tiene es un 404 del portal, nunca una pantalla
// del ERP. Y al revés: por el dominio del ERP no se llega al portal.
//
// Sus cookies son suyas (cada dominio lleva las suyas), y su sesión vive en la
// base (db/211), no en la cookie firmada del ERP.
//
// En local: http://conductorestelecab.localhost:3100 (scripts/entorno-local).

const express = require('express');
const portal = require('./portal.service');
const f = require('./formato');

const HOSTS = (process.env.PORTAL_HOSTS || 'conductorestelecab.es,www.conductorestelecab.es,conductorestelecab.localhost')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const esDelPortal = req => HOSTS.includes(String(req.hostname || '').toLowerCase());

const COOKIE = 'tc_conductor';
const PROD = process.env.NODE_ENV === 'production';

function leerCookie(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
const opcionesCookie = { httpOnly: true, sameSite: 'lax', secure: PROD, path: '/' };

const router = express.Router();

// Nada de esto se indexa ni se guarda en cachés intermedias: son datos de una persona.
router.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

// Quién es, por su cookie. Si la base no contesta, como si no hubiera entrado.
router.use(async (req, res, next) => {
  const testigo = leerCookie(req);
  try { req.conductor = await portal.quienEs(testigo); }
  catch (e) { console.error('❌ [Portal] sesión:', e.message); req.conductor = null; }
  // Para el libro de auditoría: lo que se escriba desde aquí, del portal y de esta ficha.
  if (req.conductor) require('../../services/contexto').poner({ origen: `portal · ficha ${req.conductor.id} · ${req.method} ${req.path}`.slice(0, 60) });
  // La sesión no caduca (20/11/2026): la cookie se vuelve a poner en cada visita,
  // porque el navegador no la deja durar más de unos 400 días.
  if (req.conductor && testigo) res.cookie(COOKIE, testigo, { ...opcionesCookie, maxAge: portal.COOKIE_DIAS * 86400000 });
  // EL TELÉFONO DE TRÁFICO (24/11/2026): con él, los avisos y la Ayuda llevan
  // «Llamar a Tráfico». Es un parámetro (caché de un minuto); sin él, no sale.
  try { res.locals.telTrafico = f.telHref(await require('../../services/parametros').valor('portal.telefono_trafico')); }
  catch (e) { res.locals.telTrafico = ''; }
  next();
});

const vista = (res, nombre, datos = {}) =>
  res.render(nombre, { layout: 'portalLayout', f, conductor: null, pagina: '', ...datos });

// ── El acceso ───────────────────────────────────────────────────────────────

const MENSAJES = {
  dni: 'Escribe tu DNI o NIE, con su letra.',
  'no-podemos': 'No podemos mandarte el código con ese DNI. Habla con RRHH para que revisen tu DNI y tu email.',
  espera: 'Has pedido demasiados códigos. Espera unos minutos y vuelve a probar.',
  correo: 'No hemos podido mandar el correo. Prueba otra vez en un rato y, si sigue sin llegar, habla con RRHH.',
  caducado: 'El código ha caducado o ya no vale. Pide uno nuevo.',
  agotado: 'Has fallado el código demasiadas veces. Pide uno nuevo.',
};
const mensajeCodigo = r => (r.motivo === 'codigo'
  ? `El código no es correcto. ${r.quedan === 1 ? 'Te queda 1 intento.' : `Te quedan ${r.quedan} intentos.`}`
  : MENSAJES[r.motivo] || 'No se ha podido entrar. Prueba otra vez.');

router.get('/entrar', (req, res) => {
  if (req.conductor) return res.redirect('/');
  vista(res, 'portalEntrar', { titulo: 'Entrar', paso: 'dni', dni: '', error: '' });
});

// Paso 1: el DNI. También sirve para «pedir otro código».
router.post('/entrar', async (req, res) => {
  const dni = String((req.body || {}).dni || '').slice(0, 30);
  try {
    const r = await portal.pedirCodigo({ dni, ip: req.ip });
    if (r.ok) return vista(res, 'portalEntrar', { titulo: 'Entrar', paso: 'codigo', dni, email: r.email, error: '' });
    vista(res.status(r.motivo === 'espera' ? 429 : 200), 'portalEntrar', { titulo: 'Entrar', paso: 'dni', dni, error: MENSAJES[r.motivo] });
  } catch (e) {
    console.error('❌ [Portal] pedir código:', e.message);
    vista(res.status(500), 'portalEntrar', { titulo: 'Entrar', paso: 'dni', dni, error: 'Algo ha fallado. Prueba otra vez en un momento.' });
  }
});

// Paso 2: el código.
router.post('/entrar/codigo', async (req, res) => {
  const dni = String((req.body || {}).dni || '').slice(0, 30);
  const email = String((req.body || {}).email || '').slice(0, 120);
  try {
    const r = await portal.entrar({ dni, codigo: (req.body || {}).codigo, ip: req.ip, agente: req.get('user-agent') });
    if (r.ok) {
      res.cookie(COOKIE, r.testigo, { ...opcionesCookie, maxAge: portal.COOKIE_DIAS * 86400000 });
      return res.redirect(303, '/');
    }
    // Con el código caducado o agotado, se vuelve a pedir: el paso del DNI con el DNI puesto.
    const otraVez = r.motivo === 'caducado' || r.motivo === 'agotado';
    vista(res, 'portalEntrar', { titulo: 'Entrar', paso: otraVez ? 'dni' : 'codigo', dni, email, error: mensajeCodigo(r) });
  } catch (e) {
    console.error('❌ [Portal] entrar:', e.message);
    vista(res.status(500), 'portalEntrar', { titulo: 'Entrar', paso: 'codigo', dni, email, error: 'Algo ha fallado. Prueba otra vez en un momento.' });
  }
});

router.post('/salir', async (req, res) => {
  await portal.salir(leerCookie(req)).catch(e => console.error('❌ [Portal] salir:', e.message));
  res.clearCookie(COOKIE, opcionesCookie);
  res.redirect(303, '/entrar');
});

// ── La Ayuda (24/11/2026): también sin haber entrado ───────────────────────
// Preguntas y respuestas cortas de cada parte de la app, en palabras de todos
// los días, y a quién llamar si algo falla (heurística 10 de Nielsen).
router.get('/ayuda', (req, res) => vista(res, 'portalAyuda', { titulo: 'Ayuda', pagina: 'portalAyuda', conductor: req.conductor || null }));

// ── Lo de dentro: hace falta haber entrado ──────────────────────────────────

router.use((req, res, next) => (req.conductor ? next() : res.redirect('/entrar')));

const pagina = (nombre, titulo, datos) => async (req, res, next) => {
  try {
    vista(res, nombre, { titulo, pagina: nombre, conductor: req.conductor, ...(await datos(req.conductor)) });
  } catch (e) { next(e); }
};

router.get('/', pagina('portalInicio', 'Inicio', portal.inicio));
router.get('/turnos', pagina('portalTurnos', 'Mis turnos', portal.turnos));
router.get('/puntuacion', pagina('portalPuntuacion', 'Mi puntuación', portal.semanas));
router.get('/efectivo', pagina('portalEfectivo', 'Mi efectivo', async p => ({ efectivo: await portal.efectivo(p) })));

// ── Mis horas (24/11/2026): el cronómetro desde que vincula el coche ─────────
// La página sale ya con los números; /horas/vivo los da otra vez cada 30 s y el
// reloj de «Horas con el coche» corre en el móvil cada segundo.
const horas = require('./portal.horas');
router.get('/horas', pagina('portalHoras', 'Mis horas', async p => ({ horas: await horas.cronometro(p) })));
router.get('/horas/vivo', async (req, res) => {
  try { res.json({ ok: true, ...(await horas.cronometro(req.conductor)) }); }
  catch (e) { console.error('❌ [Portal] mis horas:', e.message); res.status(500).json({ ok: false }); }
});

// ── El coche (20/11/2026): vincular, puertas y desvincular, como en WhatsApp ──
// Las mismas funciones que el bot (portal.coche.js). Cada acción contesta con
// la página del coche y lo que ha pasado arriba; sin JavaScript en el móvil.
const coche = require('./portal.coche');
// Las fotos se guardan 20 días: carga la tarea diaria que borra las de antes (24/11/2026).
require('./portal.fotos');
const paginaCoche = async (req, res, resultado = null) => {
  const [estado, previas] = await Promise.all([coche.estado(req.conductor),
    coche.fotosAnteriores(req.conductor).catch(e => { console.error('❌ [Portal] fotos anteriores:', e.message); return null; })]);
  vista(res, 'portalCoche', { titulo: 'Mi coche', pagina: 'portalCoche', conductor: req.conductor,
    coche: estado, previas, fotos: coche.FOTOS, resultado, matricula: '' });
};
const accionCoche = fn => async (req, res, next) => {
  try { await paginaCoche(req, res, await fn(req)); } catch (e) { next(e); }
};
router.get('/coche', accionCoche(async () => null));
router.post('/coche/vincular', accionCoche(req => coche.vincular(req.conductor, (req.body || {}).matricula)));
router.post('/coche/puertas', accionCoche(req => coche.moverPuertas(req.conductor, (req.body || {}).accion === 'abrir')));
// DESVINCULAR, CON LAS CINCO FOTOS (23/11/2026): obligatorias desde el portal.
// Llegan en el mismo formulario (multipart); en memoria, como mucho 5 y de 20 MB.
const multer = require('multer');
const subidaFotos = multer({ storage: multer.memoryStorage(), limits: { fileSize: coche.TOPE_FOTO, files: coche.FOTOS.length } })
  .fields(coche.FOTOS.map(f => ({ name: f.campo, maxCount: 1 })));
router.post('/coche/desvincular', (req, res, next) => subidaFotos(req, res, err => {
  if (!err) return next();
  const texto = err.code === 'LIMIT_FILE_SIZE' ? 'Alguna foto pasa de 20 MB. Hazla otra vez (o con menos calidad) y vuelve a probar.'
    : 'No se han podido recibir las fotos. Prueba otra vez.';
  paginaCoche(req, res, { ok: false, tono: 'aviso', titulo: 'Las fotos no han llegado', texto: [texto] }).catch(next);
}), accionCoche(req => coche.desvincularConFotos(req.conductor, req.files || {})));

// EN VIVO (23/11/2026): dónde y cómo está el coche que le toca. La pantalla lo
// pide cada 15 s.
router.get('/coche/vivo', async (req, res) => {
  try { res.json(await coche.enVivo(req.conductor)); }
  catch (e) { console.error('❌ [Portal] en vivo:', e.message); res.status(500).json({ ok: false }); }
});

// Una foto del turno anterior, si es del coche que le toca hoy.
router.get('/coche/foto/:id', async (req, res) => {
  try {
    const r = await coche.foto(req.conductor, req.params.id);
    res.status(r.estado).set(r.cabeceras);
    if (r.cuerpo) r.cuerpo.pipe(res); else res.end();
  } catch (e) {
    res.status(e.status || 500).type('text/plain').send(e.status === 403 || e.status === 404 ? 'No existe' : 'No se ha podido cargar');
  }
});

/**
 * Lo que app.js monta delante del ERP. Si la petición no es del dominio del
 * portal, sigue al ERP; si lo es, se acaba aquí: con su página, su 404 o su
 * error, nunca con algo del ERP.
 */
function porDominio(req, res, next) {
  if (!esDelPortal(req)) return next();
  router(req, res, err => {
    if (err) {
      console.error('❌ [Portal]', req.method, req.path + ':', err.message);
      return vista(res.status(500), 'portalAviso', {
        titulo: 'Algo ha fallado', conductor: req.conductor || null,
        texto: 'No hemos podido cargar esta página. Prueba otra vez en un momento.',
      });
    }
    vista(res.status(404), 'portalAviso', {
      titulo: 'No existe', conductor: req.conductor || null, texto: 'Esta página no existe.',
    });
  });
}

module.exports = { porDominio, esDelPortal, HOSTS };
