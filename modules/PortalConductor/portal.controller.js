// ============================================================
// PORTAL DEL CONDUCTOR — las rutas
// ============================================================
// Solo se llega aquí por el dominio de los conductores (DOMINIO_CONDUCTORES,
// services/dominios.js). En ese dominio NO HAY NADA MÁS: lo que no sea de aquí
// da 404, sin pasar nunca al ERP. Por eso este router se monta en app.js antes
// que la sesión de la oficina, el webhook y todas las demás rutas.
//
//   GET  /         su portada (sin sesión, a /entrar)
//   GET  /entrar   el formulario: teléfono y DNI/NIE
//   POST /entrar   entrar
//   POST /salir    salir (también GET, para el enlace)

const express = require('express');
const router = express.Router();
const portal = require('./portal.service');
const { esDeConductores } = require('../../services/dominios');

const LAYOUT = 'layout-conductor';

// Que no lo indexe ningún buscador, y la sesión del conductor en cada petición.
router.use(async (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  try { req.conductor = await portal.sesionDe(req, res); }
  catch (e) { console.error('❌ [PORTAL] sesión:', e.message); req.conductor = null; }
  next();
});

router.get('/', (req, res) => {
  if (!req.conductor) return res.redirect('/entrar');
  res.render('conductor-inicio', { layout: LAYOUT, titulo: 'Inicio', c: req.conductor });
});

router.get('/entrar', (req, res) => {
  if (req.conductor) return res.redirect('/');
  res.render('conductor-entrar', { layout: LAYOUT, titulo: 'Entrar', error: null, telefono: '', recordar: true });
});

router.post('/entrar', async (req, res) => {
  const b = req.body || {};
  const recordar = b.recordar === 'si' || b.recordar === 'on';
  try {
    const r = await portal.entrar({
      telefono: b.telefono, documento: b.documento,
      ip: req.ip || req.socket.remoteAddress, agente: req.get('user-agent') || '',
    });
    if (!r.ok) {
      return res.status(401).render('conductor-entrar', {
        layout: LAYOUT, titulo: 'Entrar', error: r.error, telefono: String(b.telefono || '').slice(0, 20), recordar });
    }
    portal.ponerSesion(res, r.conductor, { recordar });
    return res.redirect('/');
  } catch (e) {
    console.error('❌ [PORTAL] entrar:', e.message);
    return res.status(500).render('conductor-entrar', {
      layout: LAYOUT, titulo: 'Entrar', error: 'No se ha podido entrar. Vuelve a probar en un momento.',
      telefono: String(b.telefono || '').slice(0, 20), recordar });
  }
});

const salir = (req, res) => { portal.quitarSesion(res); res.redirect('/entrar'); };
router.post('/salir', salir);
router.get('/salir', salir);

// Lo demás no existe en este dominio. Nunca se pasa al ERP.
router.use((req, res) => {
  res.status(404).render('conductor-404', { layout: LAYOUT, titulo: 'No encontrado', c: req.conductor });
});

/**
 * EL REPARTO, para app.js: si la petición es del dominio de los conductores, la
 * atiende el portal entero; si no, sigue al ERP.
 */
const porDominio = (req, res, next) => (esDeConductores(req) ? router(req, res, next) : next());

module.exports = { router, porDominio };
