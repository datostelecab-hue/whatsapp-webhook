const express = require('express');
const router = express.Router();
const usuarios = require('./usuarios.service');
const sesion = require('../../services/sesion');
const sesiones = require('./sesiones.service');
const limite = require('../../services/limiteIntentos');
const { enviarCorreo } = require('../../services/correo');

const LAYOUT = 'layout-auth';
// next solo se acepta si es una ruta interna (evita open-redirect).
const rutaSegura = n => typeof n === 'string' && n.startsWith('/') && !n.startsWith('//');

// ── Login ───────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.usuario) return res.redirect('/');
  res.render('login', { titulo: 'Acceso', layout: LAYOUT, error: null, next: req.query.next || '' });
});

router.post('/login', async (req, res) => {
  const b = req.body || {};
  const email = usuarios.normalizarEmail(b.email);
  // `req.ip`, no la cabecera a mano: con `trust proxy` puesto en app.js, Express
  // ya descarta lo que el cliente haya metido delante en X-Forwarded-For. Leer
  // el primer valor de esa cabecera —como se hacía— dejaba esquivar este mismo
  // freno cambiándola en cada intento.
  const ip = req.ip || req.socket.remoteAddress || 'ip?';
  const next = b.next || '/';
  const fallo = msg => res.status(401).render('login', { titulo: 'Acceso', layout: LAYOUT, error: msg, next });

  // Anti fuerza bruta: si la IP o el email acumulan fallos, se frena un rato.
  const espera = Math.max(limite.segundosBloqueo('ip:' + ip), limite.segundosBloqueo('mail:' + email));
  if (espera > 0) return fallo(`Demasiados intentos fallidos. Espera ${Math.ceil(espera / 60)} min e inténtalo de nuevo.`);

  try {
    const u = await usuarios.buscarUsuario(email);
    if (!u || !usuarios.verificarHash(String(b.password || ''), u.hash)) {
      limite.registrarFallo('ip:' + ip);
      limite.registrarFallo('mail:' + email);
      return fallo('Correo o contraseña incorrectos.');
    }
    if (u.estado === usuarios.ESTADOS_U.BLOQUEADO) return fallo('Tu cuenta está desactivada. Contacta con el administrador.');
    limite.limpiar('ip:' + ip);
    limite.limpiar('mail:' + email);
    // "Mantener sesion iniciada": 30 dias en vez de 12 h. Solo es seguro porque
    // se puede cortar desde el servidor (usuarios.cortarSesiones).
    const recordar = b.recordar === 'si' || b.recordar === 'on' || b.recordar === true;
    // LA SESION SE APUNTA ANTES DE EMITIR EL TOKEN, porque su `sid` va dentro.
    // Y el dispositivo se reconoce por su propia cookie: es lo que hace que
    // salir y volver a entrar desde el mismo PC siga siendo el mismo PC, que es
    // de lo que depende la regla del dispositivo padre.
    let sid = null;
    try {
      const abierta = await sesiones.abrir({
        usuarioId: u.id,
        dispositivo: sesion.dispositivoDe(req, res),
        agente: req.get('user-agent') || '',
        ip,
        larga: recordar,
        duracionMs: recordar ? sesion.DURACION_LARGA_MS : sesion.DURACION_MS,
      });
      sid = abierta.sid;
    } catch (e) {
      // Si no se puede apuntar, se entra IGUAL. Dejar a alguien fuera porque no
      // se pudo escribir una fila de auditoria seria cambiar un problema
      // pequeno por uno grande; lo que se pierde es poder cerrar ESA sesion por
      // separado, y se dice en el log.
      console.error('\u26a0\ufe0f  [AUTH] no se pudo registrar la sesion:', e.message);
    }
    // LA SEDE con la que entra (el selector del login). Barcelona cae en su
    // planificador; un `next` de Madrid no le sirve, así que solo se respeta si
    // es de Barcelona.
    const sede = sesion.sedeValida(b.sede);
    sesion.ponerSesion(res, u, { recordar, sid, sede });
    usuarios.registrarAcceso(email);
    if (u.debe_cambiar === 'si') return res.redirect('/cambiar-password');
    if (sede === 'barcelona') return res.redirect(rutaSegura(next) && next.startsWith('/barcelona') ? next : '/barcelona');
    return res.redirect(rutaSegura(next) ? next : '/');
  } catch (e) {
    console.error('❌ [AUTH] login:', e.message);
    return fallo('No se pudo iniciar sesión. Inténtalo de nuevo.');
  }
});

