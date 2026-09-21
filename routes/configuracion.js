const express = require('express');
const router = express.Router();
const sesion = require('../services/sesion');
const usuarios = require('../modules/Usuarios/usuarios.service');
const sesiones = require('../modules/Usuarios/sesiones.service');
const configApp = require('../services/configApp');
const cripto = require('../services/cripto');
const correo = require('../services/correo');

// Página de configuración (tema para todos; usuarios y correo solo superadmin).
router.get('/', (req, res) => {
  res.render('configuracion', { titulo: 'Configuración', seccion: 'configuracion', layout: 'layout-gestion' });
});

// ── SESIONES ABIERTAS ───────────────────────────────────────────────────────
// Cada uno ve las SUYAS: no hay forma de pedir las de otro, porque el usuario
// sale de la sesión y no de la petición. Quién puede cerrar qué lo decide
// `sesiones.service`, no estas rutas ni la pantalla.

router.get('/mis-sesiones', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    res.json({ status: 'ok', ...await sesiones.mias(req.usuario.id, req.usuario.sid) });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.post('/mis-sesiones/cerrar', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    const sid = String((req.body || {}).sid || '');
    const r = await sesiones.cerrarUna({ usuarioId: req.usuario.id, sidActual: req.usuario.sid, sid });
    sesion.olvidarSesion(sid);
    // Cerrar la propia es salir: la cookie se va con ella o el navegador seguiría
    // enseñando una pantalla que ya no responde.
    if (r.propia) sesion.cerrarSesion(res);
    res.json({ status: 'ok', ...r, ...await sesiones.mias(req.usuario.id, req.usuario.sid) });
  } catch (e) { res.status(403).json({ status: 'error', msg: e.message }); }
});

router.post('/mis-sesiones/cerrar-las-demas', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    const r = await sesiones.cerrarLasDemas({ usuarioId: req.usuario.id, sidActual: req.usuario.sid });
    res.json({ status: 'ok', ...r, ...await sesiones.mias(req.usuario.id, req.usuario.sid) });
  } catch (e) { res.status(403).json({ status: 'error', msg: e.message }); }
});

