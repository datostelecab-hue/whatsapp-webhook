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
  try { req.conductor = await portal.quienEs(leerCookie(req)); }
  catch (e) { console.error('❌ [Portal] sesión:', e.message); req.conductor = null; }
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
      res.cookie(COOKIE, r.testigo, { ...opcionesCookie, maxAge: portal.SESION_DIAS * 86400000 });
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
