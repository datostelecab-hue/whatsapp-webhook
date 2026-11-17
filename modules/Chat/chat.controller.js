// ============================================================
// EL CHAT INTERNO — sus rutas (/chat, db/256, ítem 2, entrega 2a)
// ============================================================
// De toda la oficina, como /tablero: no está en el catálogo de permisos y cada
// canal se comprueba en chat.service.js (los privados y los directos, solo de
// quien está dentro).
//
//   GET  /chat                                        la pantalla
//   GET  /chat/api/canales                            los suyos, con no leídos y menciones
//   GET  /chat/api/canales/:id                        uno, con quién está dentro
//   GET  /chat/api/canales/:id/mensajes?antes=|despues=
//   POST /chat/api/canales/:id/mensajes               { texto, padreId? }
//   POST /chat/api/canales/:id/leido                  { hasta }
//   POST /chat/api/canales                            { nombre, tipo, tema, descripcion }   (Dirección y Desarrollo)
//   POST /chat/api/canales/:id/miembros               { usuarioId }   añadir a un privado
//   POST /chat/api/canales/:id/miembros/quitar        { usuarioId }
//   POST /chat/api/directos                           { usuarios: [ids] }
//   GET  /chat/api/mensajes/:id                       uno
//   GET  /chat/api/mensajes/:id/hilo                  el de arriba y sus respuestas
//   GET  /chat/api/personas                           la oficina (menciones y directos)
'use strict';

const express = require('express');
const router = express.Router();
const actor = require('../../services/repo/actor');
const chat = require('./chat.service');

const yo = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);
const responde = fn => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', ...(await fn(await yo(req), req)) });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('❌ [Chat]', e.stack || e.message);
    const msg = e.status ? e.message : 'No se ha podido hacer: ha fallado algo en el servidor. Si se repite, avisa al desarrollador.';
    res.status(e.status || 500).json({ status: 'error', msg });
  }
};
const b = req => req.body || {};

router.get('/', (req, res) => {
  res.render('chat', { titulo: 'Chat', seccion: 'chat', layout: 'layout-gestion' });
});

router.get('/api/canales', responde(id => chat.canales(id)));
router.get('/api/canales/:id', responde((id, req) => chat.ficha(id, req.params.id).then(canal => ({ canal }))));
router.get('/api/canales/:id/mensajes', responde((id, req) => chat.mensajes(id, req.params.id, { antes: req.query.antes, despues: req.query.despues })));
router.post('/api/canales/:id/mensajes', responde((id, req) => chat.enviar(id, req.params.id, { texto: b(req).texto, padreId: b(req).padreId })));
router.post('/api/canales/:id/leido', responde((id, req) => chat.leido(id, req.params.id, { hasta: b(req).hasta })));
router.post('/api/canales', responde((id, req) => chat.crearCanal(id, b(req)).then(canal => ({ canal }))));
router.post('/api/canales/:id/miembros', responde((id, req) => chat.anadir(id, req.params.id, { usuarioId: b(req).usuarioId }).then(canal => ({ canal }))));
router.post('/api/canales/:id/miembros/quitar', responde((id, req) => chat.quitar(id, req.params.id, { usuarioId: b(req).usuarioId })));
router.post('/api/directos', responde((id, req) => chat.directo(id, { usuarios: b(req).usuarios }).then(canal => ({ canal }))));
router.get('/api/mensajes/:id', responde((id, req) => chat.uno(id, req.params.id)));
router.get('/api/mensajes/:id/hilo', responde((id, req) => chat.hilo(id, req.params.id)));
router.get('/api/personas', responde(id => chat.personas(id)));

module.exports = router;