// SALIR CIERRA LA FILA, no solo la cookie. Si no, la sesion seguiria saliendo en
// la lista de "abiertas" de la otra pantalla, y esa lista dejaria de significar
// nada: quien la mira quiere saber DONDE hay una sesion viva, y una que ya se
// cerro no lo es.
async function salir(req, res) {
  const sid = req.usuario && req.usuario.sid;
  if (sid) {
    await sesiones.cerrar(sid, { porUsuarioId: req.usuario.id, motivo: 'logout' }).catch(() => {});
    sesion.olvidarSesion(sid);
  }
  sesion.cerrarSesion(res);
  res.redirect('/login');
}
router.get('/logout', salir);
router.post('/logout', salir);

// ── Cambio de contraseña (primer acceso forzado y cambio voluntario) ─────────
router.get('/cambiar-password', (req, res) => {
  if (!req.usuario) return res.redirect('/login');
  res.render('cambiar-password', { titulo: 'Cambiar contraseña', layout: LAYOUT, error: null,
    primerAcceso: !!req.usuario.debe_cambiar, usuario: req.usuario });
});

router.post('/cambiar-password', async (req, res) => {
  if (!req.usuario) return res.redirect('/login');
  const b = req.body || {};
  const email = req.usuario.email;
  const primerAcceso = !!req.usuario.debe_cambiar;
  const fallo = msg => res.status(400).render('cambiar-password', { titulo: 'Cambiar contraseña', layout: LAYOUT, error: msg, primerAcceso, usuario: req.usuario });
  try {
    if (String(b.nueva || '').length < 8) return fallo('La nueva contraseña debe tener al menos 8 caracteres.');
    if (b.nueva !== b.repetir) return fallo('Las contraseñas no coinciden.');
    const u = await usuarios.buscarUsuario(email);
    if (!u) return res.redirect('/login');
    if (!primerAcceso && !usuarios.verificarHash(String(b.actual || ''), u.hash)) return fallo('La contraseña actual no es correcta.');
    // En el libro (db/248): lo cambia el propio usuario, desde el acceso.
    const yo = { usuarioId: req.usuario.id, origen: 'acceso' };
    await usuarios.fijarPassword(email, b.nueva, yo);
    const actualizado = await usuarios.buscarUsuario(email);
    // Cambiar la contrasena echa a TODAS las demas sesiones: es lo que uno
    // espera de un cambio de contrasena, y es la unica forma de recuperar una
    // cuenta cuya sesion larga se quedo abierta en un ordenador ajeno.
    try {
      if (actualizado.id) { await usuarios.cortarSesiones(actualizado.id, yo); usuarios.olvidarCorte(actualizado.id); }
    } catch (e) { console.error('❌ [AUTH] no se pudieron cortar las sesiones:', e.message); }
    sesion.ponerSesion(res, actualizado, { recordar: !!(req.usuario && req.usuario.larga), sede: req.usuario.sede });
    return res.redirect('/');
  } catch (e) {
    return fallo(e.message || 'No se pudo cambiar la contraseña.');
  }
});

// ── Cambiar de sede sin volver a entrar ─────────────────────────────────────
// El botón «Ir a Madrid / Ir a Barcelona» del menú. Re-emite la sesión con la
// otra sede (conservando si era larga y su sid) y lleva a su portada.
router.post('/sede', (req, res) => {
  if (!req.usuario) return res.redirect('/login');
  const sede = sesion.sedeValida((req.body || {}).sede);
  sesion.ponerSesion(res, req.usuario, { recordar: !!req.usuario.larga, sid: req.usuario.sid, sede });
  res.redirect(sede === 'barcelona' ? '/barcelona' : '/inicio');
});

