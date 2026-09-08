// ============================================================
// SESIÓN — login por cookie firmada (sin librerías de store)
// ============================================================
// La sesión va en una cookie firmada con HMAC (estilo JWT). Es "stateless": no se
// guarda en memoria, así que SOBREVIVE a los reinicios/despliegues de Render (nadie
// se desloguea al desplegar). El secreto de firma vive en SESSION_SECRET (env).
//
// El rol se lee de la sesión (ya no del navegador) y se valida en el SERVIDOR, así
// el menú y las acciones sensibles quedan realmente protegidos.

const crypto = require('crypto');

const COOKIE = 'telecab_sesion';
const DURACION_MS = 12 * 60 * 60 * 1000;   // 12 h
const PROD = process.env.NODE_ENV === 'production';

// Versión de los assets estáticos. Cambia en cada arranque —o sea, en cada
// despliegue—, así el navegador vuelve a pedir el JS/CSS en vez de servir una
// copia vieja de caché. Se cuelga en res.locals.v y las vistas lo ponen como
// `?v=<%= v %>`. Fue justo esto: una pantalla nueva pedía una función que el
// helper ya tenía, pero el navegador seguía con el fichero de antes.
const ARRANQUE = Date.now().toString(36);

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  [SESIÓN] SESSION_SECRET no está definida: uso un secreto efímero (las sesiones NO sobrevivirán a un reinicio). Defínela en Render.');
}

// El acceso ya NO va por rol con un mapa fijo: cada usuario lleva SUS módulos y
// submódulos en la tabla usuario_permiso, elegidos uno a uno desde /usuarios.
// El catálogo de claves (y el prefijo más largo que gobierna cada ruta) vive en
// services/permisos.js. Los roles con acceso total (admin, desarrollador) entran
// a todo sin filas; lo que no está en el catálogo es libre para quien esté
// dentro (Configuración, Soporte, Exportar, Perfil…).
const permisos = require('./permisos');

// ── Firma / verificación del token ──────────────────────────────────────────
function firmar(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verificar(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const esperado = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (_) { return null; }
  if (!p || !p.exp || Date.now() > p.exp) return null;
  return p;
}

function leerCookie(req, nombre) {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

const esApi = req => req.path.includes('/api/') || req.xhr || (req.get('accept') || '').includes('application/json');

/** Emite la cookie de sesión para un usuario. */
function ponerSesion(res, u) {
  const payload = {
    id: u.id || null,
    email: u.email, nombre: u.nombre, apellidos: u.apellidos || '', telefono: u.telefono || '', rol: u.rol,
    tema: u.tema || '',
    debe_cambiar: u.debe_cambiar === 'si' || u.debe_cambiar === true,
    iat: Date.now(), exp: Date.now() + DURACION_MS
  };
  res.cookie(COOKIE, firmar(payload), { httpOnly: true, sameSite: 'lax', secure: PROD, path: '/', maxAge: DURACION_MS });
}
function cerrarSesion(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: PROD, path: '/' });
}

// ── Middlewares ─────────────────────────────────────────────────────────────
// Decodifica la cookie (si hay) y la deja en req.usuario / res.locals. Nunca corta.
function cargarSesion(req, res, next) {
  const u = verificar(leerCookie(req, COOKIE));
  req.usuario = u || null;
  res.locals.usuario = u || null;
  res.locals.rol = u ? u.rol : null;
  res.locals.tema = u ? (u.tema || '') : null;   // tema del perfil (para pintar sin parpadeo)
  res.locals.v = ARRANQUE;                         // versión de assets (cache-bust por despliegue)
  next();
}

// Exige sesión: sin ella, a /login (páginas) o 401 (API).
function protegido(req, res, next) {
  if (req.usuario) return next();
  if (esApi(req)) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/'));
}

// Mientras use la provisional, se le obliga a cambiarla antes de usar nada más.
function forzarCambio(req, res, next) {
  if (req.usuario && req.usuario.debe_cambiar) {
    const exento = ['/cambiar-password', '/logout'].some(p => req.path.startsWith(p));
    if (!exento) {
      if (esApi(req)) return res.status(403).json({ status: 'error', msg: 'Debes cambiar tu contraseña' });
      return res.redirect('/cambiar-password');
    }
  }
  next();
}

// Roles con acceso TOTAL al sistema (el desarrollador es un superadmin + su ticketera IT).
const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

// El id del usuario de la sesión; las sesiones viejas (sin id en la cookie) se
// resuelven una vez por email y se recuerdan.
const _idPorEmail = new Map();
async function idDeSesion(u) {
  if (!u) return null;
  if (u.id) return u.id;
  const k = String(u.email || '').toLowerCase();
  if (!k) return null;
  if (_idPorEmail.has(k)) return _idPorEmail.get(k);
  try {
    const usuarios = require('./usuarios');
    const x = await usuarios.buscarUsuario(k);
    if (x && x.id) { _idPorEmail.set(k, x.id); return x.id; }
  } catch (_) {}
  return null;
}

// Control de acceso POR USUARIO: manda la clave más específica del catálogo que
// case con la ruta; si el usuario no la tiene concedida, fuera. Lo que no está
// en el catálogo es libre (basta estar dentro).
// La pantalla de inicio NO se bloquea NUNCA. Es donde cae todo el mundo al
// entrar, y rebotarla contra "sin permiso" es lo que hacía que la gente creyera
// que la web se había caído. Su clave (`/inicio`) sigue existiendo, pero la mira
// la propia pantalla para decidir si enseña las cifras o el panel vacío.
const SIEMPRE_ABIERTO = ['/inicio'];

