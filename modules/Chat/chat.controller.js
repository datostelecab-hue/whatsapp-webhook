// ============================================================
// EL CHAT INTERNO — sus rutas (/chat, db/256 y db/257, ítem 2, entregas 2a y 2b)
// ============================================================
// De toda la oficina, como /tablero: no está en el catálogo de permisos y cada
// canal se comprueba en chat.service.js (los privados y los directos, solo de
// quien está dentro).
//
//   GET  /chat                                        la pantalla
//   GET  /chat/api/canales                            los suyos, con no leídos y menciones
//   GET  /chat/api/canales/:id                        uno, con quién está dentro
//   GET  /chat/api/canales/:id/mensajes?antes=|despues=
//   POST /chat/api/canales/:id/mensajes               { texto, padreId?, borrador? }   (borrador: donde subió ya sus ficheros)
//   GET  /chat/api/canales/:id/fijados                lo fijado en el canal
//   POST /chat/api/canales/:id/leido                  { hasta }
//   POST /chat/api/canales                            { nombre, tipo, tema, descripcion }   (Dirección y Desarrollo)
//   POST /chat/api/canales/:id/miembros               { usuarioId }   añadir a un privado
//   POST /chat/api/canales/:id/miembros/quitar        { usuarioId }
//   POST /chat/api/directos                           { usuarios: [ids] }
//   GET  /chat/api/mensajes/:id                       uno
//   GET  /chat/api/mensajes/:id/hilo                  el de arriba y sus respuestas
//   GET  /chat/api/personas                           la oficina (menciones y directos)
//   GET  /chat/api/guardados                          lo que guardó quien mira
//   POST /chat/api/mensajes/:id/editar                { texto }          (2b: solo su autor)
//   POST /chat/api/mensajes/:id/anular                { motivo? }        (lo propio sin motivo; lo de otro, quien lleva los canales)
//   POST /chat/api/mensajes/:id/reaccion              { emoji }          pone o quita
//   POST /chat/api/mensajes/:id/fijar                 { fijar }
//   POST /chat/api/mensajes/:id/guardar               { guardar }
//   POST /chat/api/mensajes/:id/tarea                 { titulo, descripcion, responsableId, plazoDias, venceEl }
'use strict';

const express = require('express');
const { PassThrough } = require('stream');
const router = express.Router();
const actor = require('../../services/repo/actor');
const sesion = require('../../services/sesion');
const chat = require('./chat.service');
const gifs = require('./gifs.service');
const slack = require('./slack.service');

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
router.post('/api/canales/:id/mensajes', responde((id, req) => chat.enviar(id, req.params.id, { texto: b(req).texto, padreId: b(req).padreId, borrador: b(req).borrador })));
// El botón de GIF (18/11/2026, con KLIPY): buscar y mandar uno de los enseñados.
router.get('/api/gifs', responde((id, req) => gifs.buscar(id, { q: req.query.q, pagina: req.query.pagina })));
router.post('/api/canales/:id/gif', responde((id, req) => gifs.mandar(id, req.params.id, { gifId: b(req).gifId, padreId: b(req).padreId })));
router.get('/api/canales/:id/fijados', responde((id, req) => chat.fijados(id, req.params.id)));
router.post('/api/canales/:id/leido', responde((id, req) => chat.leido(id, req.params.id, { hasta: b(req).hasta })));
router.post('/api/canales', responde((id, req) => chat.crearCanal(id, b(req)).then(canal => ({ canal }))));
router.post('/api/canales/:id/miembros', responde((id, req) => chat.anadir(id, req.params.id, { usuarioId: b(req).usuarioId }).then(canal => ({ canal }))));
router.post('/api/canales/:id/miembros/quitar', responde((id, req) => chat.quitar(id, req.params.id, { usuarioId: b(req).usuarioId })));
// db/274 (23/11/2026): ocultar un directo, archivar un canal y «eliminar» un chat (nunca se borra).
router.post('/api/canales/:id/ocultar', responde((id, req) => chat.ocultar(id, req.params.id, { ocultar: b(req).ocultar !== false })));
router.post('/api/canales/:id/archivar', responde((id, req) => chat.archivar(id, req.params.id, { archivar: b(req).archivar !== false }).then(canal => ({ canal }))));
router.post('/api/canales/:id/eliminar', responde((id, req) => chat.eliminar(id, req.params.id)));
router.get('/api/eliminados', responde(id => chat.eliminados(id)));
router.post('/api/directos', responde((id, req) => chat.directo(id, { usuarios: b(req).usuarios }).then(canal => ({ canal }))));
router.get('/api/mensajes/:id', responde((id, req) => chat.uno(id, req.params.id)));
router.get('/api/mensajes/:id/hilo', responde((id, req) => chat.hilo(id, req.params.id)));
router.get('/api/personas', responde(id => chat.personas(id)));
router.get('/api/guardados', responde(id => chat.guardados(id)));
router.post('/api/mensajes/:id/editar', responde((id, req) => chat.editar(id, req.params.id, { texto: b(req).texto })));
router.post('/api/mensajes/:id/anular', responde((id, req) => chat.anular(id, req.params.id, { motivo: b(req).motivo })));
router.post('/api/mensajes/:id/reaccion', responde((id, req) => chat.reaccionar(id, req.params.id, { emoji: b(req).emoji })));
router.post('/api/mensajes/:id/fijar', responde((id, req) => chat.fijar(id, req.params.id, { fijar: b(req).fijar !== false })));
router.post('/api/mensajes/:id/guardar', responde((id, req) => chat.guardar(id, req.params.id, { guardar: b(req).guardar !== false })));
router.post('/api/mensajes/:id/tarea', responde((id, req) => chat.convertirEnTarea(id, req.params.id, b(req))));

