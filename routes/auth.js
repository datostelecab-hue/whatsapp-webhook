const express = require('express');
const router = express.Router();
const usuarios = require('../services/usuarios');
const sesion = require('../services/sesion');
const limite = require('../services/limiteIntentos');
const { enviarCorreo } = require('../services/correo');

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
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'ip?';
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
    sesion.ponerSesion(res, u);
    usuarios.registrarAcceso(email);
    if (u.debe_cambiar === 'si') return res.redirect('/cambiar-password');
    return res.redirect(rutaSegura(next) ? next : '/');
  } catch (e) {
    console.error('❌ [AUTH] login:', e.message);
    return fallo('No se pudo iniciar sesión. Inténtalo de nuevo.');
  }
});

router.get('/logout', (req, res) => { sesion.cerrarSesion(res); res.redirect('/login'); });
router.post('/logout', (req, res) => { sesion.cerrarSesion(res); res.redirect('/login'); });

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
    await usuarios.fijarPassword(email, b.nueva);
    const actualizado = await usuarios.buscarUsuario(email);
    sesion.ponerSesion(res, actualizado);   // re-emite la sesión ya sin "debe_cambiar"
    return res.redirect('/');
  } catch (e) {
    return fallo(e.message || 'No se pudo cambiar la contraseña.');
  }
});

// ── Olvidé mi contraseña → nueva provisional por correo + cambio forzado ─────
router.get('/olvide-password', (req, res) => {
  res.render('olvide-password', { titulo: 'Recuperar acceso', layout: LAYOUT, mensaje: null, error: null });
});

router.post('/olvide-password', async (req, res) => {
  const email = usuarios.normalizarEmail((req.body || {}).email);
  // Respuesta genérica siempre (no se revela qué correos existen).
  const generico = 'Si ese correo tiene una cuenta, te hemos enviado una contraseña provisional.';
  try {
    const u = await usuarios.buscarUsuario(email);
    if (u && u.estado !== usuarios.ESTADOS_U.BLOQUEADO) {
      const prov = usuarios.generarPasswordProvisional();
      await usuarios.actualizarUsuario(email, { hash: usuarios.hashPassword(prov), debe_cambiar: 'si' });
      const r = await enviarCorreo({ to: email, subject: 'Recuperar acceso — Telecab',
        text: `Se ha solicitado recuperar el acceso de ${email}.\n\nTu nueva contraseña provisional es: ${prov}\n\nEntra en la plataforma y el sistema te pedirá crear una nueva. Si no lo has pedido tú, avisa al administrador.` });
      if (!r.enviado) console.log(`🔑 [AUTH] Provisional (reset) de ${email}: ${prov}`);
    }
  } catch (e) { console.error('❌ [AUTH] olvide-password:', e.message); }
  res.render('olvide-password', { titulo: 'Recuperar acceso', layout: LAYOUT, mensaje: generico, error: null });
});

module.exports = router;
