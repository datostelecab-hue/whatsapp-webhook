// ============================================================
// LAS NOTIFICACIONES AL DISPOSITIVO — sus rutas (/push, db/250, pieza A8)
// ============================================================
// Cada uno, lo suyo: activa, confirma y quita SUS dispositivos, y se manda una
// de prueba a sí mismo. Mandar notificaciones a otros es cosa de cada módulo,
// desde el servidor (services/notificacionesPush.js), nunca de una ruta.
//
//   GET  /push/api/estado      si el servidor tiene sus claves, la pública, y mis dispositivos
//   POST /push/api/activar     { suscripcion, dispositivo }: «Activar» en este navegador
//   POST /push/api/confirmar   { suscripcion }: la pantalla, al cargar, con la sesión de ahora
//   POST /push/api/quitar      { id } o { endpoint }
//   POST /push/api/probar      una de prueba a todos mis dispositivos
//
// El service worker (/sw.js) y el manifiesto (/manifest.webmanifest) se sirven
// en app.js, antes de la sesión: el navegador los pide sin ella.
'use strict';

const express = require('express');
const router = express.Router();
const actor = require('../../services/repo/actor');
const push = require('../../services/notificacionesPush');

const quienEs = async req => {
  const id = (req.usuario && req.usuario.id) || await actor.idDe(req);
  return { id: id ? Number(id) : null, rol: req.usuario ? req.usuario.rol : null, sid: (req.usuario && req.usuario.sid) || null };
};

function fallo(res, e, que) {
  if (!e.status || e.status >= 500) console.error(`❌ [Push] ${que}:`, e.stack || e.message);
  const msg = e.status ? e.message : 'No se ha podido hacer: ha fallado algo en el servidor. Si se repite, avisa al desarrollador.';
  res.status(e.status || 500).json({ status: 'error', msg });
}

router.get('/api/estado', async (req, res) => {
  try {
    res.json({ status: 'ok', configurado: push.configurado(), clave: push.clavePublica(), mias: await push.mias(await quienEs(req)) });
  } catch (e) { fallo(res, e, 'estado'); }
});

router.post('/api/activar', async (req, res) => {
  try {
    if (!push.configurado()) {
      return res.status(503).json({ status: 'error', msg: 'Las notificaciones aún no están configuradas en el servidor. Avisa al desarrollador.' });
    }
    const b = req.body || {};
    res.json({ status: 'ok', ...(await push.activar(await quienEs(req), b.suscripcion, b.dispositivo)) });
  } catch (e) { fallo(res, e, 'activar'); }
});

router.post('/api/confirmar', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await push.confirmar(await quienEs(req), (req.body || {}).suscripcion)) });
  } catch (e) { fallo(res, e, 'confirmar'); }
});

router.post('/api/quitar', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ status: 'ok', ...(await push.quitar(await quienEs(req), { id: b.id, endpoint: b.endpoint })) });
  } catch (e) { fallo(res, e, 'quitar'); }
});

// Una de prueba a uno mismo, como mucho una cada 10 s por persona.
const ultimaPrueba = new Map();
router.post('/api/probar', async (req, res) => {
  try {
    const quien = await quienEs(req);
    const antes = ultimaPrueba.get(quien.id) || 0;
    if (Date.now() - antes < 10000) {
      return res.status(429).json({ status: 'error', msg: 'Espera unos segundos antes de mandar otra de prueba.' });
    }
    ultimaPrueba.set(quien.id, Date.now());
    const r = await push.enviar([quien.id], {
      titulo: 'Prueba de Telecab',
      cuerpo: 'Si ves esto, las notificaciones te llegan a este dispositivo.',
      url: '/configuracion',
      etiqueta: 'prueba',
    });
    res.json({ status: 'ok', ...r });
  } catch (e) { fallo(res, e, 'probar'); }
});

module.exports = router;