// ── La migración de Slack (2d, db/259-260): solo el desarrollador ───────────
// El ERP no habla con Slack: se le sube la exportación (los mensajes, leídos
// fuera mensaje a mensaje) y luego, uno a uno, sus ficheros.
//   GET  /chat/slack                     la pantalla
//   GET  /chat/slack/api/estado          la exportación subida, lo que esté en marcha (con su informe) y los ficheros
//   POST /chat/slack/api/exportacion     el JSON de la exportación (hasta 50 MB; se queda en memoria)
//   GET  /chat/slack/api/personas        quién es quién (y los usuarios del ERP para elegir)
//   POST /chat/slack/api/personas        { slackId, usuarioId }   corregir a mano (null: que salga con su nombre de Slack)
//   POST /chat/slack/api/simular         dice qué traería (no escribe mensajes)
//   POST /chat/slack/api/migrar          lo trae (se puede repetir: no duplica)
//   GET  /chat/slack/api/ficheros        los que faltan por subir
//   POST /chat/slack/api/ficheros/:id    el fichero, tal cual (application/octet-stream), a su mensaje
router.get('/slack', sesion.requiereDesarrollador, (req, res) => {
  res.render('chatSlack', { titulo: 'Migración de Slack', seccion: 'chat', layout: 'layout-gestion' });
});
router.get('/slack/api/estado', sesion.requiereDesarrollador, responde(() => slack.estado()));
// Se salta el parser de 2 MB de app.js (SUBEN_ARCHIVOS): la exportación pesa más.
router.post('/slack/api/exportacion', sesion.requiereDesarrollador, express.json({ limit: '50mb' }),
  responde((id, req) => ({ exportacion: slack.cargar(req.body) })));
router.get('/slack/api/personas', sesion.requiereDesarrollador, responde(() => slack.personas()));
router.post('/slack/api/personas', sesion.requiereDesarrollador, responde((id, req) => slack.ponerPersona(id, b(req))));
router.post('/slack/api/simular', sesion.requiereDesarrollador, responde(id => ({ proceso: slack.lanzar('simular', id) })));
router.post('/slack/api/migrar', sesion.requiereDesarrollador, responde(id => ({ proceso: slack.lanzar('migrar', id) })));
router.get('/slack/api/ficheros', sesion.requiereDesarrollador, responde(async () => ({ ficheros: await slack.ficherosPendientes() })));
// El cuerpo es el fichero tal cual: se pasa a R2 según llega. Si la conexión
// se corta a medias, el stream se rompe y no se guarda nada a medias.
router.post('/slack/api/ficheros/:id', sesion.requiereDesarrollador, responde((id, req) => {
  const cuerpo = new PassThrough();
  req.on('close', () => { if (!req.complete) cuerpo.destroy(Object.assign(new Error('La subida se cortó a medias'), { status: 400 })); });
  req.pipe(cuerpo);
  return slack.subirFichero(id, req.params.id, cuerpo);
}));

module.exports = router;
