const express = require('express');
const router = express.Router();
const usuarios = require('../services/usuarios');
const sesion = require('../services/sesion');
const { enviarCorreo } = require('../services/correo');

// Todo lo de aquí es exclusivo del superadmin.
router.use(sesion.requiereSuperadmin);

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await usuarios.leerUsuarios();
    // Nunca se devuelve el hash.
    const limpia = lista.map(u => ({
      email: u.email, nombre: u.nombre, apellidos: u.apellidos, telefono: u.telefono,
      rol: u.rol, estado: u.estado, debe_cambiar: u.debe_cambiar === 'si',
      creado_por: u.creado_por, fecha_creacion: u.fecha_creacion, ultimo_acceso: u.ultimo_acceso
    }));
    res.json({ status: 'ok', usuarios: limpia, roles: usuarios.ROLES, yo: req.usuario.email });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Crear usuario → genera provisional y la envía por correo (o la devuelve para relevar).
router.post('/crear', async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.apellidos || '').trim()) throw new Error('Faltan los apellidos');
    if (!String(b.telefono || '').trim()) throw new Error('Falta el teléfono');
    const { usuario, passwordProvisional } = await usuarios.crearUsuario({
      email: b.email, nombre: b.nombre, apellidos: b.apellidos, telefono: b.telefono, rol: b.rol, creado_por: req.usuario.email
    });
    const r = await enviarCorreo({
      to: usuario.email, subject: 'Acceso a la plataforma Telecab',
      text: `Hola ${usuario.nombre},\n\nSe ha creado tu acceso a la plataforma Telecab.\n\nUsuario: ${usuario.email}\nContraseña provisional: ${passwordProvisional}\n\nEntra y el sistema te pedirá crear tu propia contraseña.`
    });
    res.json({ status: 'ok', email: usuario.email, correoEnviado: !!r.enviado, passwordProvisional });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/rol', async (req, res) => {
  try {
    const b = req.body || {};
    const email = usuarios.normalizarEmail(b.email);
    if (!usuarios.ROLES.includes(b.rol)) throw new Error('Rol no válido');
    if (email === req.usuario.email && b.rol !== 'superadmin') throw new Error('No puedes quitarte a ti mismo el rol de superadmin');
    await usuarios.actualizarUsuario(email, { rol: b.rol });
    res.json({ status: 'ok' });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/estado', async (req, res) => {
  try {
    const b = req.body || {};
    const email = usuarios.normalizarEmail(b.email);
    const estado = b.estado === 'bloqueado' ? usuarios.ESTADOS_U.BLOQUEADO : usuarios.ESTADOS_U.ACTIVO;
    if (email === req.usuario.email && estado === usuarios.ESTADOS_U.BLOQUEADO) throw new Error('No puedes desactivarte a ti mismo');
    // Nunca dejar el sistema sin ningún superadmin activo.
    if (estado === usuarios.ESTADOS_U.BLOQUEADO) {
      const { lista } = await usuarios.leerUsuarios();
      const objetivo = lista.find(u => usuarios.normalizarEmail(u.email) === email);
      if (objetivo && objetivo.rol === 'superadmin') {
        const activos = lista.filter(u => u.rol === 'superadmin' && u.estado !== usuarios.ESTADOS_U.BLOQUEADO);
        if (activos.length <= 1) throw new Error('Debe quedar al menos un superadmin activo');
      }
    }
    await usuarios.actualizarUsuario(email, { estado });
    res.json({ status: 'ok' });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Resetear la contraseña de un usuario (le llega una nueva provisional).
router.post('/reset', async (req, res) => {
  try {
    const email = usuarios.normalizarEmail((req.body || {}).email);
    const u = await usuarios.buscarUsuario(email);
    if (!u) throw new Error('No existe ese usuario');
    const prov = usuarios.generarPasswordProvisional();
    await usuarios.actualizarUsuario(email, { hash: usuarios.hashPassword(prov), debe_cambiar: 'si' });
    const r = await enviarCorreo({
      to: email, subject: 'Nueva contraseña provisional — Telecab',
      text: `Se ha restablecido el acceso de ${email}.\n\nContraseña provisional: ${prov}\n\nEntra y el sistema te pedirá crear una nueva.`
    });
    res.json({ status: 'ok', correoEnviado: !!r.enviado, passwordProvisional: prov });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
