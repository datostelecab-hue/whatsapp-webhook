// ============================================================
// WHATSAPP — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
//   /whatsapp[?tel=|?conductor=]    la pantalla: conversaciones y chat
//   GET  /whatsapp/api/conversaciones?q=&filtro=    filtro: '' | mias | libres
//   GET  /whatsapp/api/chat?tel=&despues=&antes=&llamadas=1   (abrirla la da por leída)
//   GET  /whatsapp/api/adjunto/:id                  la foto, el audio o el documento
//   GET  /whatsapp/api/foto/:conductorId?v=         la foto de su ficha, para el avatar
//   GET  /whatsapp/api/plantillas?tel=              las de Meta, para escribir con la ventana cerrada
//   GET  /whatsapp/api/asignables                   a quién se le puede dar una conversación
//   GET  /whatsapp/api/respuestas?tel=              las respuestas rápidas, con su {nombre} ya puesto
//   GET  /whatsapp/api/conductores                  a quién se puede escribir por primera vez
//   POST /whatsapp/api/enviar        { tel, texto }                     escribir (ventana de 24 h)
//   POST /whatsapp/api/plantilla     { tel, nombre, idioma, valores }   mandar una plantilla (se paga)
//   POST /whatsapp/api/bot           { tel, pausar }                    pausar el bot o devolverle la conversación
//   POST /whatsapp/api/asignar       { tel, usuario }                   quién la lleva (vacío: nadie)
//   POST /whatsapp/api/respuestas    { id?, titulo, texto }             crear o cambiar una respuesta rápida
//   POST /whatsapp/api/respuestas/borrar { id }
//
// Mirar va con la llave '/whatsapp'; todo lo que no es un GET, con
// '/whatsapp/escribir' (services/permisos.js).

const express = require('express');
const router = express.Router();
const svc = require('./whatsapp.service');
const actor = require('../../services/repo/actor');   // quién firma
const permisos = require('../../services/permisos');

const LAYOUT = 'layout-gestion';
const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

/**
 * ¿Tiene quien entra esta llave? El candado de verdad lo pone `controlAcceso`
 * sobre cada ruta; esto es para que la pantalla no enseñe lo que va a contestar
 * 403 (la caja de escribir, las llamadas del Call Center).
 */
async function tiene(req, clave) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await actor.idDe(req);
    return id ? (await permisos.clavesDe(id)).has(clave) : false;
  } catch (_) { return false; }
}

/** Envoltorio: recoge el error y lo devuelve legible. */
const responde = (fn, codigo = 500) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [WhatsApp] ${req.method} ${req.path}: ${e.stack || e.message}`);
    res.status(e.status || codigo).json({ status: 'error', msg: e.message });
  }
};
const cuerpo = req => req.body || {};

router.get('/', async (req, res) => {
  // Desde otra pantalla (el Call Center, una ficha) se llega con el conductor.
  const abrirTel = req.query.conductor ? await svc.telefonoDeConductor(req.query.conductor) : null;
  res.render('whatsapp', {
    titulo: 'WhatsApp', seccion: 'whatsapp', layout: LAYOUT,
    puedeEscribir: await tiene(req, '/whatsapp/escribir'),
    verLlamadas: await tiene(req, '/callcenter'),
    abrirTel: abrirTel || '',
    sinTelefono: !!req.query.conductor && !abrirTel,
  });
});

router.get('/api/conversaciones', responde(async req =>
  svc.conversaciones({ buscar: req.query.q, filtro: req.query.filtro }, await actor.idDe(req))));
router.get('/api/chat', responde(async req => svc.abrir(req.query.tel, {
  despuesDe: req.query.despues, antesDe: req.query.antes,
  verLlamadas: req.query.llamadas === '1' && await tiene(req, '/callcenter'),
}), 400));

// El fichero va tal cual, con su tipo. Lo que no es foto, audio o vídeo se
// descarga, nunca se abre en la página (ver whatsappChat.adjuntoEnLinea).
router.get('/api/adjunto/:id', async (req, res) => {
  try {
    const a = await svc.adjunto(req.params.id);
    res.set({
      'Content-Type': a.mime,
      'Content-Disposition': a.disposicion,
      'Content-Length': String(a.bytes.length),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(a.bytes);
  } catch (e) {
    if (!e.status) console.error(`❌ [WhatsApp] adjunto ${req.params.id}: ${e.stack || e.message}`);
    res.status(e.status || 500).json({ status: 'error', msg: e.message });
  }
});

// LA FOTO DE SU FICHA. La URL lleva el id del documento (?v=): una foto nueva
// es otra URL, así que se puede guardar una semana en el navegador.
router.get('/api/foto/:conductorId', async (req, res) => {
  try {
    const f = await svc.foto(req.params.conductorId);
    // Sin foto, un rato en caché: la lista se repinta cada 10 s y no tiene por qué volver a preguntar.
    if (!f) return res.set('Cache-Control', 'private, max-age=300').status(404).end();
    res.set({ 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.end(f.bytes);
  } catch (e) {
    console.error(`❌ [WhatsApp] foto ${req.params.conductorId}: ${e.message}`);
    res.status(404).end();
  }
});

router.get('/api/plantillas', responde(req => svc.plantillas({ telefono: req.query.tel }), 502));
router.get('/api/asignables', responde(() => svc.asignables()));
router.get('/api/respuestas', responde(req => svc.respuestas({ telefono: req.query.tel })));
router.get('/api/conductores', responde(() => svc.conductores()));

router.post('/api/enviar', responde(async req => svc.enviar({ telefono: cuerpo(req).tel, texto: cuerpo(req).texto }, await actor.idDe(req)), 400));
router.post('/api/plantilla', responde(async req => svc.enviarPlantilla({
  telefono: cuerpo(req).tel, nombre: cuerpo(req).nombre, idioma: cuerpo(req).idioma, valores: cuerpo(req).valores,
}, await actor.idDe(req)), 400));
router.post('/api/bot', responde(async req => svc.bot({ telefono: cuerpo(req).tel, pausar: !!cuerpo(req).pausar }, await actor.idDe(req)), 400));
router.post('/api/asignar', responde(async req => svc.asignar({ telefono: cuerpo(req).tel, usuario: cuerpo(req).usuario }, await actor.idDe(req)), 400));
router.post('/api/respuestas', responde(async req => svc.guardarRespuesta(cuerpo(req), await actor.idDe(req)), 400));
router.post('/api/respuestas/borrar', responde(req => svc.borrarRespuesta(cuerpo(req).id), 400));

module.exports = router;