// ── Olvidé mi contraseña → un ENLACE de un solo uso (26/11/2026) ─────────────
// Llega un enlace firmado (el secreto de las sesiones), que caduca en una hora y
// lleva una huella de la contraseña de ahora. Hasta que se abre NO cambia nada.
// Al abrirlo, la contraseña vieja deja de valer (por eso es de un solo uso), se
// entra y se pide la nueva (el cambio forzado de siempre).
const crypto = require('crypto');
const UNA_HORA = 60 * 60 * 1000;
const huellaDe = hash => crypto.createHash('sha256').update(String(hash || '')).digest('base64url').slice(0, 16);
const baseDe = req => {
  const d = require('../../services/dominioErp').dominio();
  return d ? `https://${d}` : `${req.protocol}://${req.get('host')}`;
};

router.get('/olvide-password', (req, res) => {
  res.render('olvide-password', { titulo: 'Recuperar acceso', layout: LAYOUT, mensaje: null, error: null });
});

router.post('/olvide-password', async (req, res) => {
  const email = usuarios.normalizarEmail((req.body || {}).email);
  // Respuesta genérica siempre (no se revela qué correos existen).
  const generico = 'Si ese correo tiene una cuenta, te hemos enviado un enlace para entrar. Caduca en una hora.';
  const listo = () => res.render('olvide-password', { titulo: 'Recuperar acceso', layout: LAYOUT, mensaje: generico, error: null });
  const ip = req.ip || '';
  try {
    // Sin avalancha de correos: como mucho unos pocos por correo y por IP (el
    // mismo contador que el del login, con su propia clave).
    if (Math.max(limite.segundosBloqueo('reset-ip:' + ip), limite.segundosBloqueo('reset:' + email)) > 0) return listo();
    limite.registrarFallo('reset-ip:' + ip);
    limite.registrarFallo('reset:' + email);
    const u = await usuarios.buscarUsuario(email);
    if (u && u.estado !== usuarios.ESTADOS_U.BLOQUEADO) {
      const t = sesion.firmarDato({ t: 'reset', e: email, h: huellaDe(u.hash), exp: Date.now() + UNA_HORA });
      const enlace = `${baseDe(req)}/restablecer?t=${encodeURIComponent(t)}`;
      const r = await enviarCorreo({ to: email, subject: 'Recuperar acceso — Telecab',
        text: `Se ha pedido recuperar el acceso de ${email}.\n\nPara entrar y poner una contraseña nueva, abre este enlace (caduca en una hora y sirve una sola vez):\n${enlace}\n\nSi no lo has pedido tú, no hagas nada: tu contraseña no ha cambiado.` });
      // Nunca se escribe el enlace en el registro: vale para entrar.
      if (!r.enviado) console.error(`❌ [AUTH] olvide-password: no se pudo enviar el enlace a ${email}`);
    }
  } catch (e) { console.error('❌ [AUTH] olvide-password:', e.message); }
  return listo();
});

router.get('/restablecer', async (req, res) => {
  const caducado = () => res.status(400).render('olvide-password', { titulo: 'Recuperar acceso', layout: LAYOUT, mensaje: null,
    error: 'Ese enlace ya no vale: caducó o ya se usó. Pide otro.' });
  try {
    const p = sesion.verificarDato(String(req.query.t || ''));
    if (!p || p.t !== 'reset' || !p.e) return caducado();
    const u = await usuarios.buscarUsuario(p.e);
    if (!u || u.estado === usuarios.ESTADOS_U.BLOQUEADO || huellaDe(u.hash) !== p.h) return caducado();
    // De un solo uso: la contraseña vieja deja de valer y hay que poner otra.
    await usuarios.actualizarUsuario(p.e, { hash: usuarios.hashPassword(crypto.randomBytes(24).toString('base64url')), debe_cambiar: 'si' },
      { origen: 'acceso' });
    let sid = null;
    try {
      const abierta = await sesiones.abrir({ usuarioId: u.id, dispositivo: sesion.dispositivoDe(req, res),
        agente: req.get('user-agent') || '', ip: req.ip || '', larga: false, duracionMs: sesion.DURACION_MS });
      sid = abierta.sid;
    } catch (e) { console.error('⚠️  [AUTH] restablecer: no se pudo registrar la sesión:', e.message); }
    sesion.ponerSesion(res, await usuarios.buscarUsuario(p.e), { recordar: false, sid });
    return res.redirect('/cambiar-password');
  } catch (e) {
    console.error('❌ [AUTH] restablecer:', e.message);
    return caducado();
  }
});

module.exports = router;
