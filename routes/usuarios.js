const express = require('express');
const router = express.Router();
const usuarios = require('../services/usuarios');
const permisos = require('../services/permisos');
const sesion = require('../services/sesion');
const { enviarCorreo } = require('../services/correo');

// ============================================================
// USUARIOS Y PERMISOS — el módulo del DESARROLLADOR
// ============================================================
// Aquí se crean las cuentas y se elige, USUARIO A USUARIO, qué módulos y
// submódulos puede abrir cada uno (usuario_permiso). Los roles con acceso
// total (Admin, Desarrollador) no llevan matriz: entran a todo; y el control
// de los usuarios es SOLO del desarrollador — un Admin ni ve esta pantalla.

router.use(sesion.requiereDesarrollador);

router.get('/', (req, res) => {
  res.render('usuarios', {
    titulo: 'Usuarios y permisos', seccion: 'usuarios', layout: 'layout-gestion',
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await usuarios.leerUsuarios();
    const porUsuario = {};
    for (const u of lista) {
      // Nunca se devuelve el hash. Los de acceso total no llevan matriz.
      porUsuario[u.id] = u.accesoTotal ? null : [...await permisos.clavesDe(u.id)];
    }
    res.json({
      status: 'ok',
      usuarios: lista.map(u => ({
        id: u.id, email: u.email, nombre: u.nombre, apellidos: u.apellidos, telefono: u.telefono,
        rol: u.rol, accesoTotal: u.accesoTotal, estado: u.estado, debe_cambiar: u.debe_cambiar === 'si',
        creado_por: u.creado_por, fecha_creacion: u.fecha_creacion, ultimo_acceso: u.ultimo_acceso,
      })),
      permisos: porUsuario,
      catalogo: permisos.CATALOGO,
      semillas: { oficina: permisos.semillaDeRol('oficina'), trafico: permisos.semillaDeRol('trafico') },
      roles: await usuarios.roles(),
      yo: req.usuario.email,
    });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Crear usuario → provisional por correo (o se dicta en persona si no salió el correo).
router.post('/crear', async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.apellidos || '').trim()) throw new Error('Faltan los apellidos');
    if (!String(b.telefono || '').trim()) throw new Error('Falta el teléfono');
    const { usuario, passwordProvisional } = await usuarios.crearUsuario({
      email: b.email, nombre: b.nombre, apellidos: b.apellidos, telefono: b.telefono, rol: b.rol,
      creado_por: req.usuario.email,
    });
    const r = await enviarCorreo({
      to: usuario.email, subject: 'Acceso a la plataforma Telecab',
      text: `Hola ${usuario.nombre},\n\nSe ha creado tu acceso a la plataforma Telecab.\n\nUsuario: ${usuario.email}\nContraseña provisional: ${passwordProvisional}\n\nEntra y el sistema te pedirá crear tu propia contraseña.`
    });
    console.log(`👤 [Usuarios] ${usuario.email} creado (${b.rol}) por ${req.usuario.email}`);
    res.json({ status: 'ok', email: usuario.email, correoEnviado: !!r.enviado, passwordProvisional });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Los permisos de un usuario: se reemplazan por la lista marcada en la matriz.
router.post('/permisos', async (req, res) => {
  try {
    const b = req.body || {};
    const { lista } = await usuarios.leerUsuarios();
    const u = lista.find(x => x.id === Number(b.usuarioId));
    if (!u) throw new Error('No existe ese usuario');
    if (u.accesoTotal) throw new Error(`${u.nombre} tiene acceso total por su rol: no lleva matriz`);
    const yo = lista.find(x => usuarios.normalizarEmail(x.email) === usuarios.normalizarEmail(req.usuario.email));
    const r = await permisos.guardar(u.id, b.claves || [], { usuarioMod: yo ? yo.id : null });
    console.log(`🔐 [Usuarios] Permisos de ${u.email}: ${r.claves.length} módulo(s) — por ${req.usuario.email}`);
    res.json({ status: 'ok', claves: r.claves });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/rol', async (req, res) => {
  try {
    const b = req.body || {};
    const email = usuarios.normalizarEmail(b.email);
    if (!await usuarios.esRol(b.rol)) throw new Error(`Rol no válido: "${b.rol}"`);
    if (email === usuarios.normalizarEmail(req.usuario.email) && b.rol !== 'desarrollador') {
      throw new Error('No puedes quitarte a ti mismo el rol de desarrollador');
    }
    const antes = await usuarios.buscarUsuario(email);
    if (!antes) throw new Error('No existe ese usuario');
    const actualizado = await usuarios.actualizarUsuario(email, { rol: b.rol });
    // Si baja de un rol de acceso total a uno normal y no tiene matriz, se le
    // siembra la de su rol nuevo para que no se quede mirando una pantalla vacía.
    if (antes.accesoTotal && !actualizado.accesoTotal) {
      await permisos.sembrar(actualizado.id, b.rol);
    }
    console.log(`🎭 [Usuarios] ${email}: rol ${antes.rol} → ${b.rol} — por ${req.usuario.email}`);
    res.json({ status: 'ok' });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/estado', async (req, res) => {
  try {
    const b = req.body || {};
    const email = usuarios.normalizarEmail(b.email);
    const estado = b.estado === 'bloqueado' ? usuarios.ESTADOS_U.BLOQUEADO : usuarios.ESTADOS_U.ACTIVO;
    if (email === usuarios.normalizarEmail(req.usuario.email) && estado === usuarios.ESTADOS_U.BLOQUEADO) {
      throw new Error('No puedes desactivarte a ti mismo');
    }
    // Nunca dejar el sistema sin nadie con acceso total activo.
    if (estado === usuarios.ESTADOS_U.BLOQUEADO) {
      const { lista } = await usuarios.leerUsuarios();
      const objetivo = lista.find(u => usuarios.normalizarEmail(u.email) === email);
      if (objetivo && objetivo.accesoTotal) {
        const activos = lista.filter(u => u.accesoTotal && u.estado !== usuarios.ESTADOS_U.BLOQUEADO);
        if (activos.length <= 1) throw new Error('Debe quedar al menos un administrador activo');
      }
    }
    await usuarios.actualizarUsuario(email, { estado });
    console.log(`🚦 [Usuarios] ${email}: ${estado} — por ${req.usuario.email}`);
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
    console.log(`🔑 [Usuarios] Reset de ${email} — por ${req.usuario.email}`);
    res.json({ status: 'ok', correoEnviado: !!r.enviado, passwordProvisional: prov });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
