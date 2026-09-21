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
    sesion.ponerSesion(res, u, { recordar, sid });
    usuarios.registrarAcceso(email);
    if (u.debe_cambiar === 'si') return res.redirect('/cambiar-password');
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
    await usuarios.fijarPassword(email, b.nueva);
    const actualizado = await usuarios.buscarUsuario(email);
    // Cambiar la contrasena echa a TODAS las demas sesiones: es lo que uno
    // espera de un cambio de contrasena, y es la unica forma de recuperar una
    // cuenta cuya sesion larga se quedo abierta en un ordenador ajeno.
    try {
      if (actualizado.id) { await usuarios.cortarSesiones(actualizado.id); usuarios.olvidarCorte(actualizado.id); }
    } catch (e) { console.error('❌ [AUTH] no se pudieron cortar las sesiones:', e.message); }
    sesion.ponerSesion(res, actualizado, { recordar: !!(req.usuario && req.usuario.larga) });
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