// Cada usuario completa/edita su propia "firma" (nombre, apellidos, teléfono).
router.post('/mi-perfil', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    const b = req.body || {};
    const nombre = String(b.nombre || '').trim();
    if (!nombre) throw new Error('Falta el nombre');
    const actualizado = await usuarios.actualizarUsuario(req.usuario.email, {
      nombre, apellidos: String(b.apellidos || '').trim(), telefono: String(b.telefono || '').trim()
    });
    // Contraseña de correo (CIFRADA) — solo si el usuario ha escrito una nueva.
    if (b.pass_correo) await usuarios.guardarPassCorreo(req.usuario.email, b.pass_correo);
    sesion.renovarSesion(res, actualizado, req.usuario);   // refresca la firma, conservando si era larga
    res.json({
      status: 'ok',
      usuario: { nombre: actualizado.nombre, apellidos: actualizado.apellidos, telefono: actualizado.telefono },
      tieneCorreo: b.pass_correo ? true : usuarios.tienePassCorreo(actualizado)
    });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Guarda el tema de la interfaz en el perfil del usuario y lo mete en la sesión
// (así se pinta desde el servidor sin depender del localStorage y sigue al usuario).
router.post('/mi-tema', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    const tema = String((req.body || {}).tema || '').trim().slice(0, 24);
    if (!tema) throw new Error('Tema vacío');
    const actualizado = await usuarios.actualizarUsuario(req.usuario.email, { tema });
    sesion.renovarSesion(res, actualizado, req.usuario);   // el tema nuevo, sin acortar la sesión
    res.json({ status: 'ok', tema });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Encender o apagar las AYUDAS al pasar el cursor. Va en el perfil, como el
// tema, para que la decisión siga a la persona y no al navegador.
router.post('/mis-ayudas', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    const ayudas = (req.body || {}).ayudas !== false;
    const actualizado = await usuarios.actualizarUsuario(req.usuario.email, { ayudas });
    sesion.renovarSesion(res, actualizado, req.usuario);   // sin acortar la sesión
    res.json({ status: 'ok', ayudas });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// ¿El usuario tiene su contraseña de correo configurada?
router.get('/mi-correo', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    const u = await usuarios.buscarUsuario(req.usuario.email);
    res.json({ status: 'ok', email: req.usuario.email, tieneCorreo: usuarios.tienePassCorreo(u) });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Prueba: envía un correo COMO el propio usuario (desde su buzón) a un destino.
router.post('/mi-perfil/probar-correo', async (req, res) => {
  try {
    if (!req.usuario) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
    const to = ((req.body && req.body.to) || req.usuario.email || '').trim();
    if (!to) throw new Error('Sin destinatario');
    const r = await correo.enviarComoUsuario(req.usuario.email, {
      to, subject: 'Prueba de tu correo — Telecab',
      text: `Prueba de envío desde tu propio correo (${req.usuario.email}). Si lo recibes, tu contraseña de correo está bien configurada.`
    });
    res.json({ status: r.enviado ? 'ok' : 'error', enviado: !!r.enviado, msg: r.motivo || '' });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// ── Correo para procesos (solo superadmin) ───────────────────────────────────
router.get('/correo', sesion.requiereSuperadmin, async (req, res) => {
  try { res.json({ status: 'ok', estado: await correo.estadoCorreo() }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.post('/correo', sesion.requiereSuperadmin, async (req, res) => {
  try {
    const b = req.body || {};
    const cambios = {
      correo_host: (b.host || '').trim(),
      correo_port: String(Number(b.port) || 587),
      correo_user: (b.user || '').trim(),
      correo_from: (b.from || '').trim()
    };
    // El remitente «De:» debe ser del mismo dominio que el usuario autenticado: los
    // servidores SMTP rechazan enviar "como" una dirección que no es tuya (p. ej. un
    // @gmail). Se puede enviar A cualquier destinatario, pero no DESDE cualquier dirección.
    if (cambios.correo_from && cambios.correo_user) {
      const domU = (cambios.correo_user.split('@')[1] || '').toLowerCase();
      const domF = (cambios.correo_from.split('@')[1] || '').toLowerCase();
      if (domF && domU && domF !== domU) {
        throw new Error(`El remitente «De:» debe ser del mismo dominio que el usuario (@${domU}). No puedes enviar como una dirección que no es tuya.`);
      }
    }
    // La contraseña solo se toca si el superadmin escribe una nueva (va cifrada).
    if (b.pass) {
      if (!cripto.configurada()) throw new Error('Falta CRED_KEY en el servidor para cifrar la contraseña');
      cambios.correo_pass_cifrada = cripto.cifrar(String(b.pass));
    }
    const actual = await configApp.leerConfig();
    const tienePass = !!cambios.correo_pass_cifrada || !!actual.correo_pass_cifrada;
    // El envío se activa solo si están los datos mínimos.
    cambios.correo_activo = (cambios.correo_host && cambios.correo_user && tienePass) ? 'si' : '';
    // Quién lo cambió queda apuntado: "¿quién tocó el correo de salida?" es la
    // pregunta que se hace cuando algo deja de enviarse, y la hoja no lo decía.
    await configApp.guardarConfig(cambios, (req.usuario || {}).id);
    res.json({ status: 'ok', estado: await correo.estadoCorreo() });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/correo/prueba', sesion.requiereSuperadmin, async (req, res) => {
  try {
    const to = ((req.body && req.body.to) || req.usuario.email || '').trim();
    if (!to) throw new Error('Sin destinatario');
    console.log(`🧪 [CORREO] Prueba pedida por ${req.usuario.email} → ${to}`);
    const r = await correo.enviarCorreo({
      to, subject: 'Prueba de correo — Telecab',
      text: 'Correo de prueba de la plataforma Telecab. Si lo recibes, el envío está bien configurado.'
    });
    console.log(`🧪 [CORREO] Prueba resultado: enviado=${r.enviado}${r.motivo ? ' · ' + r.motivo : ''}`);
    res.json({ status: r.enviado ? 'ok' : 'error', enviado: !!r.enviado, msg: r.motivo || '' });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
