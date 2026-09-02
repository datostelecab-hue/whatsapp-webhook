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

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  [SESIÓN] SESSION_SECRET no está definida: uso un secreto efímero (las sesiones NO sobrevivirán a un reinicio). Defínela en Render.');
}

// Qué rol entra a cada módulo (prefijo de ruta). El superadmin entra a todo; lo
// que no esté aquí es compartido (cualquier usuario autenticado): Pendientes,
// Peticiones, Bitácora, Configuración, Visor, Notificaciones, Documentos…
const ACCESO = {
  '/vacantes': ['oficina'], '/seleccion': ['oficina'], '/ett': ['oficina'],
  '/rrhh': ['oficina'], '/administracion': ['oficina'], '/fichas': ['oficina'],
  '/ticketera': ['oficina'], '/reportes': ['oficina'], '/nominas': ['oficina'], '/convenio': ['oficina'],
  '/incorporaciones': ['trafico'], '/planificador': ['trafico'], '/planificador-v2': ['trafico'], '/agenda': ['trafico'],
  '/control': ['trafico'], '/flota-viva': ['trafico'], '/cobertura': ['trafico'], '/generador': ['trafico'],
  '/matching': ['trafico'], '/vehiculos': ['trafico'], '/operaciones': ['trafico'], '/horas': ['trafico'],
  '/sanciones': ['trafico'], '/callcenter': ['trafico'], '/migraciones': ['desarrollador'], '/explorador': ['desarrollador'],
  // La plantilla la miran los dos departamentos: Trafico para saber quien
  // puede conducir hoy, RRHH para saber quien esta de alta y con que.
  '/plantilla': ['oficina', 'trafico'], '/conductores': ['oficina', 'trafico'],
  // Exportar no ensena nada que no se este viendo ya: lo que llega son las
  // filas que el navegador tiene delante. Vale con estar dentro.
  '/exportar': ['oficina', 'trafico']
};

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

// Control de acceso por rol según el prefijo de la ruta.
function controlAcceso(req, res, next) {
  const u = req.usuario;
  if (!u) return next();               // ya lo cubre `protegido`
  if (ADMIN_TOTAL.includes(u.rol)) return next();
  const seg = '/' + (req.path.split('/')[1] || '');
  const permitidos = ACCESO[seg];
  if (permitidos && !permitidos.includes(u.rol)) {
    if (esApi(req)) return res.status(403).json({ status: 'error', msg: 'Sin permiso para esta sección' });
    return res.status(403).render('sin-permiso', { titulo: 'Sin permiso', seccion: '', layout: 'layout-gestion' });
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
  COOKIE, ACCESO,
  ponerSesion, cerrarSesion,
  cargarSesion, protegido, forzarCambio, controlAcceso, requiereSuperadmin, requiereDesarrollador,
  sembrarSuperadmin
};