async function controlAcceso(req, res, next) {
  const u = req.usuario;
  if (!u) return next();               // ya lo cubre `protegido`
  if (ADMIN_TOTAL.includes(u.rol)) return next();
  if (SIEMPRE_ABIERTO.some(r => req.path === r || req.path.startsWith(r + '/'))) return next();
  const clave = permisos.claveDeRuta(req.path);
  if (!clave) return next();
  try {
    const id = await idDeSesion(u);
    const mias = id ? await permisos.clavesDe(id) : new Set();
    if (mias.has(clave)) return next();
  } catch (e) {
    console.error('❌ [SESIÓN] control de acceso:', e.message);
  }
  if (esApi(req)) return res.status(403).json({ status: 'error', msg: 'Sin permiso para esta sección' });
  return res.status(403).render('sin-permiso', { titulo: 'Sin permiso', seccion: '', layout: 'layout-gestion' });
}

// Deja en res.locals.permisos las claves del usuario (null = acceso total), para
// que el menú pinte solo lo que puede abrir. Va DESPUÉS de controlAcceso.
//
// Y de paso el NOMBRE de su rol, que es lo que se lee bajo su nombre en la
// cabecera. Sale de la tabla `rol` (con caché) y no de una lista escrita en la
// plantilla: si no, cada rol nuevo aparecería ahí con su código en crudo
// —"jefe_trafico"— hasta que alguien se acordara de esta vista.
async function cargarPermisos(req, res, next) {
  const u = req.usuario;
  res.locals.permisos = null;
  res.locals.rolNombre = u ? u.rol : '';
  if (u) {
    try {
      // `usuarios` se pide aquí dentro y no arriba: los dos módulos se llaman
      // entre sí y en el tope se quedarían a medio cargar.
      const r = (await require('./usuarios').roles()).find(x => x.codigo === u.rol);
      if (r) res.locals.rolNombre = r.etiqueta;
    } catch (_) { /* con el código basta para pintar la cabecera */ }
  }
  if (u && !ADMIN_TOTAL.includes(u.rol)) {
    try {
      const id = await idDeSesion(u);
      res.locals.permisos = id ? [...await permisos.clavesDe(id)] : [];
    } catch (_) { res.locals.permisos = []; }
  }
  next();
}

function requiereSuperadmin(req, res, next) {
  // El desarrollador tiene todos los poderes del superadmin.
  if (req.usuario && ADMIN_TOTAL.includes(req.usuario.rol)) return next();
  if (esApi(req)) return res.status(403).json({ status: 'error', msg: 'Solo el superadmin' });
  return res.status(403).render('sin-permiso', { titulo: 'Sin permiso', seccion: '', layout: 'layout-gestion' });
}

// Solo el desarrollador (excluye incluso al superadmin): para "Tickets Telecab".
function requiereDesarrollador(req, res, next) {
  if (req.usuario && req.usuario.rol === 'desarrollador') return next();
  if (esApi(req)) return res.status(403).json({ status: 'error', msg: 'Solo el desarrollador' });
  return res.status(403).render('sin-permiso', { titulo: 'Sin permiso', seccion: '', layout: 'layout-gestion' });
}

// ── Siembra del primer superadmin (bootstrap) ───────────────────────────────
// Con SUPERADMIN_EMAIL definido: si ese usuario no existe aún, se crea con una
// contraseña provisional. El correo se envía si el SMTP está configurado; si no,
// la provisional queda en los logs de Render (para no quedarse fuera nunca).
async function sembrarSuperadmin() {
  const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) { console.log('   Superadmin semilla: SUPERADMIN_EMAIL no definido (omito).'); return; }
  const usuarios = require('./usuarios');
  try {
    if (await usuarios.buscarUsuario(email)) { console.log(`   Superadmin semilla: ${email} ya existe.`); return; }
    const nombre = (process.env.SUPERADMIN_NOMBRE || 'Superadmin').trim();
    const { passwordProvisional } = await usuarios.crearUsuario({ email, nombre, rol: 'superadmin', creado_por: 'sistema' });
    console.log(`✅ [SESIÓN] Superadmin creado: ${email}`);
    const { enviarCorreo } = require('./correo');
    const asunto = 'Acceso a la plataforma Telecab';
    const texto = `Hola ${nombre},\n\nSe ha creado tu acceso de superadministrador.\n\nUsuario: ${email}\nContraseña provisional: ${passwordProvisional}\n\nEntra y el sistema te pedirá crear tu propia contraseña.`;
    const r = await enviarCorreo({ to: email, subject: asunto, text: texto });
    if (!r.enviado) console.log(`🔑 [SESIÓN] Contraseña provisional del superadmin (${email}): ${passwordProvisional}`);
  } catch (e) {
    console.error('❌ [SESIÓN] No se pudo sembrar el superadmin:', e.message);
  }
}

module.exports = {
  COOKIE,
  ponerSesion, cerrarSesion,
  cargarSesion, protegido, forzarCambio, controlAcceso, cargarPermisos,
  requiereSuperadmin, requiereDesarrollador,
  sembrarSuperadmin
};
